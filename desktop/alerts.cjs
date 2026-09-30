'use strict';
const DEFAULT_ALERTS = Object.freeze({ quota: true, waiting: false, completion: true, sound: false, muted: [] });
// A turn shorter than this was probably watched as it happened, so its end is not worth an alert
const COMPLETION_MIN_MS = 30000;
function alertPreferences(raw = {}) {
  return { ...Object.fromEntries(Object.entries(DEFAULT_ALERTS).filter(([, v]) => typeof v === 'boolean').map(([k, v]) => [k, typeof raw[k] === 'boolean' ? raw[k] : v])),
    muted: Array.isArray(raw.muted) ? [...new Set(raw.muted.filter(id => typeof id === 'string' && id.length <= 100))].slice(0, 40) : [] };
}
// A lower reading alone may be a correction, not a new quota window. Only a later
// reset boundary rearms a warning. Persist the boundary/threshold, never credentials.
class QuotaAlerts {
  constructor(saved = {}) {
    this.saved = Object.fromEntries(Object.entries(saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {}).filter(([, v]) => v && [0, 80, 100].includes(v.level) && (v.reset === null || (Number.isFinite(v.reset) && v.reset > 0))).slice(-120));
  }
  update(accounts, preferences, now = Date.now()) {
    const events = [];
    for (const account of accounts) {
      if (account.snap.status !== 'ok') continue;
      for (const window of account.snap.windows) {
        if (!Number.isFinite(window.used)) continue;
        const key = JSON.stringify([account.id, window.id, window.label]);
        const reset = Number.isFinite(window.resets_at) && window.resets_at > 0 ? window.resets_at : null;
        const previous = this.saved[key];
        const level = window.used >= 1 ? 100 : window.used >= .8 ? 80 : 0;
        const rolled = previous && reset !== null && previous.reset !== null && reset > previous.reset && now >= previous.reset;
        const oldLevel = rolled ? 0 : previous?.level ?? level;
        if (level > oldLevel && preferences.quota && !preferences.muted.includes(account.id)) {
          events.push({ kind: 'quota', account: account.id, window: window.id, level, used: window.used, title: account.name + (level === 100 ? ' limit reached' : ' usage warning'),
            body: `${window.label}: ${Math.round(window.used * 100)}% used${reset && reset > now ? `. Resets ${new Date(reset).toLocaleString()}` : ''}.` });
        }
        this.saved[key] = { reset, level: Math.max(oldLevel, level) };
      }
    }
    // Keep storage bounded even as accounts are added or removed.
    this.saved = Object.fromEntries(Object.entries(this.saved).slice(-120));
    return events;
  }
}
class SessionAlerts {
  constructor() { this.reset(); }
  reset() { this.previous = null; }
  update(sessions, preferences, now = Date.now()) {
    const current = new Map(sessions.filter(s => s.id).map(s => [s.account + ':' + s.id, s]));
    const events = [];
    // Claude rewrites statusUpdatedAt on busy updates; retain the first timestamp of this busy stretch.
    for (const [key, session] of current) if (session.state === 'busy') {
      const old = this.previous?.get(key);
      current.set(key, { ...session, busySince: old?.state === 'busy' ? old.busySince : session.since > 0 ? session.since : null });
    }
    if (this.previous) for (const [key, session] of current) {
      const old = this.previous.get(key);
      if (!old) continue; // A first sighting is not a transition.
      if (session.state === 'waiting' && old.state === 'busy' && preferences.waiting)
        events.push({ kind: 'waiting', account: session.account, session: session.name, target: sessionTarget(session) || sessionTarget(old), title: `${session.name} needs attention`, body: session.detail || 'Waiting for input.' });
      // Finished: a turn that ran (busy) and ended on its own (idle, not canceled), long enough to have been left alone
      const ended = session.since > 0 && session.since <= now ? session.since : now;
      const took = old.busySince > 0 ? Math.max(0, ended - old.busySince) : null;
      if (session.state === 'idle' && old.state === 'busy' && preferences.completion && (took === null || took >= COMPLETION_MIN_MS))
        events.push({ kind: 'completion', account: session.account, session: session.name, target: sessionTarget(session) || sessionTarget(old), took, title: `${session.name} finished working`,
          body: took === null ? 'The agent reported that its turn ended.' : `Worked ${Math.max(1, Math.round(took / 60000))} min.` });
    }
    this.previous = current;
    return events;
  }
}
function orderedAccounts(accounts, slots = []) {
  const selected = slots.map(s => accounts.find(a => a.id === s.provider)).filter(Boolean);
  return selected.length ? selected : accounts;
}
function trayReadings(accounts, now = Date.now()) {
  return accounts.map(account => ({ name: account.name,
    lines: account.snap.windows.map(window => {
      const until = Number.isFinite(window.resets_at) && window.resets_at > 0 ? window.resets_at - now : null;
      const minutes = until === null ? null : Math.max(0, Math.ceil(until / 60000));
      const reset = minutes === null ? '' : minutes === 0 ? ' · reset due' : ` · resets in ${minutes >= 60 ? Math.floor(minutes / 60) + 'h ' : ''}${minutes % 60}m`;
      return `${window.label}: ${Math.round(window.used * 100)}% used${reset}`;
    }), status: account.snap.status }));
}
// Alerts no longer go to Windows' notification centre, so the app keeps its own short log for the notch's bell:
// the last 40 or the last week, whichever is fewer, newest last. Only what the bell shows is kept.
// Only fixed provider routes and UUID session identities reach the OS URL opener.
function sessionTarget(raw) {
  const target = raw?.target || raw;
  return target && ['claude', 'codex'].includes(target.provider) && typeof target.sessionId === 'string'
    && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(target.sessionId)
    ? { provider: target.provider, sessionId: target.sessionId } : null;
}
function sessionUrl(raw) {
  const target = sessionTarget(raw);
  if (!target) return null;
  return target.provider === 'claude' ? `vscode://anthropic.claude-code/open?session=${target.sessionId}`
    : `vscode://openai.chatgpt/local/${target.sessionId}`;
}
const LOG_MAX = 40, LOG_DAYS = 7;
const text = (v, n) => typeof v === 'string' ? v.slice(0, n) : null;
function alertLog(raw, now = Date.now()) {
  return (Array.isArray(raw) ? raw : []).filter(e => e && typeof e === 'object' && Number.isFinite(e.at) && e.at > now - LOG_DAYS * 864e5 && e.at <= now + 6e4
    && ['quota', 'waiting', 'completion'].includes(e.kind)).slice(-LOG_MAX).map(e => ({
    id: text(e.id, 40) || String(e.at), at: e.at, kind: e.kind, account: text(e.account, 100), window: text(e.window, 100),
    level: [80, 100].includes(e.level) ? e.level : null, used: Number.isFinite(e.used) ? Math.max(0, Math.min(1, e.used)) : null,
    session: text(e.session, 200), target: sessionTarget(e.target), took: Number.isFinite(e.took) && e.took >= 0 ? e.took : null,
    title: text(e.title, 200) || '', body: text(e.body, 300) || '', read: e.read === true }));
}
function logAlerts(log, events, now = Date.now()) {
  return alertLog([...log, ...events.map((e, i) => ({ ...e, id: `${now.toString(36)}-${i}`, at: now, read: false }))], now);
}
module.exports = { COMPLETION_MIN_MS, DEFAULT_ALERTS, alertPreferences, QuotaAlerts, SessionAlerts, orderedAccounts, trayReadings, alertLog, logAlerts, sessionTarget, sessionUrl };
