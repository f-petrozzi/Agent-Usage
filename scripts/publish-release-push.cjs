'use strict';
const crypto = require('node:crypto');
const config = require('../desktop/release-push-config.cjs');
function signNotice(version, privateKey, issuedAt = Date.now(), settings = config) {
  const { version: expected } = require('../desktop/package.json');
  if (version !== expected || !/^\d+\.\d+\.\d+$/.test(version)) throw Error('Notice must match the packaged stable release');
  if (crypto.createPublicKey(privateKey).export({type:'spki',format:'pem'}) !== settings.publicKey) throw Error('Release signing key does not match the app verification key');
  const payload = JSON.stringify({schema:1,repository:settings.repository,tag:'v'+version,version,issuedAt});
  return JSON.stringify({payload,signature:crypto.sign(null,Buffer.from(payload),privateKey).toString('base64')});
}
async function publishNotice(tag, privateKey) {
  if (!tag?.startsWith('v')) throw Error('Expected a stable release tag');
  const body = signNotice(tag.slice(1), privateKey);
  const result = await fetch(new URL('/' + config.topic, config.origin), {method:'POST',body,
    headers:{'Content-Type':'text/plain; charset=utf-8'},signal:AbortSignal.timeout(30000)});
  if (!result.ok) throw Error('Release relay returned HTTP ' + result.status);
  console.log('Published signed release notice for ' + tag);
}
if (require.main === module) {
  const key = process.env.AGENT_USAGE_RELEASE_PUSH_KEY;
  if (!key) throw Error('Missing release signing secret');
  publishNotice(process.env.RELEASE_TAG, key).catch(error => {console.error(error.message);process.exitCode = 1;});
}
module.exports = { signNotice, publishNotice };
