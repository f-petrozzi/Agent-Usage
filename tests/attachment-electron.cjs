'use strict';
// Actual sandboxed preload, disk-backed File objects, OS clipboard and main IPC.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
if(!process.versions.electron){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-native-drop-'));
 const {spawnSync}=require('node:child_process');
 const args=[...(process.platform==='linux'&&process.env.AGENT_USAGE_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),__filename,root];
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const result=spawnSync(require('../desktop/node_modules/electron'),args,{stdio:'inherit',timeout:90000,env});
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
 subject._compile(fs.readFileSync(source,'utf8')+`\nmodule.exports={init(w){win=w;config={source:'ssh',sshTarget:'fixture',theme:'dark',sessionPins:[],scale:1,edge:'top',along:.5,slots:[],buttons:{},focusAccounts:[],alertLog:[]};configPath=require('node:path').join(${JSON.stringify(root)},'settings.json');monitor=screen.getPrimaryDisplay();visible=true;phase='shown';pinned=true;collector={accounts:[{id:'${account}',base:'codex',name:'Codex B',snap:{status:'ok',windows:[],details:[]}}]};},show(){sendLayout();send('appear');},tick,startTick(){timer=setInterval(tick,16);},get draft(){return attachmentDraft;}};`,source);
 const main=subject.exports, bounds=electron.screen.getPrimaryDisplay().bounds;
 const window=new BrowserWindow({...require('../desktop/platform-window.cjs').overlayOptions(bounds),webPreferences:{preload:path.resolve(UI,'../preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false}});
 main.init(window);await window.loadFile(path.join(UI,'notch.html'));window.showInactive();main.show();main.startTick();
 await until(()=>window.webContents.executeJavaScript("document.querySelector('.cell') && document.getElementById('root').classList.contains('visible')"));
 const file=path.join(root,'design.png');fs.copyFileSync(path.resolve(__dirname,'../docs/images/agent-identity-glow.png'),file);
 await diskFile(window,file);
 assert.equal(await window.webContents.executeJavaScript("window.agentUsage.filePath(document.getElementById('fixture-file').files[0])"),file);
 assert.equal(await window.webContents.executeJavaScript("window.agentUsage.filePath(new File(['x'],'virtual.png'))"),'');
 await window.webContents.executeJavaScript(`window.agentUsage.invoke('prepare_attachments',{account:'${account}',paths:[window.agentUsage.filePath(document.getElementById('fixture-file').files[0])]})`);
 await until(()=>window.webContents.executeJavaScript("document.querySelector('.session-open') && document.querySelector('.attachment-preview img')"));
 assert.equal(BrowserWindow.getAllWindows().length,1,'attachments expand inside the notch');
 assert.equal(await window.webContents.executeJavaScript("document.querySelector('.attachment-send').disabled"),true,'session selection stays explicit');
 await clipboard.write([new ClipboardItem({'image/png':new Blob([fs.readFileSync(file)],{type:'image/png'})})]);assert.equal(await clipboard.has('image/png'),true);
 await window.webContents.executeJavaScript(`window.agentUsage.invoke('paste_attachment',{account:'${account}'})`);
 await until(()=>window.webContents.executeJavaScript("document.querySelector('.attachment-file>span:last-child')?.textContent==='Screenshot.png'"));
 await window.webContents.executeJavaScript("document.querySelector('.session-open').click();document.querySelector('.attachment-message').value='Review the screenshot';document.querySelector('.attachment-send').click()");
 await until(()=>window.webContents.executeJavaScript("document.querySelector('.attachment-status')?.textContent.includes('Sent')"));
 assert.equal(sent.length,1);assert.equal(sent[0].target.agentHome,row.agentHome);assert.equal(sent[0].target.sessionId,sessionId);assert.equal(sent[0].draft.files[0].image,'png');assert.equal(sent[0].options.message,'Review the screenshot');
 await window.webContents.executeJavaScript("document.querySelector('.attachment-close').click()");await wait(700);
 await window.webContents.executeJavaScript(`(async()=>{const bytes=await document.getElementById('fixture-file').files[0].arrayBuffer(),virtual=new File([bytes],'browser.png',{type:'image/png'}),dt=new DataTransfer();dt.items.add(virtual);document.querySelector('.cell').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));})()`);
 await until(()=>window.webContents.executeJavaScript("document.querySelector('.attachment-file>span:last-child')?.textContent==='browser.png'"));
 assert.equal(main.draft.files[0].image,'png','virtual images preserve bytes through the sandboxed bridge');
 await window.webContents.executeJavaScript("document.querySelector('.attachment-close').click()");await wait(700);
 if(process.platform==='win32'){
   const {spawn}=require('node:child_process');
   async function native(mode,x=0,y=0){
     return new Promise((resolve,reject)=>{
       const child=spawn('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'attachment-windows.ps1'),mode,file,String(x),String(y)],{windowsHide:true});
       let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new Error('Native attachment fixture timed out'));},12000);
       child.stdout.on('data',data=>out+=data);child.stderr.on('data',data=>err+=data);
       child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);code===0?resolve(out):reject(new Error(err||out));});
     });
   }
   const helper=path.resolve(__dirname,'../desktop/resources/InputMonitor.exe'),attachments=require('../desktop/attachments.cjs');
   await native('image');const pixels=await attachments.readWindowsClipboard(helper);assert.equal(pixels[0].image,'png');assert.equal(pixels[0].name,'Screenshot.png');
   await native('file');const copied=await attachments.readWindowsClipboard(helper);assert.equal(copied[0].name,'design.png');assert.deepEqual(copied[0].bytes,fs.readFileSync(file));
   const position=await window.webContents.executeJavaScript("(()=>{const r=document.querySelector('.cell').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+Math.min(22,r.height/2)};})()");
   const point=electron.screen.dipToScreenPoint({x:Math.round(bounds.x+position.x),y:Math.round(bounds.y+position.y)});
   await native('paste',point.x,point.y);
   await until(()=>window.webContents.executeJavaScript("document.querySelector('.attachment-preview img') && document.getElementById('card').classList.contains('show')"));
   assert.equal(main.draft.account,account,'physical hover Ctrl+V routes to the hovered account');
   await window.webContents.executeJavaScript("document.querySelector('.attachment-close').click()");await wait(700);
   const outcome=await native('drag',point.x,point.y);console.log('Native OLE drag:',outcome.trim());
   await until(()=>window.webContents.executeJavaScript("document.querySelector('.attachment-preview img') && document.getElementById('card').classList.contains('show')"));
   assert.equal(main.draft.files[0].name,'design.png');assert.equal(main.draft.account,account);
   assert.equal(await window.webContents.executeJavaScript("window.agentDropActive"),false,'drop restores pointer interaction');
   await window.webContents.executeJavaScript("document.querySelector('.attachment-close').click()");await wait(700);
   await window.webContents.executeJavaScript("document.querySelector('.cell').click()");await until(()=>window.webContents.executeJavaScript("document.getElementById('card').classList.contains('show')"));
   console.log('Passed Windows bitmap/file clipboard, physical hover paste, real OLE file drag, and notch recovery.');
 }
 window.close();console.log('Passed native Electron file paths, inline image review, clipboard screenshot, account routing and reviewed queue IPC.');app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
