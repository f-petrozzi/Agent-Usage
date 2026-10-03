'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { normalizeHistory, accountId, readSessionHistory } = require('../desktop/collector.cjs');
const { resumeUrl, openSession, createReceipt, installHelper } = require('../desktop/session-open.cjs');
const { parseResume, resumeCommand, handleResume, restoreResume, dispatchResume, sendReceipt } = require('../vscode-link/extension.js');
const { URI } = require('../desktop/node_modules/vscode-uri');
const id = '12345678-1234-5678-abcd-123456789012';
const target = { provider:'codex', sessionId:id, cwd:"/srv/client's $(project)", agentHome:'/home/me/profiles/b', source:'ssh', sshTarget:'me@lab' };
const uri = t => URI.parse(resumeUrl(t));
const encoded = payload => URI.parse('vscode://f-petrozzi.agent-usage-link/resume?target='+Buffer.from(JSON.stringify(payload)).toString('base64url'));
function routed(url) {
  let link=URI.parse(url),parameters=new URLSearchParams(link.query);
  // VS Code's electron-main protocol router consumes these fields before calling the extension.
  for(const name of ['session','windowId','continueOn'])parameters.delete(name);
  return URI.parse(link.with({query:parameters.toString()}).toString());
}
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
  assert.equal(parseResume(encoded({...parsed,remote:'ssh-remote+bad;exec'})),null);
  for(const reply of [{port:22,token:'a'.repeat(48)},{port:5000,token:'bad'},{port:Infinity,token:'a'.repeat(48)}])assert.equal(parseResume(encoded({...parsed,reply})),null);
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
  const untrusted=fixture();untrusted.vscode.workspace.isTrusted=false;await assert.rejects(handleResume(untrusted.vscode,untrusted.context,uri(target),0),/Trust this workspace/);
  assert.equal(untrusted.vscode.window.terminals.length,0);
});
test('history installs the helper even with no live terminal; missing Code is actionable',async()=>{
  const {EventEmitter}=require('node:events');let installed=0,args;
  const opened=await openSession({...target,resume:true},{},{locations:['/code/Code.exe'],exists:()=>true,
    receiptFactory:async()=>({result:Promise.resolve(true),close(){}}),
    ensureHelper:async()=>installed++,launch:(exe,a)=>{args=a;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}});
  assert.equal(opened,true);assert.equal(installed,1);assert.deepEqual(args,['--open-url','--',resumeUrl(target)]);
  await assert.rejects(openSession({...target,resume:true},{},{locations:[]}),/standard Windows VS Code/);
});
test('real VS Code URI decoding and protocol routing preserve SSH/WSL authorities and punctuation in paths',()=>{
  for(const t of [target,{...target,source:'wsl',wslDistro:'Ubuntu-24.04'},{...target,cwd:"/srv/a&b+100%#?é=project",agentHome:"/home/me/profiles/a+b%&"}]) {
    const url=resumeUrl(t),parsed=parseResume(routed(url+'&windowId=_blank'));
    assert.ok(parsed);assert.equal(parsed.cwd,t.cwd);assert.equal(parsed.home,t.agentHome);assert.equal(parsed.sessionId,id);
    assert.equal(parsed.remote,t.source==='wsl'?'wsl+Ubuntu-24.04':'ssh-remote+me@lab');
    assert.equal(new URL(url).searchParams.has('session'),false,'does not collide with VS Code’s own chat session parameter');
  }
  const old='vscode://f-petrozzi.agent-usage-link/resume?provider=codex&session='+id+'&cwd=%2Fsrv%2Fp&home=%2Fhome%2Fme&remote=ssh-remote%2Bme%40lab';
  assert.equal(parseResume(URI.parse(old)),null,'reproduces 3.3.7’s decoded SSH separator failure');
  assert.equal(parseResume(routed(old)),null,'and its consumed session id');
});
test('upgrading the helper requests a fresh VS Code window only on the first install call',async()=>{
  const exe='/new-install/Code.exe',helper='/new-helper.vsix';
  const run=(e,a,o,done)=>done(null,'');
  assert.equal(await installHelper(exe,helper,run,{exists:()=>true,read:()=>''}),true);
  assert.equal(await installHelper(exe,helper,run,{exists:()=>true,read:()=>''}),false);
});
test('desktop waits for the actual helper and reports errors instead of treating process spawn as success',async()=>{
  const {EventEmitter}=require('node:events'),f=fixture();let launched;
  const deps={locations:['/code/Code.exe'],exists:()=>true,ensureHelper:async()=>true,
    launch:(exe,args)=>{launched=args.at(-1);const child=new EventEmitter();child.unref=()=>{};
      queueMicrotask(()=>{child.emit('spawn');dispatchResume(f.vscode,f.context,routed(launched),0).catch(()=>{});});return child;}};
  assert.equal(await openSession({...target,resume:true},{},deps),true);
  assert.equal(new URL(launched).searchParams.get('windowId'),'_blank');
  assert.equal(f.calls.at(-1),'show');
  const failed=fixture();failed.vscode.workspace.isTrusted=false;
  await assert.rejects(openSession({...target,resume:true},{},{...deps,ensureHelper:async()=>false,
    launch:(exe,args)=>{const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>{child.emit('spawn');dispatchResume(failed.vscode,failed.context,routed(args.at(-1)),0).catch(()=>{});});return child;}}),/Trust this workspace/);
});
test('missing/old helpers time out with a useful instruction and unknown receipt tokens cannot confirm success',async()=>{
  const receipt=await createReceipt({initialMs:80});
  await sendReceipt({...receipt.reply,token:'0'.repeat(48)},'opened');
  await assert.rejects(receipt.result,/VS Code did not respond.*Reload Window/);receipt.close();
});
test('a remote window handoff acknowledges receipt but only confirms success after restoring its session terminal',async()=>{
  const receipt=await createReceipt(),f=fixture(false);
  try{
    const link=routed(resumeUrl(target,receipt.reply));let opened=false;
    receipt.result.then(()=>{opened=true;});
    assert.equal(await dispatchResume(f.vscode,f.context,link,0),false);
    assert.equal(opened,false);assert.equal(f.vscode.window.terminals.length,0);
    assert.ok(f.store.get('pendingResume'));
    f.vscode.workspace.workspaceFolders=[{uri:{scheme:'vscode-remote',authority:'ssh-remote+me@lab',path:target.cwd}}];
    await restoreResume(f.vscode,f.context);
    assert.equal(await receipt.result,true);assert.equal(f.calls.at(-1),'show');assert.equal(f.store.has('pendingResume'),false);
  }finally{receipt.close();}
});
