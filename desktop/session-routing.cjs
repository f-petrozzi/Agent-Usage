'use strict';
const { resumeUrl } = require('./session-open.cjs');
function sessionScope(target) {
  return target.source === 'ssh' ? 'ssh:' + target.sshTarget : 'wsl:' + (target.wslDistro || target.lastWslDistro || '');
}
// Every entry point supplies identity only. Metadata comes from the current collector.
function resolveSession({ rows, active = [], config, account, id, sessionId }) {
  const same = s => s.account === account && (sessionId ? s.sessionId === sessionId : s.id === id);
  const saved = rows.find(same);
  // Idle snapshots may describe a completed, closed turn. Only current activity,
  // an explicit live flag or writer ancestry establishes an existing terminal.
  const live = active.find(s => (s.live === true || ['busy','waiting'].includes(s.state) || s.terminalPids?.length)
    && (same(s) || saved && s.account === saved.account && s.sessionId === saved.sessionId));
  if (!saved && !live) throw new Error('This session is no longer available. Open Sessions and try again.');
  const target = { ...(saved || live), source: config.source, sshTarget: config.sshTarget,
    wslDistro: saved?.wslDistro || config.lastWslDistro, resume: true,
    terminalPids: [...new Set([...(live?.terminalPids || []), ...(saved?.terminalPids || [])])].slice(0, 16),
    live: !!live || saved?.live === true };
  if (live && (!saved || !resumeUrl(target))) { target.focusOnly = true; target.cwd = live.cwd || '/'; }
  if (!resumeUrl(target)) throw new Error('This session’s workspace or account metadata is unavailable. Update the collector and try again.');
  return target;
}
module.exports = { resolveSession, sessionScope };
