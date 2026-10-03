'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/agent-usage-rim';fs.mkdirSync(OUT,{recursive:true});
async function brightDifference(page,before,after){
  return page.evaluate(async([a,b])=>{
    const pixels=async encoded=>{const img=new Image();img.src='data:image/png;base64,'+encoded;await img.decode();const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,img.width,img.height).data;};
    const first=await pixels(a),second=await pixels(b);let count=0;
    for(let i=0;i<first.length;i+=4)if(Math.max(second[i]-first[i],second[i+1]-first[i+1],second[i+2]-first[i+2])>24)count++;
    return count;
  },[before.toString('base64'),after.toString('base64')]);
}
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    const events={},now=Date.now(),accounts=['codex','claude'].map(id=>({id,base:id,name:id==='codex'?'Codex a':'Claude',glyph:'C',snap:{status:'ok',windows:[{id:'session',label:'Five hours',used:.35,resets_at:now+3600e3}],fetched_at:now,details:[],note:''}}));
    const answers={get_agent_accounts:accounts,get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en'},get_activity:[],get_notch_slots:[],get_notch_edge:'top',get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true},get_update_state:{status:'current'}};
    window.__emit=(name,payload)=>(events[name]||[]).forEach(fn=>fn(payload));
    window.__calls=[];window.agentUsage={invoke:async(name,args)=>{__calls.push([name,args]);return answers[name]??null;},on:(name,fn)=>{(events[name]??=[]).push(fn);return()=>{};}};
  });
  await page.goto('file://'+UI+'/notch.html');await page.addStyleTag({content:'html{background:#52667d}'});await page.waitForTimeout(350);
  for(const edge of ['top','right','bottom','left']){
    await page.mouse.move(0,0);
    await page.evaluate(edge=>{notificationRim.clear();retractSlivers(true);__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});__emit('appear',{edge});},edge);
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#notification-rim').getAttribute('hidden'),'','the idle notch has no border animation');
    await page.evaluate(()=>__emit('alert',{events:[{id:'finished',kind:'completion',account:'codex',session:'Agent Usage',took:120000}],hold:6000,sound:false}));
    await page.waitForTimeout(850);
    assert.equal(await page.locator('#notification-rim').getAttribute('hidden'),null);
    const firstAngle=await page.locator('.rim-sweep').first().evaluate(el=>parseFloat(el.style.getPropertyValue('--rim-turn')));
    assert.ok(await page.locator('#rim-silhouette path').count()>=2,'the outline includes the notch and its expanded notification');
    assert.equal(await page.locator('#notification-rim').evaluate(el=>getComputedStyle(el).pointerEvents),'none');
    // Check the rendered effect, not only the presence of its SVG. Freeze the scene for a clean comparison.
    await page.evaluate(()=>document.getElementById('notification-rim').style.visibility='hidden');
    const off=await page.screenshot();await page.evaluate(()=>document.getElementById('notification-rim').style.visibility='');
    const on=await page.screenshot({path:path.join(OUT,edge+'-glow.png')});
    assert.ok(await brightDifference(page,off,on)>25,'a visible glowy border renders on '+edge);
    await page.waitForTimeout(800);
    const secondAngle=await page.locator('.rim-sweep').first().evaluate(el=>parseFloat(el.style.getPropertyValue('--rim-turn')));
    assert.ok(secondAngle>firstAngle+65,'the shimmer travels around the outline');
    await page.screenshot({path:path.join(OUT,edge+'-travel.png')});
    const sliver=await page.locator('.sliver').boundingBox();
    assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('.sliver')?.dataset.account,{x:sliver.x+sliver.width/2,y:sliver.y+sliver.height/2}),'codex','the glow does not intercept notification clicks');
    await page.waitForTimeout(1800);
    assert.equal(await page.locator('#notification-rim').getAttribute('hidden'),'','one circuit fades out while the notification remains');
    assert.equal(await page.locator('.sliver').count(),1);
    await page.evaluate(()=>retractSlivers(true));
  }
  // A burst shares one circuit, rather than flashing back to the starting side for every account.
  await page.evaluate(()=>__emit('alert',{events:[{id:'wait',kind:'waiting',account:'claude',session:'Homelab'}],hold:6000,sound:false}));
  await page.waitForTimeout(550);
  const angle=await page.locator('.rim-sweep').first().evaluate(el=>parseFloat(el.style.getPropertyValue('--rim-turn')));
  await page.evaluate(()=>showSliver('codex',[{id:'limit',kind:'quota',account:'codex',window:'session',level:100}],6000));await page.waitForTimeout(160);
  assert.ok(await page.locator('.rim-sweep').first().evaluate(el=>parseFloat(el.style.getPropertyValue('--rim-turn')))>angle);
  assert.equal(await page.locator('#notification-rim').evaluate(el=>el.style.getPropertyValue('--rim-color')),'rgb(255, 63, 0)');
  await page.evaluate(()=>__emit('disappear'));await page.waitForTimeout(80);
  assert.equal(await page.locator('#notification-rim').getAttribute('hidden'),'','hiding cancels the sweep immediately');
  assert.equal(await page.locator('#rim-silhouette path').count(),0);
  // A new release while hidden begins its blue circuit when the notch appears. Progress does not restart it.
  await page.evaluate(()=>__emit('update_state',{status:'available',version:'4.0.0',percent:0}));
  assert.equal(await page.locator('#notification-rim').getAttribute('hidden'),'');
  await page.evaluate(()=>__emit('appear',{edge:'left'}));await page.waitForTimeout(1000);
  assert.equal(await page.locator('#notification-rim').getAttribute('hidden'),null);
  assert.equal(await page.locator('#notification-rim').evaluate(el=>el.style.getPropertyValue('--rim-color')),'#8bafff');
  await page.screenshot({path:path.join(OUT,'blue-release.png')});
  const blueAngle=await page.locator('.rim-sweep').first().evaluate(el=>parseFloat(el.style.getPropertyValue('--rim-turn')));
  await page.evaluate(()=>__emit('update_state',{status:'downloading',version:'4.0.0',percent:42}));await page.waitForTimeout(160);
  assert.ok(await page.locator('.rim-sweep').first().evaluate(el=>parseFloat(el.style.getPropertyValue('--rim-turn')))>blueAngle);
  // Native transfers clear an active shimmer and keep a new release pending until the destination is painted.
  await page.evaluate(()=>__emit('monitor_stow',{placement:7}));
  assert.equal(await page.locator('#notification-rim').getAttribute('hidden'),'');
  assert.equal(await page.locator('#rim-silhouette path').count(),0);
  await page.evaluate(()=>{
    __emit('update_state',{status:'ready',version:'4.0.0',percent:100});
    __emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge:'right',along:.5,visible:true,tracking:false,pinned:false,placement:7});
  });await page.waitForTimeout(1100);
  assert.equal(await page.locator('#root').evaluate(el=>el.classList.contains('placing')),false);
  assert.equal(await page.locator('#notification-rim').getAttribute('hidden'),null,'the queued release starts on the destination monitor');
  assert.equal(await page.locator('#notification-rim').evaluate(el=>el.style.getPropertyValue('--rim-color')),'#8bafff');
  // Reduced motion shows a quiet stationary highlight, with no travelling light or repeated loop.
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{notificationRim.clear();retractSlivers(true);showSliver('claude',[{kind:'waiting',account:'claude',session:'Homelab'}],6000);});await page.waitForTimeout(180);
  assert.equal(await page.locator('#notification-rim').getAttribute('data-still'),'true');
  assert.equal(await page.locator('.rim-sweep').first().evaluate(el=>getComputedStyle(el).backgroundImage),'none');
  await page.screenshot({path:path.join(OUT,'reduced-motion.png')});
  await page.waitForTimeout(1200);assert.equal(await page.locator('#notification-rim').getAttribute('hidden'),'');
  assert.deepEqual(errors,[]);
  console.log('Passed notification shimmer: rendered glow on four edges, merged silhouette, travelling light, one circuit, click-through, burst coalescing, hide cleanup, blue release and reduced motion.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
