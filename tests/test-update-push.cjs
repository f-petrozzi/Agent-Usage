'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {EventEmitter}=require('node:events');
const {createReleasePush,verifyNotice,newer}=require('../desktop/update-push.cjs');
const {signNotice}=require('../scripts/publish-release-push.cjs');
const keys=crypto.generateKeyPairSync('ed25519');
const settings={origin:'https://ntfy.sh',topic:'test-release-notices',repository:'f-petrozzi/Agent-Usage',publicKey:keys.publicKey.export({type:'spki',format:'pem'})};
function notice(delta={},key=keys.privateKey){
  const payload=JSON.stringify({schema:1,repository:settings.repository,version:'3.3.10',tag:'v3.3.10',issuedAt:Date.now(),...delta});
  return JSON.stringify({payload,signature:crypto.sign(null,Buffer.from(payload),key).toString('base64')});
}
test('only correctly signed stable notices for this repository survive, and version ordering is numeric',()=>{
  assert.deepEqual(verifyNotice(notice(),settings),{version:'3.3.10',tag:'v3.3.10'});
  for(const message of ['bad',JSON.stringify({payload:'{}',signature:'bad'}),'x'.repeat(5000),notice({},crypto.generateKeyPairSync('ed25519').privateKey),
    notice({repository:'other/repo'}),notice({version:'3.3.10-beta',tag:'v3.3.10-beta'}),notice({tag:'v3.3.11'}),notice({schema:2}),notice({issuedAt:Date.now()+600000})])assert.equal(verifyNotice(message,settings),null);
  const modified=JSON.parse(notice());modified.payload=modified.payload.replace('3.3.10','9.9.9');assert.equal(verifyNotice(JSON.stringify(modified),settings),null);
  assert.deepEqual(verifyNotice(notice({url:'https://evil.test/installer',command:'exec x'}),settings),{version:'3.3.10',tag:'v3.3.10'});
  assert.equal(newer('3.3.10','3.3.9'),true);assert.equal(newer('3.10.0','3.9.0'),true);
  for(const version of ['3.3.9','3.3.8','4.0.0-beta','999999999999999999999.0.0'])assert.equal(newer(version,'3.3.9'),false);
});
test('publisher signs the packaged version and refuses a signing key that does not match the app',()=>{
  const version=require('../desktop/package.json').version;
  assert.deepEqual(verifyNotice(signNotice(version,keys.privateKey,Date.now(),settings),settings),{version,tag:'v'+version});
  assert.throws(()=>signNotice('999.0.0',keys.privateKey,Date.now(),settings),/packaged stable release/);
  assert.throws(()=>signNotice(version,crypto.generateKeyPairSync('ed25519').privateKey,Date.now(),settings),/verification key/);
});
function streamFixture(){
  const requests=[],releases=[],timers=[];let reconnects=0;
  const push=createReleasePush({currentVersion:'3.3.9',settings,onRelease:x=>releases.push(x),onReconnect:()=>reconnects++,random:()=>.5,
    schedule:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},cancel:t=>{if(t)t.cancelled=true;},
    request:(url,options,callback)=>{
      const req=new EventEmitter(),res=new EventEmitter();req.destroy=()=>req.emit('close');res.destroy=()=>res.emit('close');req.setTimeout=(ms,fn)=>{req.timeout=fn;};res.setEncoding=()=>{};res.statusCode=200;
      requests.push({url,options,req,res,callback,send:event=>res.emit('data',JSON.stringify({topic:settings.topic,...event})+'\n')});queueMicrotask(()=>callback(res));return req;
    }});
  return {push,requests,releases,timers,reconnects:()=>reconnects};
}
test('streaming handles chunk boundaries, rejects forgeries, deduplicates releases and reconnects with catch-up',async()=>{
  const f=streamFixture();f.push.start();f.push.start();await Promise.resolve();assert.equal(f.requests.length,1);
  const r=f.requests[0];assert.equal(r.url.protocol,'https:');assert.equal(r.url.search,'?since=latest');
  r.send({event:'open'});r.send({event:'keepalive'});r.send({event:'message',message:'forged'});r.send({event:'message',message:notice({version:'3.3.8',tag:'v3.3.8'})});
  const line=JSON.stringify({topic:settings.topic,event:'message',message:notice()})+'\n';
  r.res.emit('data',line.slice(0,31));assert.equal(f.releases.length,0);r.res.emit('data',line.slice(31));assert.equal(f.releases.length,1);
  r.send({event:'message',message:notice()});assert.equal(f.releases.length,1);
  r.res.emit('end');r.res.emit('error',Error('offline'));assert.equal(f.timers.length,1);assert.equal(f.timers[0].ms,5000);
  f.timers[0].fn();await Promise.resolve();const next=f.requests[1];next.send({event:'open'});assert.equal(f.reconnects(),1);
  next.send({event:'message',message:notice()});assert.equal(f.releases.length,1);
  next.send({event:'message',message:notice({version:'3.3.11',tag:'v3.3.11'})});assert.equal(f.releases.length,2);
  f.push.close();assert.equal(f.timers.length,1,'closing does not schedule another connection');
});
test('silent streams and oversized buffers reconnect instead of hanging or retaining arbitrary data',async()=>{
  const f=streamFixture();f.push.start();await Promise.resolve();f.requests[0].req.timeout();assert.equal(f.timers.length,1);
  f.timers[0].fn();await Promise.resolve();f.requests[1].res.emit('data','x'.repeat(65537));assert.equal(f.timers.length,2);assert.equal(f.releases.length,0);
  f.push.close();assert.equal(f.timers.at(-1).cancelled,true);
});
test('the first successful connection after startup offline also catches up missed releases',async()=>{
  const f=streamFixture();f.push.start();await Promise.resolve();
  f.requests[0].req.emit('error',Error('network offline'));
  f.timers[0].fn();await Promise.resolve();f.requests[1].send({event:'open'});
  assert.equal(f.reconnects(),1,'recovery does not require an earlier successful connection');f.push.close();
});
