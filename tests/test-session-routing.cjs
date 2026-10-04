'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {resolveSession,sessionScope}=require('../desktop/session-routing.cjs');
const {resumeUrl}=require('../desktop/session-open.cjs');
const {parseResume,handleResume}=require('../vscode-link/extension.js');
const {URI}=require('../desktop/node_modules/vscode-uri');
const config={source:'ssh',sshTarget:'homelab'};
const saved={id:'chat',account:'codex-a',provider:'codex',sessionId:'12345678-1234-5678-abcd-123456789012',cwd:'/srv/project',agentHome:'/home/me/.codex-a',name:'Project',terminalPids:[80],live:false};
test('one resolver preserves account, host and fresh live ancestry for any entry point',()=>{
 const active=[{...saved,terminalPids:[90,80],state:'busy'}];
 const byId=resolveSession({config,rows:[saved],active,account:saved.account,id:saved.id});
 const byUuid=resolveSession({config,rows:[saved],active,account:saved.account,sessionId:saved.sessionId});
 assert.deepEqual(byId,byUuid);assert.equal(byId.resume,true);assert.equal(byId.live,true);assert.deepEqual(byId.terminalPids,[90,80]);
 assert.equal(byId.agentHome,saved.agentHome);assert.equal(byId.sshTarget,'homelab');
 assert.throws(()=>resolveSession({config,rows:[saved],active,account:'other',id:saved.id}),/no longer/);
 assert.notEqual(sessionScope(config),sessionScope({...config,sshTarget:'other'}));
});
test('live-only sessions can focus a matching terminal but never start a duplicate without resume metadata',async()=>{
 const active=[{...saved,agentHome:undefined}],target=resolveSession({config,rows:[],active,account:saved.account,id:saved.id});
 assert.equal(target.focusOnly,true);const uri=URI.parse(resumeUrl(target));assert.equal(parseResume(uri).focusOnly,true);
 let shown=0,created=0;const terminal={processId:Promise.resolve(80),show:()=>shown++};
 const vscode={workspace:{isTrusted:true,workspaceFolders:[{uri:{scheme:'vscode-remote',authority:'ssh-remote+homelab',path:'/srv/project'}}]},window:{terminals:[terminal],createTerminal:()=>created++}};
 const context={globalState:{get(){},update(){}}};await handleResume(vscode,context,uri,0);assert.equal(shown,1);assert.equal(created,0);
 vscode.window.terminals=[];await assert.rejects(handleResume(vscode,context,uri,0),/No duplicate/);assert.equal(created,0);
 vscode.window.terminals=[terminal];vscode.workspace.workspaceFolders[0].uri.authority='ssh-remote+other';
 await assert.rejects(handleResume(vscode,context,uri,0,{platform:'linux'},async()=>null),/No duplicate/);assert.equal(shown,1);
});
test('focus-only mode requires a boolean and does not bypass session identity or host validation',()=>{
 assert.equal(resumeUrl({...saved,...config,agentHome:undefined,focusOnly:'true'}),null);
 for(const delta of [{sessionId:'bad'},{sshTarget:'host;exec'},{cwd:'relative'}])assert.equal(resumeUrl({...saved,...config,focusOnly:true,...delta}),null);
});

test('an idle completion snapshot without writer ancestry does not mark a closed session as live',()=>{
 const row=resolveSession({config,rows:[saved],active:[{...saved,terminalPids:[],state:'idle'}],account:saved.account,id:saved.id});
 assert.equal(row.live,false);assert.equal(row.focusOnly,undefined);assert.equal(row.resume,true);
});
