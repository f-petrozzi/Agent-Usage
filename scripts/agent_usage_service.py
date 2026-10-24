"""Shared, owner-local usage cache. Consumers never trigger a provider request.

The JSON file is the read API; the private Unix socket accepts native Codex
updates. Only this process polls providers. No model turns are started.
"""
from __future__ import annotations

import copy
import fcntl
import json
import math
import os
from pathlib import Path
import selectors
import signal
import socket
import socketserver
import stat
import struct
import subprocess
import threading
import time

from agent_usage_live import LocalFeeds, claude_row

MAX_BYTES = 1024 * 1024
MIN_GAP = {'codex': 60, 'claude': 300, 'antigravity': 60}
FRESHNESS = {'codex': 120, 'claude': 600, 'antigravity': 600}


def state_root():
    return Path(os.environ.get('AGENT_USAGE_STATE_DIR') or
                Path(os.environ.get('XDG_STATE_HOME') or Path.home() / '.local/state') / 'agent-usage')


def socket_path():
    return state_root() / 'updates.sock'


def read_snapshot(path=None, *, internal=False, now=None):
    """Recompute freshness at read time, including a stopped/crashed daemon."""
    path = Path(path) if path else state_root() / 'shared.json'
    now = time.time() if now is None else now
    with path.open('rb') as source:
        raw = source.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('Shared usage cache exceeded its size limit.')
    data = json.loads(raw)
    if data.get('schema') != 2 or data.get('source') != 'shared' or not isinstance(data.get('accounts'), list):
        raise ValueError('Invalid shared usage cache.')
    heartbeat = data.get('updatedAt')
    alive = type(heartbeat) in (int, float) and 0 <= now - heartbeat <= 45
    for account in data['accounts']:
        sampled = account.get('sampledAt')
        age = now - sampled if type(sampled) in (int, float) else math.inf
        expired = any(type(w.get('resetsAt')) in (int, float) and w['resetsAt'] <= now
                      for w in account.get('limits', []))
        stale = (not alive or not 0 <= age <= FRESHNESS.get(account.get('provider'), 120)
                 or expired or bool(account.get('error') or account.get('warning') or account.get('stale')))
        account['available'] = bool(account.get('limits'))
        account['stale'] = stale
        if stale and not account.get('error') and not account.get('warning'):
            account['warning'] = ('Shared usage service is unavailable (last reading).' if not alive
                                  else 'Usage reading is stale; waiting for a provider update.')
        if not internal:
            account.pop('_native', None)
    return data


def shared_snapshot(profiles, include_claude, include_agy):
    data = read_snapshot()
    wanted = [f'codex:{name}' for name, _ in profiles]
    if include_claude:
        wanted.append('claude')
    if include_agy:
        wanted.append('antigravity')
    accounts = {a['id']: a for a in data['accounts']}
    data['accounts'] = [accounts.get(ident) or {
        'id': ident, 'provider': ident.split(':')[0], 'label': ident.split(':')[-1],
        'limits': [], 'sampledAt': None, 'available': False, 'stale': True,
        'error': 'Account is not configured in the shared usage service; restart it after adding accounts.'}
        for ident in wanted]
    return data


def codex_native(result):
    """Allow only quota fields across the IPC/cache boundary, with full precision."""
    if not isinstance(result, dict):
        raise ValueError('Invalid usage update.')
    buckets = result.get('rateLimitsByLimitId')
    bucket = (buckets.get('codex') if isinstance(buckets, dict) else None) or result.get('rateLimits')
    if not isinstance(bucket, dict) or bucket.get('limitId') not in (None, 'codex'):
        raise ValueError('Codex usage update is missing its quota bucket.')
    clean = {k: bucket[k] for k in ('limitId', 'planType', 'rateLimitReachedType', 'spendControlReached') if k in bucket}
    for key in ('primary', 'secondary'):
        window = bucket.get(key)
        if window is None:
            continue
        if not isinstance(window, dict):
            raise ValueError('Invalid Codex quota window.')
        used, reset = window.get('usedPercent'), window.get('resetsAt')
        if (type(used) not in (int, float) or not math.isfinite(used) or used < 0 or
                type(reset) not in (int, float) or not math.isfinite(reset) or reset <= time.time()):
            raise ValueError('Incomplete Codex quota window.')
        clean[key] = {k: window[k] for k in ('usedPercent', 'resetsAt', 'windowDurationMins') if k in window}
    if not any(k in clean for k in ('primary', 'secondary')):
        raise ValueError('Codex usage update has no measured windows.')
    credits = bucket.get('credits')
    if isinstance(credits, dict):
        clean['credits'] = {k: credits[k] for k in ('balance', 'hasCredits', 'unlimited') if k in credits}
    value = {'rateLimits': clean}
    resets = result.get('rateLimitResetCredits')
    if isinstance(resets, dict):
        value['rateLimitResetCredits'] = {'availableCount': resets.get('availableCount')}
        if isinstance(resets.get('credits'), list):
            value['rateLimitResetCredits']['credits'] = [
                {k: row[k] for k in ('status', 'expiresAt') if k in row}
                for row in resets['credits'][:100] if isinstance(row, dict)]
    # Reject non-JSON/non-finite scalar values, and cap the full message.
    if len(json.dumps(value, allow_nan=False)) > 16384:
        raise ValueError('Oversized quota update.')
    return value


class CodexReader:
    """One persistent, read-only app-server per configured Codex account."""
    def __init__(self, usage, name, home, timeout):
        self.usage, self.name, self.home, self.timeout = usage, name, home, timeout
        self.proc = self.selector = self.binary = None
        self.started = 0
        self.discovery_at = 0
        self.serial = 0

    def read(self):
        if time.monotonic() - self.discovery_at > 300:
            clear = getattr(self.usage._codex_cli, 'cache_clear', None)
            if clear:
                clear()
            self.discovery_at = time.monotonic()
        binary = self.usage._codex_cli()
        if not binary:
            raise RuntimeError('Codex is not installed.')
        if self.proc and (self.proc.poll() is not None or binary != self.binary or time.monotonic() - self.started > 3600):
            self.close()
        if self.proc is None:
            self.binary = binary
            env = self.usage._codex_env(binary)
            env['CODEX_HOME'] = str(self.home)
            args = [binary, '-c', self.usage.AUTH_STORE_OVERRIDE, '-c', 'mcp_servers={}',
                    '-c', 'plugins={}', '-c', 'hooks={}', '--disable', 'hooks', '--disable', 'plugins',
                    '--disable', 'apps', 'app-server', '--listen', 'stdio://']
            self.proc = subprocess.Popen(args, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=subprocess.DEVNULL, text=True, start_new_session=True)
            self.started = time.monotonic()
            self.selector = selectors.DefaultSelector()
            self.selector.register(self.proc.stdout, selectors.EVENT_READ)
            self.rpc('initialize', {'clientInfo': {'name': 'agent_usage', 'title': 'Agent Usage', 'version': '3.0.0'}})
            self.usage._send(self.proc, {'method': 'initialized', 'params': {}})
        return self.rpc('account/rateLimits/read', {})

    def rpc(self, method, params):
        self.serial += 1
        self.usage._send(self.proc, {'method': method, 'params': params, 'id': self.serial})
        return self.usage._wait_for_response(self.proc, self.selector, self.serial, self.timeout)

    def close(self):
        if self.selector:
            self.selector.close()
            self.selector = None
        proc, self.proc = self.proc, None
        if not proc:
            return
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait(timeout=2)
        for pipe in (proc.stdin, proc.stdout):
            if pipe:
                pipe.close()


class UsageService:
    def __init__(self, usage, profiles, include_claude=True, include_agy=True, timeout=20, root=None):
        self.usage, self.profiles, self.timeout = usage, profiles, timeout
        self.root = Path(root) if root else state_root()
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.readers = {f'codex:{n}': CodexReader(usage, n, h, timeout) for n, h in profiles}
        self.queries = {ident: reader.read for ident, reader in self.readers.items()}
        if include_claude:
            self.queries['claude'] = lambda: usage.query_claude(timeout, allow_cli=False)
        if include_agy:
            self.queries['antigravity'] = lambda: usage.query_antigravity(timeout)
        self.rows = {ident: {'id': ident, 'provider': ident.split(':')[0], 'label': ident.split(':')[-1],
                            'limits': [], 'sampledAt': None, 'stale': True, 'error': 'Waiting for first usage reading.'}
                     for ident in self.queries}
        self.inflight = {}
        self.failures = dict.fromkeys(self.queries, 0)
        self.due = dict.fromkeys(self.queries, 0)
        self.activity = None
        self.local = LocalFeeds(self)

    def load(self):
        try:
            saved = read_snapshot(self.root / 'shared.json', internal=True)
            for row in saved['accounts']:
                if row['id'] in self.rows:
                    ident = row['id']
                    self.rows[ident] = {**row, 'stale': True, 'warning': 'Usage service restarted; verifying last reading.'}
                    wait = max(row.get('pollRetryAt') or 0, (row.get('pollAttemptedAt') or 0) + MIN_GAP.get(row['provider'], 60)) - time.time()
                    self.due[ident] = time.monotonic() + max(0, wait)
        except (OSError, ValueError, KeyError, TypeError):
            pass

    def save(self):
        # Caller holds the state lock. Atomic replace, never a partial snapshot.
        document = {'schema': 2, 'source': 'shared', 'generatedAt': int(time.time()),
                    'updatedAt': time.time(), 'activityAt': self.activity,
                    'accounts': list(self.rows.values())}
        raw = json.dumps(document, allow_nan=False, separators=(',', ':'))
        if len(raw.encode()) > MAX_BYTES:
            raise ValueError('Shared usage snapshot is too large.')
        temp = self.root / 'shared.json.tmp'
        fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'w') as target:
            target.write(raw)
        temp.replace(self.root / 'shared.json')

    def accept(self, ident, value, sampled=None, source='poll', persist=True, origin=None):
        """Native response readings and polls share one timestamp-ordered merge."""
        if source not in ('poll', 'live') or ident not in self.rows:
            raise ValueError('Unknown usage source or account.')
        now = time.time()
        previous = self.rows[ident]
        if ident.startswith('codex:'):
            native = codex_native(value)
            row = self.usage.normalize_codex({'account': ident[6:], 'result': native}, self.usage.active_codex_account())
        else:
            row = copy.deepcopy(value)
        if row.get('error') or row.get('warning') or row.get('stale') or not row.get('limits'):
            raise ValueError(row.get('warning') or row.get('error') or 'Provider did not return fresh usage.')
        sampled = sampled if sampled is not None else row.get('sampledAt', now)
        if type(sampled) not in (int, float) or not 0 <= now - sampled <= FRESHNESS[row['provider']]:
            raise ValueError('Provider returned an expired reading.')
        origin = origin or ('provider-poll' if source == 'poll' else 'codex-runtime')
        # Keep each window's age; a partial event cannot refresh omitted windows.
        if ident.startswith('codex:'):
            for w, slot in zip(row['limits'], [k for k in ('primary', 'secondary') if k in native['rateLimits']]):
                w['id'] = slot
            for index, w in enumerate(previous.get('limits', [])):
                w.setdefault('id', ('primary', 'secondary')[min(index, 1)])
        key = lambda w: w.get('id') if ident.startswith('codex:') else (w.get('label'), w.get('windowMins'))
        windows = {key(w): copy.deepcopy(w) for w in previous.get('limits', [])}
        changed = False
        for w in row['limits']:
            old = windows.get(key(w), {})
            if sampled <= (old.get('sampledAt', previous.get('sampledAt')) or 0):
                continue
            windows[key(w)] = {**w, 'sampledAt': sampled, 'source': source, 'origin': origin}
            changed = True
        if not changed:
            return False
        if ident.startswith('codex:'):
            # Optional metadata omitted by notifications retains its own old value.
            merged = copy.deepcopy(previous.get('_native') or {'rateLimits': {}})
            bucket = merged['rateLimits']
            for k, v in native['rateLimits'].items():
                if k in ('primary', 'secondary'):
                    # Window merge above is the timestamp authority.
                    label = self.usage._limit('5 hours' if k == 'primary' else 'Weekly', v)
                    if label and windows[k]['sampledAt'] == sampled:
                        bucket[k] = v
                elif sampled > (previous.get('receivedSampleAt') or 0):
                    bucket[k] = v
            if 'rateLimitResetCredits' in native and sampled > (previous.get('receivedSampleAt') or 0):
                merged['rateLimitResetCredits'] = native['rateLimitResetCredits']
            normalized = self.usage.normalize_codex({'account': ident[6:], 'result': merged}, self.usage.active_codex_account())
            row = {**previous, **normalized, '_native': merged}
        else:
            row = {**previous, **row}
        row['limits'] = list(windows.values())
        oldest = min(w['sampledAt'] if 'sampledAt' in w else previous.get('sampledAt') or 0 for w in row['limits'])
        row.update(sampledAt=oldest, receivedSampleAt=max(sampled, previous.get('receivedSampleAt') or 0),
                   receivedAt=now, stale=False, available=True, source=source, origin=origin, error=None,
                   blocked=any(w['usedPercent'] >= 100 for w in row['limits']))
        if ident.startswith('codex:'):
            bucket = row['_native']['rateLimits']
            row['blocked'] |= bool(bucket.get('rateLimitReachedType') or bucket.get('spendControlReached'))
        row.pop('warning', None)
        self.rows[ident] = row
        if source == 'poll':
            self.failures[ident] = 0
            row.pop('retryAt', None)
            row.pop('pollRetryAt', None)
            high = any(w['usedPercent'] >= 90 for w in row['limits'])
            interval = 60 if row['provider'] == 'codex' or (high and row['provider'] == 'antigravity') else 300
            self.due[ident] = time.monotonic() + interval
        else:
            # No fallback provider request while all represented windows are fresh.
            resets = [w['resetsAt'] for w in row['limits'] if type(w.get('resetsAt')) in (int, float)]
            expires = min([oldest + FRESHNESS[row['provider']]] + resets)
            self.due[ident] = time.monotonic() + max(0, expires - now)
        floor = max(row.get('pollRetryAt') or 0, (row.get('pollAttemptedAt') or 0) + MIN_GAP[row['provider']])
        self.due[ident] = max(self.due[ident], time.monotonic() + floor - now)
        if persist:
            self.save()
        return True

    def failed(self, ident, error, retry_at=None, started=None):
        self.failures[ident] = min(6, self.failures[ident] + 1)
        base = MIN_GAP[self.rows[ident]['provider']]
        delay = min(3600, base * 2 ** (self.failures[ident] - 1))
        if type(retry_at) in (int, float) and math.isfinite(retry_at):
            delay = max(delay, retry_at - time.time())
        row = self.rows[ident]
        row['pollRetryAt'] = row['retryAt'] = time.time() + delay
        # An older failed request must not invalidate a newer native reading.
        if started is None or (row.get('receivedAt') or 0) <= started:
            row.update(stale=True, warning=error)
        self.due[ident] = time.monotonic() + delay
        self.save()

    def request_check(self, ident):
        if ident in self.inflight:
            return False
        row = self.rows[ident]
        earliest = max(time.time(), row.get('pollRetryAt') or 0,
                       (row.get('pollAttemptedAt') or 0) + MIN_GAP[row['provider']])
        self.due[ident] = min(self.due[ident], time.monotonic() + earliest - time.time())
        return True

    def poll(self, ident):
        started = time.time()
        with self.lock:
            self.inflight[ident] = started
            self.rows[ident]['pollAttemptedAt'] = started
            self.save()  # Preserve the minimum gap even across a daemon restart.
        retry_at = None
        try:
            value = self.queries[ident]()
            retry_at = value.get('retryAt')
            with self.lock:
                sampled = started if ident.startswith('codex:') else min(started, value.get('sampledAt') or started)
                accepted = self.accept(ident, value, sampled=sampled, persist=False)
                if not accepted:
                    self.due[ident] = max(self.due[ident], time.monotonic() + MIN_GAP[self.rows[ident]['provider']])
                self.save()
        except Exception:
            if ident in self.readers:
                self.readers[ident].close()
            with self.lock:
                self.failed(ident, 'Provider usage unavailable; retrying with backoff (last reading).', retry_at, started)
        finally:
            with self.lock:
                self.inflight.pop(ident, None)

    def publish(self, request):
        if not isinstance(request, dict):
            raise ValueError('Invalid usage publication.')
        if set(request) != {'account', 'sampledAt', 'result'}:
            raise ValueError('Invalid usage publication.')
        ident, sampled = request['account'], request['sampledAt']
        if ident not in self.rows:
            raise ValueError('Unknown account.')
        value = claude_row(request['result']) if ident == 'claude' else request['result']
        with self.lock:
            accepted = self.accept(ident, value, sampled, source='live',
                                   origin='claude-runtime' if ident == 'claude' else 'codex-runtime')
        return {'accepted': accepted, 'checkRequested': False}

    def worker(self, ident):
        while not self.stop.is_set():
            with self.lock:
                delay = self.due[ident] - time.monotonic()
            if delay > 0:
                self.stop.wait(min(delay, 1))
                continue
            self.poll(ident)

    def run(self):
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        meta = self.root.lstat()
        if not stat.S_ISDIR(meta.st_mode) or meta.st_uid != os.getuid() or meta.st_mode & 0o077:
            raise ValueError('Shared usage state directory must be owned by you with mode 0700.')
        lockfd = os.open(self.root / 'service.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        with os.fdopen(lockfd, 'w') as owner:
            fcntl.flock(owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.load()
            self.local.scan()
            path = self.root / 'updates.sock'
            if path.exists():
                if not stat.S_ISSOCK(path.lstat().st_mode):
                    raise ValueError('Refusing to replace a non-socket update path.')
                path.unlink()
            service = self
            class Handler(socketserver.StreamRequestHandler):
                def handle(self):
                    self.request.settimeout(2)
                    _, uid, _ = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
                    if uid != os.getuid():
                        return
                    try:
                        line = self.rfile.readline(65537)
                        if len(line) > 65536 or not line.endswith(b'\n'):
                            raise ValueError('Oversized publication.')
                        response = service.publish(json.loads(line))
                    except (ValueError, TypeError, KeyError, OSError):
                        response = {'accepted': False}
                    self.wfile.write(json.dumps(response).encode() + b'\n')
            # Sequential, bounded publications; no unbounded request threads.
            server = socketserver.UnixStreamServer(str(path), Handler)
            path.chmod(0o600)
            server.timeout = 1
            threads = [threading.Thread(target=self.worker, args=(ident,), daemon=True) for ident in self.queries]
            with self.lock:
                self.save()
            for thread in threads:
                thread.start()
            heartbeat = 0
            local_scan = 0
            try:
                while not self.stop.is_set():
                    server.handle_request()
                    if time.monotonic() - local_scan >= 1:
                        self.local.scan()
                        if 'claude' in self.queries:
                            sessions = self.usage.claude_sessions(self.usage.claude_config_dir(), include_terminal=True)
                            with self.lock:
                                self.local.observe_sessions(sessions)
                        local_scan = time.monotonic()
                    if time.monotonic() - heartbeat >= 10:
                        try:
                            self.activity = self.usage.latest_activity([h for _, h in self.profiles], 'claude' in self.queries)
                        except OSError:
                            pass
                        with self.lock:
                            self.save()
                        heartbeat = time.monotonic()
            finally:
                self.stop.set()
                server.server_close()
                path.unlink(missing_ok=True)
                for thread in threads:
                    thread.join(timeout=self.timeout * 2 + 3)
                for reader in self.readers.values():
                    reader.close()
                with self.lock:
                    for row in self.rows.values():
                        row.update(stale=True, warning='Shared usage service stopped (last reading).')
                    self.save()


def serve(usage, profiles, include_claude, include_agy, timeout):
    service = UsageService(usage, profiles, include_claude, include_agy, timeout)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: service.stop.set())
    service.run()
    return 0
