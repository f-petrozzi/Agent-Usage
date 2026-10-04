'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { normalizeHistory, accountId, readSessionHistory } = require('../desktop/collector.cjs');
const { resumeUrl, openSession, createReceipt, installHelper, prepareHelper } = require('../desktop/session-open.cjs');
const { parseResume, resumeCommand, handleResume, restoreResume, dispatchResume, sendReceipt, sshConnection } = require('../vscode-link/extension.js');
const { URI } = require('../desktop/node_modules/vscode-uri');
const id = '12345678-1234-5678-abcd-123456789012';
const target = { provider:'codex', sessionId:id, cwd:"/srv/client's $(project)", agentHome:'/home/me/profiles/b', source:'ssh', sshTarget:'me@lab' };
const linuxHost={platform:'linux',home:'/home/me'}, windowsHost={platform:'win32',home:'C:/Users/me'};
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
    vscode:{workspace:{isTrusted:true,workspaceFolders:folder?[{uri:folderUri}]:[]},Uri:{from:x=>x,file:path=>({scheme:'file',path})},
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
  const custom=parseResume(uri({...target,provider:'claude',agentHome:"/home/me/a'$(touch /tmp/x)"}));
  assert.ok(resumeCommand(custom).includes("CLAUDE_CONFIG_DIR='/home/me/a'\\''$(touch /tmp/x)'"));
});
test('remote workspace handoff persists once, restores after Code starts, and does not resume in other windows',async()=>{
  const f=fixture(false);await handleResume(f.vscode,f.context,uri(target),0,linuxHost);
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
  await handleResume(f.vscode,f.context,uri({...target,terminalPids:[80]}),0,linuxHost);assert.equal(shown,1);assert.equal(f.calls[0][0],'vscode.openFolder');
  const untrusted=fixture();untrusted.vscode.workspace.isTrusted=false;await assert.rejects(handleResume(untrusted.vscode,untrusted.context,uri(target),0),/Trust this workspace/);
  assert.equal(untrusted.vscode.window.terminals.length,0);
});
test('equivalent SSH aliases focus the existing live terminal and use the window authority for closed sessions',async()=>{
  const f=fixture(),aliases=[];
  f.vscode.workspace.workspaceFolders[0].uri.authority='ssh-remote+lab';
  const connection=async(alias,platform)=>{aliases.push(alias);assert.equal(platform,'win32');return 'same-host-and-user';};
  let shown=0;
  f.vscode.window.terminals.push({processId:Promise.resolve(80),show:()=>shown++});
  await handleResume(f.vscode,f.context,uri({...target,live:true,terminalPids:[80]}),0,windowsHost,connection);
  assert.equal(shown,1);assert.equal(f.calls.length,0);assert.deepEqual(aliases,['me@lab','lab']);
  await handleResume(f.vscode,f.context,uri(target),0,windowsHost,connection);
  assert.equal(f.calls[0].cwd.authority,'ssh-remote+lab');assert.equal(f.calls[0].shellPath,'/bin/bash');
});
test('the terminal holding the session takes precedence over a restored failed duplicate with the same scope',async()=>{
  const f=fixture();let shown=0;
  const scope=JSON.stringify(['codex','ssh-remote+me@lab',target.agentHome,id]);
  f.vscode.window.terminals.push({processId:Promise.resolve(70),creationOptions:{env:{AGENT_USAGE_SESSION_SCOPE:scope}},show:()=>assert.fail('must not focus the duplicate')});
  f.vscode.window.terminals.push({processId:Promise.resolve(80),show:()=>shown++});
  await handleResume(f.vscode,f.context,uri({...target,live:true,terminalPids:[90,80]}),0);
  assert.equal(shown,1);assert.equal(f.calls.length,0);
});
test('live sessions cannot launch duplicates when their terminal is missing, exited, on another host, or SSH lookup fails',async()=>{
  for(const condition of ['missing','exited','other host','lookup failed']){
    const f=fixture();let shown=0;
    if(condition!=='missing')f.vscode.window.terminals.push({processId:Promise.resolve(80),
      ...(condition==='exited'?{exitStatus:{code:0}}:{}),show:()=>shown++});
    if(condition==='other host'||condition==='lookup failed')f.vscode.workspace.workspaceFolders[0].uri.authority='ssh-remote+other';
    const lookup=async alias=>condition==='lookup failed'?null:alias;
    await assert.rejects(handleResume(f.vscode,f.context,uri({...target,live:true,terminalPids:[80]}),0,windowsHost,lookup),/already running.*No duplicate session was started/);
    assert.equal(shown,0);assert.equal(f.calls.length,0);assert.equal(f.store.has('pendingResume'),false);
  }
  assert.equal(parseResume(uri({...target,live:true})).live,true);
  assert.equal(parseResume(encoded({...parseResume(uri(target)),live:'true'})).live,false,'only a boolean enables the guard');
});
test('effective SSH configuration keeps different users, ports and proxy routes separate and handles lookup errors',async()=>{
  const config='hostname lab.internal\nuser me\nport 22\nproxyjump none\nproxycommand none\n';
  const resolve=output=>sshConnection('me@lab','win32',(exe,args,options,done)=>{
    assert.equal(exe,'ssh.exe');assert.deepEqual(args,['-G','me@lab']);assert.equal(options.windowsHide,true);
    assert.equal(options.timeout,3000);done(null,output);
  });
  const key=await resolve(config);
  assert.equal(await resolve(config.replace('lab.internal','LAB.INTERNAL.')),key);
  for(const [from,to] of [['user me','user other'],['port 22','port 2222'],['proxyjump none','proxyjump jump'],['proxycommand none','proxycommand tunnel']])assert.notEqual(await resolve(config.replace(from,to)),key);
  for(const output of ['',config.replace('port 22','port bad'),config.replace('user me','')])assert.equal(await resolve(output),null);
  assert.equal(await sshConnection('lab; touch file','win32',()=>assert.fail('must not execute')),null);
  assert.equal(await sshConnection('lab','win32',(e,a,o,done)=>done(new Error('unavailable'))),null);
});
test('real OpenSSH -G resolves explicit-user and configured aliases without a network connection',async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFile}=require('node:child_process');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-ssh-config-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const config=path.join(root,'config');
  fs.writeFileSync(config,'Host lab alternate\n  HostName 127.0.0.1\n  User me\n  Port 2222\n  ProxyJump none\n');
  const run=(exe,args,options,done)=>execFile(exe,['-F',config,...args],options,done);
  const keys=await Promise.all(['lab','me@lab','alternate','other@lab'].map(alias=>sshConnection(alias,process.platform,run)));
  assert.ok(keys[0],'OpenSSH must resolve the fixture');assert.equal(keys[0],keys[1]);assert.equal(keys[0],keys[2]);assert.notEqual(keys[0],keys[3]);
});
test('history installs the helper even with no live terminal; missing Code is actionable',async()=>{
  const {EventEmitter}=require('node:events');let installed=0,args;
  const opened=await openSession({...target,resume:true},{},{locations:['/code/Code.exe'],exists:()=>true,
    receiptFactory:async()=>({result:Promise.resolve(true),close(){}}),
    ensureHelper:async()=>installed++,launch:(exe,a)=>{args=a;const child=new EventEmitter();child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;}});
  assert.equal(opened,true);assert.equal(installed,1);assert.deepEqual(args,['--reuse-window','--open-url','--',resumeUrl(target)]);
  await assert.rejects(openSession({...target,resume:true},{},{locations:[]}),/standard VS Code/);
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
test('helper installation reports an upgrade once and startup preparation installs without opening a session window',async()=>{
  const exe='/new-install/Code.exe',helper='/new-helper.vsix';
  const run=(e,a,o,done)=>done(null,'');
  assert.equal(await installHelper(exe,helper,run,{exists:()=>true,read:()=>''}),true);
  assert.equal(await installHelper(exe,helper,run,{exists:()=>true,read:()=>''}),false);
  const calls=[];
  assert.equal(await prepareHelper({locations:['/missing','/code'],exists:path=>path==='/code',helper:'/bundled.vsix',ensureHelper:async(...args)=>{calls.push(args);return true;}}),true);
  assert.deepEqual(calls,[['/code','/bundled.vsix']]);
  assert.equal(await prepareHelper({locations:[],ensureHelper:()=>{throw Error('must not install without Code');}}),false);
});
test('desktop waits for the actual helper and reports errors instead of treating process spawn as success',async()=>{
  const {EventEmitter}=require('node:events'),f=fixture();let launched;
  f.vscode.workspace.workspaceFolders[0].uri.authority='ssh-remote+homelab';
  const deps={locations:['/code/Code.exe'],exists:()=>true,ensureHelper:async()=>true,
    launch:(exe,args)=>{launched=args.at(-1);const child=new EventEmitter();child.unref=()=>{};
      queueMicrotask(()=>{child.emit('spawn');dispatchResume(f.vscode,f.context,routed(launched),0,windowsHost).catch(()=>{});});return child;}};
  assert.equal(await openSession({...target,resume:true},{},deps),true);
  assert.equal(new URL(launched).searchParams.has('windowId'),false,'an upgrade never forces a fresh window');
  assert.equal(f.calls[0].shellPath,'ssh.exe');assert.equal(f.calls.some(c=>Array.isArray(c)),false,'an alias mismatch stays in this window');
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
    assert.equal(await dispatchResume(f.vscode,f.context,link,0,linuxHost),false);
    assert.equal(opened,false);assert.equal(f.vscode.window.terminals.length,0);
    assert.ok(f.store.get('pendingResume'));
    f.vscode.workspace.workspaceFolders=[{uri:{scheme:'vscode-remote',authority:'ssh-remote+me@lab',path:target.cwd}}];
    await restoreResume(f.vscode,f.context);
    assert.equal(await receipt.result,true);assert.equal(f.calls.at(-1),'show');assert.equal(f.store.has('pendingResume'),false);
  }finally{receipt.close();}
});
test('same-host sessions outside the editor folder open a terminal tab without replacing or opening the workspace',async()=>{
  for(const t of [target,{...target,source:'wsl',wslDistro:'Ubuntu-24.04'}]){
    const f=fixture(),remote=parseResume(uri(t)).remote;
    f.vscode.workspace.workspaceFolders[0].uri={scheme:'vscode-remote',authority:remote,path:'/other/project'};
    assert.equal(await handleResume(f.vscode,f.context,uri(t),0,windowsHost),true);
    assert.equal(f.calls[0].shellPath,'/bin/bash');assert.equal(f.calls[0].cwd.path,t.cwd);assert.equal(f.calls[0].location,1);
    assert.equal(f.calls.some(c=>Array.isArray(c)&&c[0]==='vscode.openFolder'),false);
    assert.equal(f.vscode.workspace.workspaceFolders[0].uri.path,'/other/project');
  }
});
test('a different SSH alias or a local/empty Windows workspace resumes through a local SSH tab in the active window',async()=>{
  for(const folder of [{scheme:'vscode-remote',authority:'ssh-remote+homelab',path:'/home/me/homelab'},{scheme:'file',path:'C:/work'},null]){
    const f=fixture();f.vscode.workspace.workspaceFolders=folder?[{uri:folder}]:[];
    let wrongPidShown=0;f.vscode.window.terminals.push({processId:Promise.resolve(80),show:()=>wrongPidShown++});
    const link=uri({...target,terminalPids:[80]});
    assert.equal(await handleResume(f.vscode,f.context,link,0,windowsHost),true);
    const options=f.calls[0];assert.equal(options.shellPath,'ssh.exe');assert.deepEqual(options.cwd,{scheme:'file',path:'C:/Users/me'});
    assert.deepEqual(options.shellArgs.slice(0,2),['-t','me@lab']);assert.match(options.shellArgs[2],/^exec \/bin\/bash -ilc /);
    assert.equal(wrongPidShown,0);assert.equal(f.calls.some(c=>Array.isArray(c)),false);
    assert.equal(options.location,1);assert.equal(f.store.has('pendingResume'),false);
    await handleResume(f.vscode,f.context,link,0,windowsHost);
    assert.equal(f.calls.filter(c=>typeof c==='object').length,1,'repeat click focuses the connector tab');
    f.vscode.window.terminals.at(-1).exitStatus={code:0};
    await handleResume(f.vscode,f.context,link,0,windowsHost);
    assert.equal(f.calls.filter(c=>typeof c==='object').length,2,'an exited connector is resumed in a fresh tab');
  }
});
test('a Windows tab selects the saved WSL distribution, folder and account and refuses untrusted workspaces',async()=>{
  const f=fixture(),t={...target,provider:'claude',source:'wsl',wslDistro:'Ubuntu-24.04'};
  assert.equal(await handleResume(f.vscode,f.context,uri(t),0,windowsHost),true);
  assert.equal(f.calls[0].shellPath,'wsl.exe');assert.deepEqual(f.calls[0].cwd,{scheme:'file',path:'C:/Users/me'});
  assert.deepEqual(f.calls[0].shellArgs,['--distribution','Ubuntu-24.04','--cd',target.cwd,'--exec','/bin/bash','-ilc',resumeCommand(parseResume(uri(t)))]);
  const untrusted=fixture(false);untrusted.vscode.workspace.isTrusted=false;
  await assert.rejects(handleResume(untrusted.vscode,untrusted.context,uri(target),0,windowsHost),/Trust this workspace/);
  assert.equal(untrusted.calls.length,0);
});
test('the SSH connector preserves quoted workspace/account paths through both remote shell parses', {skip:process.platform==='win32'}, async t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-ssh-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const cwd=path.join(root,"client's $(printf injected) & + %"),bin=path.join(root,'bin');
  fs.mkdirSync(cwd);fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin,'codex'),'#!/bin/bash\nprintf "%s\\0" "$PWD" "$CODEX_HOME" "$@"\n',{mode:0o755});
  const saved={...target,cwd,agentHome:"/home/me/a'$(printf injected)&+%"},f=fixture(false);
  await handleResume(f.vscode,f.context,uri(saved),0,windowsHost);
  const command=f.calls[0].shellArgs[2];
  const args=execFileSync('/bin/bash',['--noprofile','--norc','-c','set -- '+command.replace(/^exec /,'')+'; printf "%s\\0" "$@"']).toString().split('\0');
  assert.deepEqual(args.slice(0,2),['/bin/bash','-ilc']);
  const output=execFileSync('/bin/bash',['--noprofile','--norc','-c',args[2]],{env:{...process.env,PATH:bin+path.delimiter+process.env.PATH}}).toString().split('\0');
  assert.deepEqual(output,[cwd,saved.agentHome,'resume',id,'']);
});
test('resumed terminal names use the agent and sanitized session title without changing shell commands',async()=>{
  for(const [provider,label] of [['codex','Codex'],['claude','Claude'],['antigravity','AGY']]){
    const f=fixture(),t={...target,provider,name:'  Agent\nUsage\u001b\u202e   $(echo title) '};
    const parsed=parseResume(uri(t));assert.equal(parsed.title,'Agent Usage $(echo title)');
    await handleResume(f.vscode,f.context,uri(t),0,windowsHost);
    assert.equal(f.calls[0].name,label+' · Agent Usage $(echo title)');
    assert.equal(f.calls[0].shellArgs[1],resumeCommand(parsed),'display metadata never becomes a shell argument');
  }
  const {terminalName}=require('../vscode-link/extension.js');
  assert.equal(terminalName({provider:'codex',sessionId:id,cwd:'/srv/Agent-Usage'}),'Codex · Agent-Usage');
  assert.equal(terminalName({provider:'claude',sessionId:id,cwd:'/'}),'Claude · 12345678');
  assert.equal(terminalName({provider:'antigravity',sessionId:id,title:'a'.repeat(200)}).length,6+80);
});

test('Claude resumes preserve the remote default onboarding file and still select custom account homes',()=>{
  const defaultTarget=parseResume(uri({...target,provider:'claude',agentHome:'/home/me/.claude'}));
  const command=resumeCommand(defaultTarget);
  assert.ok(command.startsWith('if [ \'/home/me/.claude\' = "$HOME/.claude" ]; then exec env -u CLAUDE_CONFIG_DIR claude --resume'));
  assert.ok(command.includes("else exec env CLAUDE_CONFIG_DIR='/home/me/.claude'"));
  assert.ok(resumeCommand({...defaultTarget,home:'/home/me/custom/'}).includes("CLAUDE_CONFIG_DIR='/home/me/custom/'"));
});
test('restored helper terminals remain reusable after extension reload without a process ID',async()=>{
  const f=fixture(),scope=JSON.stringify(['codex','ssh-remote+me@lab',target.agentHome,id]);let shown=0;
  f.vscode.window.terminals.push({creationOptions:{env:{AGENT_USAGE_SESSION_SCOPE:scope}},show:()=>shown++});
  await handleResume(f.vscode,f.context,uri(target),0);assert.equal(shown,1);assert.equal(f.calls.length,0);
  f.vscode.window.terminals[0].creationOptions.env.AGENT_USAGE_SESSION_SCOPE=JSON.stringify(['codex','ssh-remote+other',target.agentHome,id]);
  await handleResume(f.vscode,f.context,uri(target),0);assert.equal(shown,1);assert.equal(f.calls.length,2,'a different host cannot reuse that terminal');
});

test('executed Claude resume unsets inherited custom configuration only for the remote default home',{skip:process.platform==='win32'},t=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-claude-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'claude'),'#!/bin/bash\nprintf "%s\\0" "${CLAUDE_CONFIG_DIR-unset}" "$@"\n',{mode:0o755});
  const defaultHome=path.join(os.homedir(),'.claude');
  for(const home of [defaultHome,"/home/remote/custom'$(printf injected)"]){
    const command=resumeCommand({provider:'claude',home,sessionId:id});
    const output=execFileSync('/bin/bash',['--noprofile','--norc','-c',command],{env:{...process.env,CLAUDE_CONFIG_DIR:'/inherited/custom',PATH:root+path.delimiter+process.env.PATH}}).toString().split('\0');
    assert.deepEqual(output,[home===defaultHome?'unset':home,'--resume',id,'']);
  }
});
