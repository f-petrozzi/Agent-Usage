'use strict';
const { execFile } = require('node:child_process');
const { EventEmitter } = require('node:events');
const crypto = require('node:crypto');

const clean = (value, limit = 500) => String(value ?? '').replace(/\s*\u2014\s*/g, '. ').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(0, limit);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validHost = value => typeof value === 'string' && value.length <= 120 && /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:@[A-Za-z0-9_][A-Za-z0-9._-]*)?$/.test(value);
function normalize(raw) {
  if (raw.schema !== 2 || !Array.isArray(raw.accounts)) throw new Error('Unsupported collector snapshot');
  const timestamp = finite(raw.generatedAt) ? raw.generatedAt * 1000 : Date.now();
  return raw.accounts.slice(0, 40).map((a, index) => {
    const base = a.provider === 'claude' ? 'claude' : 'codex';
    const id = base + '_' + crypto.createHash('sha256').update(String(a.id || index)).digest('hex').slice(0, 12);
    const name = clean(base === 'codex' ? `Codex ${a.label || ''}`.trim() : a.label || 'Claude', 100);
    const details = [];
    if (a.plan) details.push(clean(a.plan, 100));
    if (Number.isInteger(a.resetCredits)) details.push(`${a.resetCredits} banked resets`);
    if (Array.isArray(a.resetCreditDetails)) for (const credit of a.resetCreditDetails.slice(0, 30)) {
      details.push(!credit.expirationKnown ? 'Reset expiration unknown' : finite(credit.expiresAt)
        ? `Reset expires ${new Date(credit.expiresAt * 1000).toLocaleString()}` : 'Reset does not expire');
    }
    if (finite(a.creditBalance)) details.push(a.creditBalance < 0 ? 'Unlimited credits' : `${a.creditBalance.toFixed(2)} credits available`);
    if (a.extraUsage?.enabled) details.push(finite(a.extraUsage.usedDollars) ? `$${a.extraUsage.usedDollars.toFixed(2)} extra usage` : 'Extra usage enabled');
    if (a.blocked) details.push('Limit reached. waiting for reset');
    const windows = (Array.isArray(a.limits) ? a.limits : []).slice(0, 30).filter(l => finite(l.usedPercent)).map((l, i) => ({
      id: l.windowMins >= 10080 ? (base === 'codex' ? 'secondary' : 'seven_day')
        : l.windowMins > 0 && l.windowMins < 1440 ? (base === 'codex' ? 'primary' : 'session') : `window_${i}`,
      label: clean(l.label || 'Usage', 100), used: Math.max(0, Math.min(1, l.usedPercent / 100)),
      resets_at: finite(l.resetsAt) ? l.resetsAt * 1000 : null, count: null, derived: false
    }));
    return { id, base, name, glyph: base === 'claude' ? 'C' : 'Cx', snap: {
      status: a.error || a.warning ? (windows.length ? 'stale' : 'error') : 'ok', windows,
      fetched_at: finite(a.sampledAt) ? a.sampledAt * 1000 : timestamp,
      note: clean([a.error, a.warning].filter(Boolean).join(' · '), 1500), details
    }};
  });
}
class Collector extends EventEmitter {
  constructor(config) { super(); this.config = config; this.accounts = []; this.busy = false; this.failures = 0; this.closed = false; }
  refresh() {
    if (this.busy || this.closed) return false;
    this.busy = true;
    clearTimeout(this.timer);
    const cfg = this.config();
    let executable = 'wsl.exe', args = ['--exec', 'sh', '-lc', 'exec "$HOME/.local/bin/agent-usage" --timeout 20 --compact'];
    if (cfg.source === 'ssh') {
      if (!validHost(cfg.sshTarget)) { this.busy = false; this.failed(new Error('Set a valid collector SSH host in Settings → General')); return false; }
      executable = 'ssh.exe';
      args = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'StrictHostKeyChecking=accept-new', cfg.sshTarget,
        '~/.local/bin/agent-usage --timeout 20 --compact'];
    }
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
module.exports = { Collector, validHost };
