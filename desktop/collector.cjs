'use strict';
const { execFile, spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const clean = (value, limit = 500) => String(value ?? '').replace(/\s*\u2014\s*/g, '. ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, limit);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validHost = value => typeof value === 'string' && value.length <= 120 && /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:@[A-Za-z0-9_][A-Za-z0-9._-]*)?$/.test(value);
// The app's id for a collector account; the session feed names accounts the same way the usage snapshot does
const accountId = (base, raw) => base + '_' + crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 12);
// [executable, args] reaching the collector over WSL or SSH, or null when no SSH host is set
function collectorCommand(cfg, flags, sshOptions = [], platform = process.platform) {
  if (cfg.source === 'ssh' && !validHost(cfg.sshTarget)) return null;
  return require('./platform-runtime.cjs').collectorCommand(cfg, flags, sshOptions, platform);
}
function normalize(raw) {
  if (raw.schema !== 2 || !Array.isArray(raw.accounts)) throw new Error('Unsupported collector snapshot');
  const timestamp = finite(raw.generatedAt) ? raw.generatedAt * 1000 : Date.now();
  return raw.accounts.slice(0, 40).map((a, index) => {
    const base = { claude: 'claude', codex: 'codex', antigravity: 'gemini' }[a.provider];
    if (!base) return null;
    const id = accountId(base, a.id || index);
    const name = clean(base === 'gemini' ? 'Antigravity' : base === 'codex' ? `Codex ${a.label || ''}`.trim() : a.label || 'Claude', 100);
    const details = [];
    if (a.plan && base !== 'claude') details.push(clean(a.plan, 100));
    // Resets are a row of their own in the card rather than a line of metadata: how many, when the soonest
    // runs out, and each one (or each grant of several) against its own date, soonest first. None at all is no
    // row, and an unknown count is never made up; resets the details do not account for are listed as unknown.
    let resets = null;
    if (Number.isInteger(a.resetCredits) && a.resetCredits > 0) {
      const count = Math.min(a.resetCredits, 999);
      const each = (Array.isArray(a.resetCreditDetails) ? a.resetCreditDetails : []).slice(0, 30).filter(c => c && typeof c === 'object')
        .map(c => ({ at: c.expirationKnown && finite(c.expiresAt) ? c.expiresAt * 1000 : null, known: c.expirationKnown === true,
          count: Number.isInteger(c.count) && c.count > 0 ? Math.min(c.count, 999) : 1 }))
        .sort((x, y) => (x.at === null) - (y.at === null) || (x.at || 0) - (y.at || 0) || y.known - x.known);
      const listed = each.reduce((n, e) => n + e.count, 0);
      if (listed < count) each.push({ at: null, known: false, count: count - listed });
      const dated = each.filter(e => e.at !== null).map(e => e.at);
      resets = { count, expires: dated.length ? Math.min(...dated) : null, each };
    }
    if (finite(a.creditBalance)) details.push(a.creditBalance < 0 ? 'Unlimited credits' : `${a.creditBalance.toFixed(2)} credits available`);
    if (a.extraUsage?.enabled) details.push(finite(a.extraUsage.usedDollars) ? `$${a.extraUsage.usedDollars.toFixed(2)} extra usage` : 'Extra usage enabled');
    if (a.blocked) details.push('Limit reached. waiting for reset');
    const windows = (Array.isArray(a.limits) ? a.limits : []).slice(0, 30).filter(l => finite(l.usedPercent)).map((l, i) => ({
      id: base === 'gemini' ? clean(l.id || `gemini_${i}`, 100) : l.windowMins >= 10080 ? (base === 'codex' ? 'secondary' : 'seven_day')
        : l.windowMins > 0 && l.windowMins < 1440 ? (base === 'codex' ? 'primary' : 'session') : `window_${i}`,
      group: base === 'gemini' ? clean(l.group || 'Models', 100) : null,
      label: clean(l.label || 'Usage', 100), used: Math.max(0, Math.min(1, l.usedPercent / 100)),
      resets_at: finite(l.resetsAt) ? l.resetsAt * 1000 : null, count: null, derived: false
    }));
    return { id, base, name, glyph: base === 'gemini' ? 'A' : base === 'claude' ? 'C' : 'Cx', snap: {
      status: a.error || a.warning ? (windows.length ? 'stale' : 'error') : 'ok', windows,
      fetched_at: finite(a.sampledAt) ? a.sampledAt * 1000 : timestamp,
      note: clean([a.error, a.warning].filter(Boolean).join(' · '), 1500), details, resets
    }};
  }).filter(Boolean);
}
// Enable the newly added provider once, while respecting later user choices.
function enrollAntigravity(config, accounts) {
  if (config.antigravityEnrolled) return false;
  const added = accounts.filter(a => a.base === 'gemini');
  if (!added.length) return false;
  if (config.slots.length) for (const a of added) {
    if (!config.slots.some(s => s.provider === a.id)) config.slots.push({ provider: a.id });
  }
  config.antigravityEnrolled = true;
  return true;
}
class Collector extends EventEmitter {
  constructor(config) { super(); this.config = config; this.accounts = []; this.busy = false; this.failures = 0; this.closed = false; }
  refresh() {
    if (this.busy || this.closed) return false;
    this.busy = true;
    clearTimeout(this.timer);
    const command = collectorCommand(this.config(), '--timeout 20 --compact');
    if (!command) { this.busy = false; this.failed(new Error('Set a valid collector SSH host in Settings → General')); return false; }
    const [executable, args] = command;
    this.child = execFile(executable, args, { windowsHide: true, timeout: 90000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      this.child = null; this.busy = false;
      if (this.closed) return;
      if (error) return this.failed(new Error(clean(stderr || error.message, 1200)));
      try {
        const raw = JSON.parse(stdout), accounts = normalize(raw);
        if (!accounts.length) throw new Error('The collector returned no accounts');
        this.accounts = accounts; this.failures = 0; this.emit('change', accounts);
        const busy = finite(raw.activityAt) && Date.now() / 1000 - raw.activityAt < 360;
        this.schedule(busy ? 60000 : 180000);
      } catch (error) { this.failed(error); }
    });
    return true;
  }
  failed(error) {
    const note = clean(error.message, 1500);
    if (this.accounts.length) this.accounts = this.accounts.map(a => ({ ...a, snap: { ...a.snap, status: 'stale', note } }));
    else this.accounts = [{ id: 'collector', base: 'claude', name: 'Agent Usage', glyph: '!', snap: { status: 'error', windows: [], fetched_at: 0, note, details: [] } }];
    this.emit('change', this.accounts);
    this.schedule(Math.min(600000, 45000 * 2 ** Math.min(this.failures++, 4)));
  }
  schedule(delay) { this.timer = setTimeout(() => this.refresh(), delay); }
  close() { this.closed = true; clearTimeout(this.timer); this.child?.kill(); }
}
// One line of `agent-usage --watch-sessions`: the sessions working or waiting right now, as notch activity
function parseSessions(line, includeTerminal = false, limit = 40) {
  const raw = JSON.parse(line);
  if (raw.schema !== 1 || !Array.isArray(raw.sessions)) throw new Error('Unsupported session feed');
  return raw.sessions.slice(0, limit)
    .filter(s => s && ['claude', 'codex', 'antigravity'].includes(s.provider) && (includeTerminal ? ['busy', 'waiting', 'idle', 'canceled'] : ['busy', 'waiting']).includes(s.state) && typeof s.account === 'string')
    .map(s => {
      const reason = s.state === 'waiting' && typeof s.waitingFor === 'string' ? clean(s.waitingFor, 60) : '';
      return { ...(includeTerminal ? { id: clean(s.id || '', 100), sessionId: clean(s.sessionId || '', 100), ...(Array.isArray(s.terminalPids)&&s.terminalPids.length?{terminalPids:s.terminalPids.filter(n=>Number.isInteger(n)&&n>1&&n<=2147483647).slice(0,16),cwd:clean(s.cwd||'',1024)}:{}) } : {}), provider: s.provider, account: accountId(s.provider === 'antigravity' ? 'gemini' : s.provider, s.account), state: s.state,
        name: clean(s.name || ({claude:'Claude',codex:'Codex',antigravity:'Antigravity'}[s.provider]), 80),
        detail: s.state === 'idle' ? 'Turn ended' : s.state === 'canceled' ? 'Canceled' : s.state === 'busy' ? 'Working' : reason ? reason[0].toUpperCase() + reason.slice(1) : 'Waiting',
        since: finite(s.since) ? s.since * 1000 : 0 };
    });
}
// A long-lived collector process streaming session state; reconnects with backoff and never shows stale arcs
class SessionFeed extends EventEmitter {
  constructor(config, command = cfg => collectorCommand(cfg, '--watch-sessions', ['-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3'])) {
    super(); this.config = config; this.command = command; this.sessions = []; this.failures = 0; this.closed = false; this.child = null;
  }
  start() {
    if (this.closed || this.child) return;
    const command = this.command(this.config());
    if (!command) return this.retry(60000);
    let buffer = '', stderr = '', done = false;
    const child = this.child = spawn(command[0], command[1], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const end = () => { if (!done) { done = true; this.ended(child, stderr); } };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      buffer += data;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) { this.line(buffer.slice(0, at)); buffer = buffer.slice(at + 1); }
      if (buffer.length > 256 * 1024) child.kill();
    });
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-2000); });
    child.on('error', end);
    child.on('close', end);
    this.watchdog();
  }
  line(text) {
    let sessions;
    try { sessions = parseSessions(text, true); } catch { this.emit('disconnected'); return; }
    this.failures = 0; this.watchdog();
    this.emit('snapshot', sessions);
    this.set(sessions.filter(s => ['busy', 'waiting'].includes(s.state)));
  }
  set(sessions) {
    if (JSON.stringify(sessions) === JSON.stringify(this.sessions)) return;
    this.sessions = sessions; this.emit('change', sessions);
  }
  // The collector writes at least every 15 s; silence past that is a connection that died quietly
  watchdog() { clearTimeout(this.quiet); this.quiet = setTimeout(() => this.child?.kill(), 45000); }
  ended(child, stderr) {
    if (this.child === child) this.child = null;
    clearTimeout(this.quiet); this.emit('disconnected'); this.set([]);
    if (this.closed) return;
    // A collector from before --watch-sessions: check back rarely rather than reconnecting every few seconds
    if (/unrecognized arguments/.test(stderr)) return this.retry(600000);
    this.retry(Math.min(60000, 3000 * 2 ** Math.min(this.failures++, 5)));
  }
  retry(delay) { clearTimeout(this.timer); this.timer = setTimeout(() => this.start(), delay); }
  close() { this.closed = true; clearTimeout(this.timer); clearTimeout(this.quiet); this.child?.kill(); }
}
function readSessionLinks(config) {
  const command = collectorCommand(config, '--session-links --compact');
  if (!command) return Promise.reject(new Error('Set a collector host first.'));
  return new Promise((resolve, reject) => execFile(command[0], command[1], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (error) return reject(new Error('The collector could not restore this link. Update the collector and try again.'));
    try { resolve(parseSessions(stdout, true, 2048)); } catch { reject(new Error('The collector returned no session links.')); }
  }));
}
const validLinuxPath = value => typeof value === 'string' && value.startsWith('/') && value.length <= 1024 && !/[\x00-\x1f\x7f]/.test(value);
function normalizeHistory(raw) {
  const parsed = parseSessions(JSON.stringify(raw), true, 1200).sort((a, b) => b.since - a.since);
  const metadata = new Map(raw.sessions.filter(s => s && typeof s === 'object').map(s => [accountId(s.provider === 'antigravity' ? 'gemini' : s.provider, s.account) + ':' + s.id, s]));
  const counts = new Map(), seen = new Set();
  return parsed.filter(s => {
    const key = s.account + ':' + s.id, count = counts.get(s.account) || 0;
    if (!s.id || seen.has(key) || count >= 30) return false;
    seen.add(key); counts.set(s.account, count + 1); return true;
  }).map(s => {
    const meta = metadata.get(s.account + ':' + s.id) || {};
    const { cwd: ignoredCwd, ...identity } = s;
    return { ...identity, ...(validLinuxPath(meta.cwd) ? { cwd: meta.cwd } : {}),
      ...(validLinuxPath(meta.agentHome) ? { agentHome: meta.agentHome } : {}), live: meta.live === true };
  }).sort((a, b) => b.since - a.since);
}
function readSessionHistory(config, run = execFile) {
  const command = collectorCommand(config, '--session-history --compact');
  if (!command) return Promise.reject(new Error('Set a collector host in Settings → General.'));
  return new Promise((resolve, reject) => run(command[0], command[1], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
    if (error) return reject(new Error('Update agent-usage on your collector host to load session history.'));
    try { const raw = JSON.parse(stdout); resolve({ sessions: normalizeHistory(raw),
      wslDistro: typeof raw.wslDistro === 'string' && /^[A-Za-z0-9._-]{1,120}$/.test(raw.wslDistro) ? raw.wslDistro : '' }); }
    catch { reject(new Error('The collector returned invalid session history.')); }
  }));
}
module.exports = { normalize, enrollAntigravity, Collector, SessionFeed, parseSessions, accountId, validHost, readSessionLinks, readSessionHistory, normalizeHistory, validLinuxPath };
