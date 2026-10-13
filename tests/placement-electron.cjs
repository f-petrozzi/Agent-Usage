'use strict';
// Real main/preload/renderer reveal with frozen animation frames, isolated accounts
// and no collector, updater, native-input or VS Code traffic.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
if(!process.versions.electron){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-placement-'));
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const args=[...(process.platform==='linux'&&process.env.AGENT_USAGE_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),__filename,root];
  const result=require('node:child_process').spawnSync(require('../desktop/node_modules/electron'),args,{stdio:'inherit',timeout:90000,env});
  if(result.error)console.error(result.error);
  fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:200});process.exit(result.status??1);
}
const electron=require('electron'),{app}=electron,{Module}=require('node:module'),{EventEmitter}=require('node:events');
const root=process.argv.at(-1);app.setPath('appData',root);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=4000){const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await wait(30);}throw new Error(label);}
let main;
app.whenReady().then(async()=>{
  const source=path.resolve(__dirname,'../desktop/main.cjs'),subject=new Module(source);
  subject.filename=source;subject.paths=Module._nodeModulePaths(path.dirname(source));const original=subject.require.bind(subject);
  const account={id:'claude',base:'claude',name:'Claude fixture',glyph:'C',snap:{status:'ok',windows:[],details:[]}};
  class Collector extends EventEmitter{constructor(){super();this.accounts=[account];}refresh(){}close(){}}
  class SessionFeed extends EventEmitter{constructor(){super();this.sessions=[];}start(){}close(){}}
  const appProxy=new Proxy(app,{get(target,name){if(name==='whenReady')return()=>new Promise(()=>{});const value=target[name];return typeof value==='function'?value.bind(target):value;}});
  subject.require=id=>id==='electron'?{...electron,app:appProxy}:id==='electron-updater'?{autoUpdater:{}}:id==='./collector.cjs'?{...original(id),Collector,SessionFeed}:
    id==='./updates.cjs'?{createUpdates:()=>({start(){},close(){},get:()=>({status:'current'})})}:
    id==='./platform-input.cjs'?{...original(id),createInputMonitor:()=>({ready:true,configure(){},close(){}})}:original(id);
  subject._compile(fs.readFileSync(source,'utf8')+`\nmodule.exports={start,hide,reveal,showAlerts,get window(){return win;},get phase(){return phase;},configure(edge,scale){config.edge=edge;config.scale=scale;win.webContents.setZoomFactor(scale);},expire(){visibleUntil=0;},tick};`,source);
  main=subject.exports;await main.start();
  const errors=[];main.window.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
  const run=code=>main.window.webContents.executeJavaScript(code);
  await wait(600);
  for(const [index,edge] of ['top','right','bottom','left'].entries()){
    main.hide();await wait(550);main.configure(edge,[1,.8,1.25,1][index]);
    await run(`(()=>{
      const frame=uiMotion.frame,cancel=uiMotion.cancel,held=new Map();let serial=1000000;
      uiMotion.frame=fn=>{held.set(++serial,fn);return serial;};
      uiMotion.cancel=id=>{if(!held.delete(id))cancel(id);};
      window.resumeFrames=()=>{uiMotion.frame=frame;uiMotion.cancel=cancel;for(const fn of held.values())frame(fn);held.clear();};
      notice('Display placement could not finish. Reveal the notch again to retry.');
    })()`);
    main.showAlerts([{kind:'waiting',account:'claude',session:'Placement fixture '+edge,title:'Needs input',body:'Choose an option.'}]);
    main.expire();main.tick();assert.equal(main.phase,'transfer','auto-hide must wait for placement');
    await until(()=>main.phase==='shown','masked reveal depends on suspended animation frames',1800);
    assert.equal(main.window.getOpacity(),1);
    assert.equal(await run("document.getElementById('notice').textContent"),'','a retry clears the old warning');
    assert.equal(await run('notchEdge'),edge);
    await run('resumeFrames()');
    await until(()=>run("slivering() && document.body.textContent.includes('Placement fixture '+notchEdge)"),'waiting alert was lost during reveal');
    assert.equal(main.phase,'shown');
    console.log('PASS: hidden Claude waiting alert with frozen frames, edge='+edge);
  }
  await run("notice('Temporary status')");
  assert.equal(await run("getComputedStyle(document.getElementById('notice')).display"),'block');
  const notice=await run("(()=>{const r=document.getElementById('notice').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,width:innerWidth,height:innerHeight};})()");
  assert.ok(notice.x>0&&notice.y>0&&notice.x+notice.w<=notice.width&&notice.y+notice.h<=notice.height);
  await until(()=>run("document.getElementById('notice').textContent==='' && getComputedStyle(document.getElementById('notice')).display==='none'"),'warning did not expire',7000);
  assert.equal(errors.length,0,errors.join('\n'));
  const diagnostics=fs.readFileSync(path.join(root,'Agent Usage','notch-diagnostics.log'),'utf8');
  assert.equal(diagnostics.includes('placement timeout'),false,diagnostics);
  console.log('PASS: positioned status expires; all reveals finish without a placement timeout');
  app.emit('before-quit');app.exit(0);
}).catch(error=>{console.error(error);app.emit('before-quit');app.exit(1);});
