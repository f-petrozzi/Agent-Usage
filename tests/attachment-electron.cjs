'use strict';
// Actual sandboxed preload, disk-backed File objects, OS clipboard and main IPC.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
if(!process.versions.electron){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-native-drop-'));
 const {spawnSync}=require('node:child_process');
 const args=[...(process.platform==='linux'&&process.env.AGENT_USAGE_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),__filename,root];
 const result=spawnSync(require('../desktop/node_modules/electron'),args,{stdio:'inherit',timeout:45000,env:{...process.env,ELECTRON_RUN_AS_NODE:''}});
 if(result.error)console.error(result.error.message);
 fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});process.exit(result.status??1);
}
const electron=require('electron'),{app,BrowserWindow,clipboard,ClipboardItem}=electron,{Module}=require('node:module');
const root=process.argv.at(-1),UI=path.resolve(__dirname,'../desktop/ui');app.setPath('appData',root);
const account='codex_aaaaaaaaaaaa',sessionId='12345678-1234-5678-abcd-123456789012';
const row={id:'chat',account,provider:'codex',sessionId,cwd:'/srv/project',agentHome:'/home/user/.codex-b',name:'Design review',since:Date.now(),live:true,state:'busy'};
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check){const end=Date.now()+5000;while(Date.now()<end){if(await check())return;await wait(30);}throw new Error('Native attachment UI did not become ready.');}
async function diskFile(window,file){
 await window.webContents.executeJavaScript("document.body.insertAdjacentHTML('beforeend','<input id=fixture-file type=file hidden>')");
 window.webContents.debugger.attach('1.3');
 try{const {root:document}=await window.webContents.debugger.sendCommand('DOM.getDocument');const {nodeId}=await window.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:document.nodeId,selector:'#fixture-file'});await window.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[file]});}
 finally{window.webContents.debugger.detach();}
}
app.whenReady().then(async()=>{
 const source=path.resolve(__dirname,'../desktop/main.cjs'),subject=new Module(source);subject.filename=source;subject.paths=Module._nodeModulePaths(path.dirname(source));
 const original=subject.require.bind(subject),sent=[];
 const proxy=new Proxy(app,{get(target,name){if(name==='whenReady')return()=>new Promise(()=>{});if(name==='requestSingleInstanceLock')return()=>true;const value=target[name];return typeof value==='function'?value.bind(target):value;}});
 subject.require=id=>id==='electron'?{...electron,app:proxy}:id==='./collector.cjs'?{...original(id),readSessionHistory:async()=>({sessions:[row]})}:id==='./session-open.cjs'?{...original(id),openSession:async()=>true}:id==='./attachments.cjs'?{...original(id),deliver:async(draft,target,options)=>{sent.push({draft,target,options});return {queued:options.queue,context:'Prepared context',paths:['/srv/project/attachment.png']};}}:original(id);
 subject._compile(fs.readFileSync(source,'utf8')+`\nmodule.exports={init(w){win=w;config={source:'ssh',sshTarget:'fixture',theme:'dark',sessionPins:[]};collector={accounts:[{id:'${account}',base:'codex',name:'Codex B'}]};},get review(){return attachmentWindow;}};`,source);
 const main=subject.exports;
 const window=new BrowserWindow({show:false,webPreferences:{preload:path.resolve(UI,'../preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});main.init(window);await window.loadFile(path.join(UI,'attachments.html'));
 const file=path.join(root,'design.png');fs.copyFileSync(path.resolve(__dirname,'../docs/images/agent-identity-glow.png'),file);
 await diskFile(window,file);
 assert.equal(await window.webContents.executeJavaScript("window.agentUsage.filePath(document.getElementById('fixture-file').files[0])"),file);
 assert.equal(await window.webContents.executeJavaScript("window.agentUsage.filePath(new File(['x'],'virtual.png'))"),'');
 await window.webContents.executeJavaScript(`window.agentUsage.invoke('prepare_attachments',{account:'${account}',paths:[window.agentUsage.filePath(document.getElementById('fixture-file').files[0])]})`);
 const review=main.review;await until(()=>review.webContents.executeJavaScript("document.querySelector('#sessions')?.value === 'chat'"));
 assert.match(await review.webContents.executeJavaScript("document.querySelector('#files img').src"),/^data:image\/png;base64,/);
 await clipboard.write([new ClipboardItem({'image/png':new Blob([fs.readFileSync(file)],{type:'image/png'})})]);assert.equal(await clipboard.has('image/png'),true);
 await review.webContents.executeJavaScript("document.getElementById('paste').click()");await until(()=>review.webContents.executeJavaScript("document.querySelector('.file p')?.textContent==='Screenshot.png' && !document.querySelector('#send').disabled"));
 await review.webContents.executeJavaScript("document.getElementById('message').value='Review the screenshot';document.getElementById('send').click()");
 await until(()=>review.webContents.executeJavaScript("document.getElementById('status').textContent.includes('queued')"));
 assert.equal(sent.length,1);assert.equal(sent[0].target.agentHome,row.agentHome);assert.equal(sent[0].target.sessionId,sessionId);assert.equal(sent[0].draft.files[0].image,'png');assert.equal(sent[0].options.message,'Review the screenshot');
 review.close();window.close();console.log('Passed native Electron file paths, image preview, clipboard screenshot, account routing and reviewed queue IPC.');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
