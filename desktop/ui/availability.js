// Reading freshness and model availability are separate: preserve cached quota ink.
(function (root) {
  'use strict';
  function readingUnavailable(snap) {
    const readings = (snap.windows || []).filter(w => typeof w.used === 'number' && Number.isFinite(w.used));
    if (!readings.length) return true;
    if (snap.hasCredits === true) return false;
    return readings.some(w => w.used >= 1) && (snap.blocked === true || readings.every(w => w.used >= 1));
  }
  root.usageReadingUnavailable = readingUnavailable;
  if (typeof module !== 'undefined') module.exports = readingUnavailable;
})(typeof window !== 'undefined' ? window : globalThis);
