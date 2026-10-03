'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { HELPER, openSession, installHelper, codeCli } = require('../desktop/session-open.cjs');
const { sessionTarget, sessionUrl, historicalTarget } = require('../desktop/alerts.cjs');
const { handleLink, parseLink } = require('../vscode-link/extension.js');
const { URI } = require('../desktop/node_modules/vscode-uri');
const id = '12345678-1234-5678-abcd-123456789012';
const target = { provider: 'claude', sessionId: id, terminalPids: [90, 80, 50], cwd: '/srv/project' };
test('session targets retain only validated terminal identity and workspace metadata', () => {
  assert.deepEqual(sessionTarget({...target,terminalPids:[90,90,-1,'80',80,Infinity],cwd:'/srv/project\n'}), {provider:'claude',sessionId:id,terminalPids:[90,80]});
  const url = new URL(sessionUrl(target));
  assert.equal(url.hostname,'f-petrozzi.agent-usage-link');
  const link=parseLink(URI.parse(url.href));assert.deepEqual(link.pids,[90,80,50]);assert.equal(link.cwd,'/srv/project');
});
test('old completions restore only a unique account, name and recorded completion time', () => {
  const entry = {kind:'completion',account:'codex-a',session:'project',at:100000};
  const session = {provider:'codex',sessionId:id,account:'codex-a',name:'project',state:'idle',since:99500};
  assert.equal(historicalTarget(entry,[session]).sessionId,id);
  for(const changed of [{account:'codex-b'},{name:'elsewhere'},{state:'busy'},{since:70000}])assert.equal(historicalTarget(entry,[{...session,...changed}]),null);
  assert.equal(historicalTarget(entry,[session,{...session,sessionId:'23456789-1234-5678-abcd-123456789012'}]),null);
  assert.equal(historicalTarget({...entry,kind:'quota'},[session]),null);
});
test('opening uses installed Code directly, installs the bundled helper once, and supplies no prompt', async () => {
  const calls=[];
  const launch=(exe,args,options)=>{calls.push([exe,args,options]);const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;};
  let installed=0;
  assert.equal(await openSession(target,{}, {locations:['/code/Code.exe'],exists:()=>true,launch,ensureHelper:async()=>{installed++;}}),true);
  assert.equal(installed,1);assert.deepEqual(calls[0][1],['--open-url','--',sessionUrl(target)]);
  await assert.rejects(openSession(target,{}, {locations:[],protocolName:()=>''}),/VS Code was not found/);
  assert.equal(await openSession({provider:'shell',sessionId:id},{},{locations:[]}),false);
});
test('helper installation uses Code CLI without shell evaluation and coalesces calls',async()=>{
  const calls=[];const run=(exe,args,options,done)=>{calls.push(args.slice(1));assert.equal(options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(options.env.VSCODE_DEV,'');assert.equal(options.timeout,60000);done(null,'');};
  const deps={exists:()=>true,read:()=>'',env:{VSCODE_DEV:'1'}};
  await Promise.all([installHelper('/code/Code.exe','/helper.vsix',run,deps),installHelper('/code/Code.exe','/helper.vsix',run,deps)]);
  assert.deepEqual(calls,[['--list-extensions','--show-versions'],['--install-extension','/helper.vsix','--force']],'asks what is installed, then installs once');
});
test('the bundled helper is installed only when VS Code lacks that version, never again on each launch',async()=>{
  assert.equal(HELPER.version,require('../vscode-link/package.json').version,'the app knows the version it ships');
  assert.equal(HELPER.id,`${require('../vscode-link/package.json').publisher}.${require('../vscode-link/package.json').name}`);
  const attempt=async(listing,listFails=false)=>{const calls=[];const run=(exe,args,options,done)=>{calls.push(args[1]);args[1]==='--list-extensions'&&listFails?done(new Error('no cli')):done(null,args[1]==='--list-extensions'?listing:'');};
    await installHelper('/code-'+Math.random()+'/Code.exe','/helper.vsix',run,{exists:()=>true,read:()=>''});return calls;};
  assert.deepEqual(await attempt(`ms-python.python@2026.1.0\r\nF-Petrozzi.Agent-Usage-Link@${HELPER.version}\r\n`),['--list-extensions'],'already there: nothing replaced under a running window');
  assert.deepEqual(await attempt('f-petrozzi.agent-usage-link@0.0.9\n'),['--list-extensions','--install-extension'],'an older helper is updated');
  assert.deepEqual(await attempt('',true),['--list-extensions','--install-extension'],'a failed listing still installs');
});
test('installer follows the installed CLI wrapper and reports the actual failure without caching it',async()=>{
  const path=require('node:path'),root=path.resolve('fixture-code'),executable=path.join(root,'Code.exe');
  const expected=path.join(root,'versioned','resources','app','out','cli.js');
  const deps={exists:p=>p===expected||p.endsWith('.vsix'),read:()=> '"%~dp0..\\versioned\\resources\\app\\out\\cli.js"'};
  assert.equal(codeCli(executable,deps),expected);
  let calls=0;const run=(exe,args,options,done)=>{calls++;assert.equal(args[0],expected);done(new Error('exit 1'),'','Actual install error: access denied');};
  for(let i=0;i<2;i++)await assert.rejects(installHelper(executable,'test.vsix',run,deps),/Actual install error: access denied/);
  assert.equal(calls,4,'failed installs can be retried (each attempt lists, then installs)');
  await assert.rejects(installHelper(executable,'missing.vsix',run,{exists:()=>false}),/bundled.*missing/);
});
test('VS Code helper focuses the matching terminal without sending text or starting a new terminal',async()=>{
  let shown=0,external=0;
  const vscode={workspace:{workspaceFolders:[{uri:{path:'/srv/project'}}]},window:{terminals:[{processId:Promise.resolve(80),show:focus=>{assert.equal(focus,false);shown++;}}],showInformationMessage:()=>{}},env:{openExternal:()=>{external++;}},Uri:{parse:x=>x}};
  const url=URI.parse(sessionUrl(target));await handleLink(vscode,url);
  assert.equal(shown,1);assert.equal(external,0);
  vscode.workspace.workspaceFolders=[{uri:{path:'/symlink/workspace'}}];
  await handleLink(vscode,url);assert.equal(shown,2,'a matching terminal pid also works when cwd is a symlink alias');
  vscode.workspace.workspaceFolders=[{uri:{path:'/srv/project'}}];
  vscode.window.terminals=[];await handleLink(vscode,url);assert.equal(external,1);
  await handleLink(vscode,{path:'/open',query:'provider=claude&session=bad&pids=80'});assert.equal(external,1);
});
test('a link that wakes VS Code waits for its restored terminals before falling back',async()=>{
  const uri=URI.parse(sessionUrl(target));
  let shown=0,external=0;const listeners=new Set();
  const vscode={workspace:{workspaceFolders:[{uri:{path:'/srv/project'}}]},window:{terminals:[],showInformationMessage:()=>{},
    onDidOpenTerminal:cb=>{listeners.add(cb);return {dispose:()=>listeners.delete(cb)};}},env:{openExternal:()=>{external++;}},Uri:{parse:x=>x}};
  // Still starting: the workspace reconnects and its terminal (one still resolving its pid) comes back
  setTimeout(()=>{vscode.window.terminals=[{processId:new Promise(()=>{}),show(){}},{processId:new Promise(r=>setTimeout(()=>r(80),50)),show:()=>{shown++;}}];listeners.forEach(cb=>cb());},150);
  const started=Date.now();await handleLink(vscode,uri,Date.now()+5000);
  assert.deepEqual([shown,external],[1,0],'the restored terminal is focused');assert.ok(Date.now()-started<2500,'as soon as it is back');
  assert.equal(listeners.size,0,'and stops listening');
  // Nothing comes back before the startup window ends: then the conversation
  vscode.window.terminals=[];const waited=Date.now();await handleLink(vscode,uri,Date.now()+400);
  assert.equal(external,1);assert.ok(Date.now()-waited>=380,'waited out the startup window first');
});
