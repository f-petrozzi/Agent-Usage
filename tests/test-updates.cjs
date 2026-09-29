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
