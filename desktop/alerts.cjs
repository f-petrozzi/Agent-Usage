'use strict';
const DEFAULT_ALERTS = Object.freeze({ quota: true, waiting: false, completion: false, peek: true, sound: false, muted: [] });
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
          events.push({ kind: 'quota', account: account.id, title: account.name + (level === 100 ? ' limit reached' : ' usage warning'),
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
  update(sessions, preferences) {
    const current = new Map(sessions.filter(s => s.id).map(s => [s.account + ':' + s.id, s]));
    const events = [];
    if (this.previous) for (const [key, session] of current) {
      const old = this.previous.get(key);
      if (!old) continue; // A first sighting is not a transition.
      if (session.state === 'waiting' && old.state === 'busy' && preferences.waiting)
        events.push({ kind: 'waiting', title: `${session.name} needs attention`, body: session.detail || 'Waiting for input.' });
      if (session.state === 'idle' && old.state === 'busy' && preferences.completion)
        events.push({ kind: 'completion', title: `${session.name} finished working`, body: 'The agent reported that its turn ended.' });
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
module.exports = { DEFAULT_ALERTS, alertPreferences, QuotaAlerts, SessionAlerts, orderedAccounts, trayReadings };
