'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createUpdates } = require('../desktop/updates.cjs');
function setup() {
  const updater = new EventEmitter();let installs=0, downloads=0;
  updater.checkForUpdates = async () => { updater.emit('checking-for-update');updater.emit('update-available',{version:'3.0.1'}); };
  updater.downloadUpdate = async () => { downloads++;updater.emit('update-downloaded',{version:'3.0.1'}); };
  updater.quitAndInstall = (silent,restart) => { assert.equal(silent,true);assert.equal(restart,true);installs++; };
  const updates=createUpdates({app:{getVersion:()=> '3.0.0'},updater,installed:true,onChange:()=>{}});
  return {updater,updates,counts:()=>({installs,downloads})};
}
test('check never downloads; download never installs; restart requires a verified download',async()=>{
  const {updater,updates,counts}=setup();
  updates.install();await updates.download();assert.deepEqual(counts(),{installs:0,downloads:0});
  await updates.check();assert.equal(updates.get().status,'available');assert.equal(counts().downloads,0);
  assert.equal(updater.autoDownload,false);assert.equal(updater.autoInstallOnAppQuit,false);
  assert.equal(updater.allowDowngrade,false);assert.equal(updater.disableWebInstaller,true);
  await updates.download();assert.equal(updates.get().status,'ready');assert.equal(counts().installs,0);
  updates.install();updates.install();assert.equal(counts().installs,1);
});
test('download or verification failure prevents installation and permits retry',async()=>{
  const {updater,updates,counts}=setup();await updates.check();
  updater.downloadUpdate=async()=>{throw Error('checksum mismatch');};
  await updates.download();updates.install();assert.equal(updates.get().status,'error');assert.equal(counts().installs,0);
  await updates.check();assert.equal(updates.get().status,'available');
});
test('concurrent checks coalesce and manual builds cannot invoke the updater',async()=>{
  const {updater,updates}=setup();let finish,count=0;
  updater.checkForUpdates=()=>{count++;return new Promise(resolve=>{finish=resolve;});};
  const first=updates.check();await updates.check();assert.equal(count,1);finish();await first;
  const unmanaged=createUpdates({app:{getVersion:()=> '3.0.0'},updater,installed:false,onChange:()=>{}});
  await unmanaged.check();await unmanaged.download();unmanaged.install();assert.equal(count,1);assert.equal(unmanaged.get().status,'unavailable');
});
test('installed apps check once at startup and on push/reconnect, with no recurring feed polling',async()=>{
  const updater=new EventEmitter();let checks=0,callbacks,starts=0,closes=0,clock=1000000;
  updater.checkForUpdates=async()=>{checks++;updater.emit('update-not-available');};
  const timers=[];
  const updates=createUpdates({app:{getVersion:()=> '3.3.9'},updater,installed:true,onChange:()=>{},now:()=>clock,
    schedule:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},cancel:t=>{if(t)t.cancelled=true;},
    pushFactory:args=>{callbacks=args;return{start:()=>starts++,close:()=>closes++};}});
  updates.start();updates.start();assert.equal(starts,1);assert.equal(checks,0);assert.equal(timers.length,1);assert.equal(timers[0].ms,30000);
  timers[0].fn();await Promise.resolve();assert.equal(checks,1);
  callbacks.onRelease({version:'3.3.10'});await Promise.resolve();assert.equal(checks,2);assert.equal(timers[0].cancelled,true);
  callbacks.onReconnect();await Promise.resolve();assert.equal(checks,2,'connection flapping cannot spam the feed');
  clock+=16*60000;callbacks.onReconnect();await Promise.resolve();assert.equal(checks,3);assert.equal(timers.length,1,'there is no six-hour recurring timer');
  updates.close();assert.equal(closes,1);
});
