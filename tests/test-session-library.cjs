'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {accountId}=require('../desktop/collector.cjs');
const {normalizePins,libraryRows,changePin,publicRow,alertResumeRow}=require('../desktop/session-library.cjs');
const base={id:'history-id',account:accountId('codex','profile-a'),provider:'codex',sessionId:'12345678-1234-5678-abcd-123456789012',name:'Agent Usage',since:1700000000000,
 cwd:'/srv/agent-usage',agentHome:'/home/me/.codex-a',source:'ssh',sshTarget:'homelab',live:true,state:'busy'};
test('pins preserve desktop identity, millisecond dates and safe resume metadata across repeated saves',()=>{
 let pins=changePin([],base,true);for(let i=0;i<5;i++)pins=normalizePins(JSON.parse(JSON.stringify(pins)));
 assert.equal(pins[0].account,base.account);assert.equal(pins[0].since,base.since);assert.equal(pins[0].sessionId,base.sessionId);assert.equal(pins[0].cwd,base.cwd);
 assert.equal(pins[0].live,false);assert.equal(pins[0].state,'idle');assert.deepEqual(pins[0].terminalPids,[]);
 assert.equal(changePin(pins,base,true).length,1);assert.deepEqual(changePin(pins,base,false),[]);
});
test('pinned chats remain above recents after falling out of collector history, and fresh metadata wins',()=>{
 const pins=changePin([],base,true),config={source:'ssh',sshTarget:'homelab'},newer={...base,id:'new',name:'New chat',since:base.since+1000};
 const rows=libraryRows({sessions:[newer]},pins,config);assert.deepEqual(rows.map(s=>[s.id,s.pinned]),[['history-id',true],['new',false]]);
 const fresh=libraryRows({sessions:[{...base,name:'Renamed',live:true,state:'waiting'}]},pins,config);
 assert.equal(fresh.length,1);assert.equal(fresh[0].name,'Renamed');assert.equal(fresh[0].live,true);assert.equal(fresh[0].state,'waiting');assert.equal(fresh[0].pinned,true);
});
test('pins are scoped to the saved SSH host and WSL distribution, including identical account ids',()=>{
 const ssh=changePin([],base,true),wsl=changePin(ssh,{...base,source:'wsl',sshTarget:'',wslDistro:'Ubuntu'},true);
 assert.equal(libraryRows({sessions:[]},wsl,{source:'ssh',sshTarget:'other'}).length,0);
 assert.equal(libraryRows({sessions:[],wslDistro:'Ubuntu'},wsl,{source:'wsl'}).length,1);
 assert.equal(libraryRows({sessions:[],wslDistro:'Debian'},wsl,{source:'wsl'}).length,0);
 assert.equal(libraryRows({sessions:[]},wsl,{source:'ssh',sshTarget:'homelab'}).length,1);
});
test('pin limits are per account; invalid hosts, identities and launch metadata cannot survive stored config',()=>{
 let pins=[];for(let i=0;i<6;i++)pins=changePin(pins,{...base,id:'chat-'+i},true);
 assert.throws(()=>changePin(pins,{...base,id:'seventh'},true),/six chats/);
 assert.equal(changePin(pins,{...base,id:'other-account',account:accountId('codex','profile-b')},true).length,7);
 for(const corrupt of [{cwd:'relative'},{agentHome:'no home'},{sessionId:'invalid'},{sshTarget:'-oProxyCommand=evil'},{source:'other'},{account:'untrusted'},{id:'bad\nidentity'}])assert.equal(normalizePins([{...base,...corrupt}]).length,0);
});
test('public switcher rows expose display metadata and launch capability without account-home or shell metadata',()=>{
 const row=publicRow({...base,pinned:true},{name:'Codex a'});
 assert.equal(row.accountName,'Codex a');assert.equal(row.workspace,'/srv/agent-usage');assert.equal(row.canOpen,true);assert.equal(row.pinned,true);
 assert.equal(row.agentHome,undefined);assert.equal(row.sshTarget,undefined);assert.equal(row.terminalPids,undefined);
});
test('finished-session stack links resolve exact UUIDs or unique recorded completions, including AGY',()=>{
 const rows=libraryRows({sessions:[{...base,state:'idle'}]},[],{source:'ssh',sshTarget:'homelab'});
 assert.equal(alertResumeRow({kind:'completion',account:base.account,target:{sessionId:base.sessionId}},rows).sessionId,base.sessionId);
 assert.equal(alertResumeRow({kind:'completion',account:base.account,session:base.name,at:base.since+1000},rows).id,base.id);
 assert.equal(alertResumeRow({kind:'completion',account:'other',session:base.name,at:base.since},rows),null);
 assert.equal(alertResumeRow({kind:'waiting',account:base.account,session:base.name,at:base.since},rows),null);
 assert.equal(alertResumeRow({kind:'completion',account:base.account,session:base.name,at:base.since},[...rows,{...rows[0],sessionId:'abcdef12-1234-5678-abcd-123456789012'}]),null);
 const agy={...rows[0],provider:'antigravity',account:accountId('gemini','agy')};
 assert.equal(alertResumeRow({kind:'completion',account:agy.account,session:agy.name,at:agy.since},[agy]).provider,'antigravity');
});
