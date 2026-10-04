'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const path=require('node:path');
const {createInputMonitor}=require('../desktop/platform-input.cjs');
const {collectorCommand,canInstallUpdates}=require('../desktop/platform-runtime.cjs');
const {codeLocations,codeCli}=require('../desktop/platform-vscode.cjs');
function harness(){
 const children=[],timers=new Set(),inputs=[],problems=[];let resets=0,current;
 const schedule=(fn,delay)=>{const timer={fn,delay,unref(){}};timers.add(timer);return timer;};
 const cancel=t=>timers.delete(t);
 const monitor=createInputMonitor({executable:'InputMonitor.exe',owner:100,schedule,cancel,
  launch:()=>{const c=new EventEmitter();c.stderr=new EventEmitter();c.stdout=new EventEmitter();c.kill=()=>c.emit('exit',null,'killed');children.push(c);return c;},
  onChild:c=>current=c,onInput:v=>inputs.push(v),onReset:()=>resets++,onProblem:p=>problems.push(p)});
 return {monitor,children,timers,inputs,problems,get resets(){return resets;},get current(){return current;},run(){const t=[...timers][0];assert.ok(t);timers.delete(t);t.fn();return t.delay;},ready(){children.at(-1).stderr.emit('data','sessions-ready hotkey=1 hook=1 thread=20\n');}};
}
test('a failed input helper resets held state, loses readiness and reconnects without stale child reports',()=>{
 const h=harness();h.monitor.configure('Scrolllock');assert.equal(h.monitor.ready,false);h.ready();assert.equal(h.monitor.ready,true);
 const old=h.current;old.stdout.emit('data','100\n');assert.deepEqual(h.inputs,['100']);const resets=h.resets;
 old.emit('exit',1,null);assert.equal(h.monitor.ready,false);assert.equal(h.current,null);assert.equal(h.resets,resets+1);
 assert.equal(h.run(),1000);h.ready();const replacement=h.current;
 old.emit('exit',2,null);old.stderr.emit('data','sessions-ready hotkey=0 hook=0 thread=20\n');old.stdout.emit('data','111\n');
 assert.equal(h.current,replacement);assert.equal(h.monitor.ready,true);assert.deepEqual(h.inputs,['100']);
 h.monitor.close();assert.equal(h.timers.size,0);assert.equal(h.monitor.ready,false);
});
test('silent input startup has bounded retries and explicit reconfiguration recovers',()=>{
 const h=harness();h.monitor.configure('Scrolllock');
 for(let attempt=0;attempt<6;attempt++){assert.equal(h.run(),5000);if(attempt<5)assert.equal(h.run(),Math.min(16000,1000*2**attempt));}
 assert.equal(h.children.length,6);assert.equal(h.timers.size,0);assert.match(h.problems.at(-1),/Settings to retry/);
 h.monitor.configure('Shift+F1');h.ready();assert.equal(h.monitor.ready,true);h.monitor.close();assert.equal(h.timers.size,0);
});
test('shortcut registration failure is reported without claiming readiness',()=>{
 const h=harness();h.monitor.configure('Scrolllock');h.current.stderr.emit('data','sessions-ready hotkey=0 hook=0 thread=20\n');
 assert.equal(h.monitor.ready,false);assert.match(h.problems.at(-1),/not register/);assert.equal(h.timers.size,0);h.monitor.close();
});
test('collector transport and install capabilities are explicit for each operating system',()=>{
 const cfg={source:'ssh',sshTarget:'lab'};
 assert.equal(collectorCommand(cfg,'--compact',[],'win32')[0],'ssh.exe');
 for(const platform of ['linux','darwin'])assert.equal(collectorCommand(cfg,'--compact',[],platform)[0],'ssh');
 assert.equal(collectorCommand({source:'wsl'},'--compact',[],'darwin'),null);
 assert.equal(collectorCommand({source:'wsl'},'--compact',[],'win32')[0],'wsl.exe');
 for(const platform of ['darwin','linux'])assert.equal(canInstallUpdates({platform,packaged:true,exists:()=>true,resource:x=>x}),false);
 assert.equal(canInstallUpdates({platform:'win32',packaged:true,exists:()=>true,resource:x=>x}),true);
 assert.equal(canInstallUpdates({platform:'win32',packaged:false,exists:()=>true,resource:x=>x}),false);
});
test('VS Code discovery resolves Windows and Mac bundle layouts without changing session routes',()=>{
 const windows=codeLocations({LOCALAPPDATA:'/users/local'},'win32');assert.equal(windows[0],path.join('/users/local','Programs','Microsoft VS Code','Code.exe'));
 const mac=codeLocations({HOME:'/Users/test'},'darwin');assert.equal(mac.length,2);assert.equal(mac[0],'/Applications/Visual Studio Code.app/Contents/MacOS/Electron');
 const cli=path.join(path.dirname(mac[0]),'..','Resources','app','out','cli.js');
 assert.equal(codeCli(mac[0],{exists:p=>p===cli,read:()=>{throw new Error('no Windows wrapper');}}),cli);
});
