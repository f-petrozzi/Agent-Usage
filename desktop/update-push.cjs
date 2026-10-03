'use strict';
const https = require('node:https');
const crypto = require('node:crypto');
const config = require('./release-push-config.cjs');
const versionParts = value => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  ? value.split('.').map(Number) : null;
function newer(version, current) {
  const a = versionParts(version), b = versionParts(current);
  if (!a || !b || !a.every(Number.isSafeInteger) || !b.every(Number.isSafeInteger)) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function verifyNotice(message, settings = config, now = Date.now()) {
  try {
    if (typeof message !== 'string' || Buffer.byteLength(message) > 4096) return null;
    const notice = JSON.parse(message);
    if (typeof notice.payload !== 'string' || typeof notice.signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(notice.signature)) return null;
    if (!crypto.verify(null, Buffer.from(notice.payload), settings.publicKey, Buffer.from(notice.signature, 'base64'))) return null;
    const release = JSON.parse(notice.payload);
    if (release.schema !== 1 || release.repository !== settings.repository || !versionParts(release.version)
      || release.tag !== 'v' + release.version || !Number.isSafeInteger(release.issuedAt) || release.issuedAt > now + 300000) return null;
    // Only metadata survives. URLs and commands in a notice can never change the updater's trusted feed.
    return { version: release.version, tag: release.tag };
  } catch { return null; }
}
function createReleasePush({ currentVersion, onRelease, onReconnect, settings = config, request = https.get,
  schedule = setTimeout, cancel = clearTimeout, random = Math.random }) {
  let active = false, connection, response, retry, attempts = 0, openedBefore = false, highest = currentVersion;
  const endpoint = new URL(`/${settings.topic}/json?since=latest`, settings.origin);
  function stopConnection() {
    const oldResponse = response, oldConnection = connection;
    response = connection = null;
    oldResponse?.destroy(); oldConnection?.destroy();
  }
  function connect() {
    if (!active) return;
    let buffer = '', failed = false;
    const disconnected = () => {
      if (failed || !active) return;
      failed = true;stopConnection();cancel(retry);
      const delay = Math.min(300000, 5000 * 2 ** Math.min(attempts++, 6)) * (.85 + random() * .3);
      retry = schedule(connect, delay);retry.unref?.();
    };
    try {
      connection = request(endpoint, { headers: { Accept: 'application/x-ndjson', 'User-Agent': 'AgentUsage/' + currentVersion } }, incoming => {
        if (!active || failed) { incoming.destroy();return; }
        response = incoming;
        if (incoming.statusCode !== 200) { disconnected();return; }
        incoming.setEncoding('utf8');
        incoming.on('data', chunk => {
          buffer += chunk;
          if (Buffer.byteLength(buffer) > 65536) { disconnected();return; }
          let end;
          while ((end = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, end);buffer = buffer.slice(end + 1);
            if (Buffer.byteLength(line) > 16384) continue;
            try {
              const event = JSON.parse(line);
              if (event.topic !== settings.topic) continue;
              if (event.event === 'open') {
                const recovered = attempts > 0;
                attempts = 0;
                if (openedBefore || recovered) onReconnect?.();
                openedBefore = true;
              } else if (event.event === 'message') {
                const release = verifyNotice(event.message, settings);
                if (release && newer(release.version, highest)) { highest = release.version;onRelease(release); }
              }
            } catch { /* Ignore malformed or unsigned public messages. */ }
          }
        });
        incoming.on('error', disconnected);incoming.on('end', disconnected);incoming.on('close', disconnected);
      });
      connection.on('error', disconnected);
      // ntfy sends keepalives; a silent connection after sleep or a network change must reconnect.
      connection.setTimeout(120000, disconnected);
    } catch { disconnected(); }
  }
  return {
    start() { if (active) return;active = true;connect(); },
    close() { active = false;cancel(retry);stopConnection(); }
  };
}
module.exports = { createReleasePush, verifyNotice, newer };
