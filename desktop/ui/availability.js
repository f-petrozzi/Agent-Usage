// Shared renderer/desktop reading freshness and availability; preserve measured quota ink.
(function (root) {
  'use strict';
  function readingUnavailable(snap) {
    const readings = (snap.windows || []).filter(w => typeof w.used === 'number' && Number.isFinite(w.used));
    if (!readings.length) return true;
    if (snap.hasCredits === true) return false;
    return readings.some(w => w.used >= 1) && (snap.blocked === true || readings.every(w => w.used >= 1));
  }
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  const ttl=provider=>provider==='codex'?120000:600000;
  const samples=snap=>[snap.fetched_at,...(snap.windows||[]).map(w=>w.sampled_at)].filter(t=>finite(t)&&t>0);
  function windowPending(window,now=Date.now()){
    return finite(window.resets_at)&&window.resets_at>0&&window.resets_at<=now;
  }
  function expiresAt(snap,provider=snap.provider){
    const deadlines=samples(snap).map(t=>t+ttl(provider));
    for(const window of snap.windows||[])if(finite(window.resets_at)&&window.resets_at>0)deadlines.push(window.resets_at);
    return deadlines.length?Math.min(...deadlines):null;
  }
  function readingStale(snap,provider=snap.provider,now=Date.now()){
    const times=samples(snap);
    return snap.status==='stale'||snap.status==='error'||!finite(snap.fetched_at)||snap.fetched_at<=0||!times.length||
      times.some(t=>now<t||now-t>ttl(provider))||(snap.windows||[]).some(w=>windowPending(w,now));
  }
  root.usageReadingUnavailable = readingUnavailable;
  root.usageReadingStale = readingStale;
  root.usageWindowPending = windowPending;
  if (typeof module !== 'undefined') module.exports = Object.assign(readingUnavailable,{stale:readingStale,expiresAt});
})(typeof window !== 'undefined' ? window : globalThis);
