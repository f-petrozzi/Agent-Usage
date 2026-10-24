"""Bounded local response feeds. Never read credentials or contact providers."""
from __future__ import annotations
import datetime as dt
import json
import math
from pathlib import Path
import time


def timestamp(value):
    if type(value) in (int, float) and math.isfinite(value):
        return value
    if isinstance(value, str):
        try:
            return dt.datetime.fromisoformat(value.replace('Z', '+00:00')).timestamp()
        except ValueError:
            pass
    raise ValueError('Invalid sample time.')


def codex_result(rate):
    if not isinstance(rate, dict) or rate.get('limit_id') not in (None, 'codex'):
        raise ValueError('Not a Codex quota bucket.')
    bucket = {new: rate[old] for old, new in (
        ('limit_id', 'limitId'), ('plan_type', 'planType'), ('spend_control_reached', 'spendControlReached'),
        ('rate_limit_reached_type', 'rateLimitReachedType')) if old in rate}
    for key in ('primary', 'secondary'):
        if isinstance(rate.get(key), dict):
            window = rate[key]
            bucket[key] = {new: window[old] for old, new in (
                ('used_percent', 'usedPercent'), ('window_minutes', 'windowDurationMins'), ('resets_at', 'resetsAt')) if old in window}
    if isinstance(rate.get('credits'), dict):
        bucket['credits'] = {new: rate['credits'][old] for old, new in (
            ('has_credits', 'hasCredits'), ('unlimited', 'unlimited'), ('balance', 'balance')) if old in rate['credits']}
    return {'rateLimits': bucket}


def claude_row(rate):
    """Accept only measured subscription windows, not token/context percentages."""
    if not isinstance(rate, dict):
        raise ValueError('Missing Claude rate limits.')
    limits = []
    for key, label, mins in (('five_hour', '5 hours', 300), ('seven_day', 'Weekly', 10080),
                             ('seven_day_opus', 'Weekly Opus', 10080), ('seven_day_sonnet', 'Weekly Sonnet', 10080)):
        w = rate.get(key)
        if not isinstance(w, dict):
            continue
        used, reset = w.get('used_percentage'), w.get('resets_at')
        if (type(used) not in (int, float) or not math.isfinite(used) or not 0 <= used <= 100 or
                type(reset) not in (int, float) or not math.isfinite(reset) or reset <= time.time()):
            continue
        limits.append(dict(label=label, usedPercent=used, windowMins=mins, resetsAt=reset))
    if not limits:
        raise ValueError('No measured Claude windows.')
    return dict(id='claude', provider='claude', label='Claude', limits=limits,
                blocked=any(w['usedPercent'] >= 100 for w in limits))


class LocalFeeds:
    def __init__(self, service):
        self.service = service
        self.offsets = {}
        self.status_signature = None
        self.states = {}
        self.pending_turn = None

    def scan(self):
        """Changed rollouts only, including old sessions resumed today."""
        now = time.time()
        for name, home in self.service.profiles:
            # Directory walk stats do not deserialize histories. A fresh quota
            # event must be in a recently modified file regardless of creation date.
            for path in (home / 'sessions').rglob('rollout-*.jsonl'):
                try:
                    meta = path.stat()
                    if now - meta.st_mtime > 180:
                        self.offsets.pop(str(path), None)
                        continue
                    self.read_codex('codex:' + name, path, meta)
                except OSError:
                    continue
        self.read_claude()
        self.finish_turn()

    def read_codex(self, ident, path, meta):
        previous = self.offsets.get(str(path))
        if previous and previous[:2] == (meta.st_ino, meta.st_size):
            return
        offset = previous[2] if previous and previous[0] == meta.st_ino and meta.st_size >= previous[1] else max(0, meta.st_size - 2 * 1024 * 1024)
        with path.open('rb') as handle:
            handle.seek(offset)
            if not previous and offset:
                handle.readline()  # discard a partial first record
            while True:
                line = handle.readline(2 * 1024 * 1024 + 1)
                if not line:
                    break
                if len(line) > 2 * 1024 * 1024:
                    while line and not line.endswith(b'\n'):
                        line = handle.readline(2 * 1024 * 1024)
                    continue  # skip a huge tool record without retaining it
                if not line.endswith(b'\n'):
                    handle.seek(-len(line), 1)
                    break  # retry an incomplete append on the next scan
                if b'"token_count"' not in line or len(line) > 2 * 1024 * 1024:
                    continue
                try:
                    record = json.loads(line)
                    if not isinstance(record, dict) or not isinstance(record.get('payload'), dict):
                        continue
                    payload = record['payload']
                    if record.get('type') != 'event_msg' or payload.get('type') != 'token_count':
                        continue
                    sample = timestamp(record.get('timestamp'))
                    value = codex_result(payload.get('rate_limits'))
                    with self.service.lock:
                        self.service.accept(ident, value, sample, source='live', origin='codex-session')
                except (ValueError, TypeError, KeyError):
                    continue
            self.offsets[str(path)] = (meta.st_ino, meta.st_size, handle.tell())

    def read_claude(self):
        path = self.service.root / 'claude-live.json'
        try:
            meta = path.stat()
            signature = (meta.st_ino, meta.st_mtime_ns, meta.st_size)
            if signature == self.status_signature:
                return
            with path.open('rb') as handle:
                raw = handle.read(16385)
            if len(raw) > 16384:
                return
            data = json.loads(raw)
            if not isinstance(data, dict):
                return
            row = claude_row(data.get('rate_limits'))
            with self.service.lock:
                self.service.accept('claude', row, timestamp(data.get('sampledAt')), source='live', origin='claude-statusline')
            self.status_signature = signature
        except (OSError, ValueError, KeyError, TypeError):
            pass

    def observe_sessions(self, sessions):
        """Coalesce a busy -> ended edge; duplicate watchers never request polls."""
        current = {s['id']: s['state'] for s in sessions if s.get('provider') == 'claude'}
        if any(state == 'busy' and current.get(key) in (None, 'idle', 'canceled') for key, state in self.states.items()):
            self.pending_turn = time.time() + 3
        self.states = current

    def finish_turn(self):
        if self.pending_turn is None or time.time() < self.pending_turn:
            return
        finished = self.pending_turn - 3
        self.pending_turn = None
        with self.service.lock:
            row = self.service.rows.get('claude', {})
            if row.get('source') == 'live' and (row.get('receivedAt') or 0) >= finished:
                return
            if 'claude' in self.service.queries:
                self.service.request_check('claude')
