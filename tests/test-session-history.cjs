'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { normalizeHistory, accountId, readSessionHistory } = require('../desktop/collector.cjs');
const { resumeUrl, openSession } = require('../desktop/session-open.cjs');
const { parseResume, resumeCommand, handleResume, restoreResume } = require('../vscode-link/extension.js');
const id = '12345678-1234-5678-abcd-123456789012';
const target = { provider:'codex', sessionId:id, cwd:"/srv/client's $(project)", agentHome:'/home/me/profiles/b', source:'ssh', sshTarget:'me@lab' };
const uri = t => { const url = new URL(resumeUrl(t)); return { path:url.pathname, query:url.search.slice(1) }; };
function fixture(folder = true) {
  const terminals=[], calls=[], store=new Map();
  const folderUri={scheme:'vscode-remote',authority:'ssh-remote+me@lab',path:target.cwd};
  return { calls, store, context:{globalState:{get:k=>store.get(k),update:async(k,v)=>v===undefined?store.delete(k):store.set(k,v)}},
    vscode:{workspace:{isTrusted:true,workspaceFolders:folder?[{uri:folderUri}]:[]},Uri:{from:x=>x},
      commands:{executeCommand:async(...args)=>calls.push(args)},window:{terminals,showInformationMessage:message=>calls.push(message),
        createTerminal:options=>{calls.push(options);const t={show:()=>calls.push('show')};terminals.push(t);return t;}}} };
}
test('history keeps account-specific closed metadata, sorts, bounds and deduplicates sessions',()=>{
  const session={provider:'codex',account:'codex:b',id,sessionId:id,state:'idle',cwd:target.cwd,agentHome:target.agentHome,since:100};
  const rows=normalizeHistory({schema:1,sessions:[session,session,...Array.from({length:40},(_,i)=>({...session,id:String(i),since:i})),{...session,account:'codex:a'}]});
  assert.equal(rows.filter(s=>s.account===accountId('codex','codex:b')).length,30);
  assert.equal(rows.filter(s=>s.account===accountId('codex','codex:a')).length,1);
  assert.equal(rows.find(s=>s.id===id).cwd,target.cwd);assert.equal(rows.find(s=>s.id===id).agentHome,target.agentHome);
  assert.equal(rows.find(s=>s.id===id).terminalPids,undefined);
  assert.throws(()=>normalizeHistory({schema:2,sessions:[]}));
});
test('collector uses the history flag and explains unsupported old collectors',async()=>{
  let args;
  const got=await readSessionHistory({source:'ssh',sshTarget:'lab'},(exe,a,opts,cb)=>{args=a;cb(null,'{"schema":1,"sessions":[],"wslDistro":"Ubuntu-24.04"}');});
  assert.equal(args.at(-1),'~/.local/bin/agent-usage --session-history --compact');assert.equal(got.wslDistro,'Ubuntu-24.04');
  await assert.rejects(readSessionHistory({source:'ssh',sshTarget:'lab'},(e,a,o,cb)=>cb(new Error('unrecognized arguments'))),/Update agent-usage/);
});
test('resume URLs retain the correct account and reject injected hosts, paths and invalid identities',()=>{
  const parsed=parseResume(uri(target));assert.equal(parsed.home,target.agentHome);assert.equal(parsed.remote,'ssh-remote+me@lab');
  assert.ok(resumeUrl({...target,source:'wsl',wslDistro:'Ubuntu-24.04'}));
  for(const delta of [{sshTarget:'lab;touch /tmp/x'},{cwd:'/srv/p\nexec x'},{agentHome:'relative'},{sessionId:'not-a-uuid'},{provider:'shell'}])assert.equal(resumeUrl({...target,...delta}),null);
  const agy=parseResume(uri({...target,provider:'antigravity'}));assert.equal(agy.provider,'antigravity');assert.equal(resumeCommand(agy),`exec agy --conversation '${id}'`);
  assert.equal(parseResume({path:'/resume',query:uri(target).query+'&remote=bad'}).remote,parsed.remote,'first query value is used');
  assert.equal(parseResume({path:'/resume',query:uri(target).query.replace('ssh-remote%2Bme%40lab','ssh-remote%2Bbad%3Bexec')}),null);
});
test('closed sessions resume in a new terminal using the selected account, without a prompt',async()=>{
  const f=fixture();await handleResume(f.vscode,f.context,uri(target),0);
  const options=f.calls[0];assert.equal(options.shellPath,'/bin/bash');assert.deepEqual(options.shellArgs,['-ilc',"exec env CODEX_HOME='/home/me/profiles/b' codex resume '"+id+"'"]);
  assert.equal(options.cwd.path,target.cwd);assert.equal(f.calls[1],'show');
  await handleResume(f.vscode,f.context,uri(target),0);assert.equal(f.calls.filter(c=>typeof c==='object').length,1,'repeat click focuses the same terminal');
  const command=resumeCommand({...parseResume(uri(target)),provider:'claude',home:"/home/me/a'$(touch /tmp/x)"});
  assert.equal(command,"exec env CLAUDE_CONFIG_DIR='/home/me/a'\\''$(touch /tmp/x)' claude --resume '"+id+"'");
});
test('remote workspace handoff persists once, restores after Code starts, and does not resume in other windows',async()=>{
  const f=fixture(false);await handleResume(f.vscode,f.context,uri(target),0);
  assert.equal(f.calls[0][0],'vscode.openFolder');assert.equal(f.calls[0][1].authority,'ssh-remote+me@lab');assert.deepEqual(f.calls[0][2],{forceNewWindow:true});
  assert.ok(f.store.get('pendingResume'));await restoreResume(f.vscode,f.context);assert.ok(f.store.get('pendingResume'));
  f.vscode.workspace.workspaceFolders=[{uri:{scheme:'vscode-remote',authority:'ssh-remote+me@lab',path:target.cwd}}];
  await restoreResume(f.vscode,f.context);assert.equal(f.store.has('pendingResume'),false);assert.equal(f.calls.at(-1),'show');
  const before=f.calls.length;await restoreResume(f.vscode,f.context);assert.equal(f.calls.length,before);
});
test('history focuses a live terminal only on the matching host, and honors workspace trust',async()=>{
  const f=fixture();let shown=0;f.vscode.window.terminals.push({processId:Promise.resolve(80),show:()=>shown++});
  await handleResume(f.vscode,f.context,uri({...target,terminalPids:[80]}),0);assert.equal(shown,1);assert.equal(f.calls.length,0);
  f.vscode.workspace.workspaceFolders[0].uri.authority='ssh-remote+other';
  await handleResume(f.vscode,f.context,uri({...target,terminalPids:[80]}),0);assert.equal(shown,1);assert.equal(f.calls[0][0],'vscode.openFolder');
  const untrusted=fixture();untrusted.vscode.workspace.isTrusted=false;await handleResume(untrusted.vscode,untrusted.context,uri(target),0);
  assert.match(untrusted.calls[0],/Trust this workspace/);assert.equal(untrusted.vscode.window.terminals.length,0);
});
test('history installs the helper even with no live terminal; missing Code is actionable',async()=>{
  const {EventEmitter}=require('node:events');let installed=0,args;
  const opened=await openSession({...target,resume:true},{},{locations:['/code/Code.exe'],exists:()=>true,
    ensureHelper:async()=>installed++,launch:(exe,a)=>{args=a;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}});
  assert.equal(opened,true);assert.equal(installed,1);assert.deepEqual(args,['--open-url','--',resumeUrl(target)]);
  await assert.rejects(openSession({...target,resume:true},{},{locations:[]}),/standard Windows VS Code/);
});
