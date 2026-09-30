'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { openSession, installHelper, codeCli } = require('../desktop/session-open.cjs');
const { sessionTarget, sessionUrl, historicalTarget } = require('../desktop/alerts.cjs');
const { handleLink } = require('../vscode-link/extension.js');
const id = '12345678-1234-5678-abcd-123456789012';
const target = { provider: 'claude', sessionId: id, terminalPids: [90, 80, 50], cwd: '/srv/project' };
test('session targets retain only validated terminal identity and workspace metadata', () => {
  assert.deepEqual(sessionTarget({...target,terminalPids:[90,90,-1,'80',80,Infinity],cwd:'/srv/project\n'}), {provider:'claude',sessionId:id,terminalPids:[90,80]});
  const url = new URL(sessionUrl(target));
  assert.equal(url.hostname,'f-petrozzi.agent-usage-link'); assert.equal(url.searchParams.get('pids'),'90,80,50');
  assert.equal(url.searchParams.get('cwd'),'/srv/project');
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
  let calls=0;const run=(exe,args,options,done)=>{calls++;assert.equal(options.env.ELECTRON_RUN_AS_NODE,'1');assert.equal(options.env.VSCODE_DEV,'');assert.equal(options.timeout,60000);assert.ok(args.includes('--install-extension'));done(null);};
  const deps={exists:()=>true,read:()=>'',env:{VSCODE_DEV:'1'}};
  await Promise.all([installHelper('/code/Code.exe','/helper.vsix',run,deps),installHelper('/code/Code.exe','/helper.vsix',run,deps)]);assert.equal(calls,1);
});
test('installer follows the installed CLI wrapper and reports the actual failure without caching it',async()=>{
  const path=require('node:path'),root=path.resolve('fixture-code'),executable=path.join(root,'Code.exe');
  const expected=path.join(root,'versioned','resources','app','out','cli.js');
  const deps={exists:p=>p===expected||p.endsWith('.vsix'),read:()=> '"%~dp0..\\versioned\\resources\\app\\out\\cli.js"'};
  assert.equal(codeCli(executable,deps),expected);
  let calls=0;const run=(exe,args,options,done)=>{calls++;assert.equal(args[0],expected);done(new Error('exit 1'),'','Actual install error: access denied');};
  for(let i=0;i<2;i++)await assert.rejects(installHelper(executable,'test.vsix',run,deps),/Actual install error: access denied/);
  assert.equal(calls,2,'failed installs can be retried');
  await assert.rejects(installHelper(executable,'missing.vsix',run,{exists:()=>false}),/bundled.*missing/);
});
test('VS Code helper focuses the matching terminal without sending text or starting a new terminal',async()=>{
  let shown=0,external=0;
  const vscode={workspace:{workspaceFolders:[{uri:{path:'/srv/project'}}]},window:{terminals:[{processId:Promise.resolve(80),show:focus=>{assert.equal(focus,false);shown++;}}],showInformationMessage:()=>{}},env:{openExternal:()=>{external++;}},Uri:{parse:x=>x}};
  const url=new URL(sessionUrl(target));await handleLink(vscode,{path:url.pathname,query:url.search.slice(1)});
  assert.equal(shown,1);assert.equal(external,0);
  vscode.workspace.workspaceFolders=[{uri:{path:'/symlink/workspace'}}];
  await handleLink(vscode,{path:url.pathname,query:url.search.slice(1)});assert.equal(shown,2,'a matching terminal pid also works when cwd is a symlink alias');
  vscode.workspace.workspaceFolders=[{uri:{path:'/srv/project'}}];
  vscode.window.terminals=[];await handleLink(vscode,{path:url.pathname,query:url.search.slice(1)});assert.equal(external,1);
  await handleLink(vscode,{path:'/open',query:'provider=claude&session=bad&pids=80'});assert.equal(external,1);
});
