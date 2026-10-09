'use strict';
// Measure a sustained file hover, including the fluid collapse and settled particles.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/agent-usage-gravity-performance';fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch(),results=[];
 try{
  for(const dpr of [1,2]){
   const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:dpr}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    const listeners={},accounts=['a','b','claude','agy'].map((id,i)=>({id,base:i<2?'codex':i===2?'claude':'gemini',name:id,glyph:'C',snap:{status:'ok',fetched_at:Date.now(),windows:[{id:'primary',label:'5 hours',used:.3}],details:[]}}));
    const answers={get_agent_accounts:accounts,get_activity:[],get_notch_slots:[],get_notch_edge:'top',get_ui_flags:{notch_visible:true},get_update_state:{status:'current'},get_state:{sessions:[],agg:'idle'},get_focus_accounts:[],get_session_pins:[],get_session_library:[]};
    window.agentUsage={invoke:async n=>answers[n]??null,on:(n,fn)=>{(listeners[n]??=[]).push(fn);return()=>{};}};window.__emit=(n,v)=>(listeners[n]||[]).forEach(fn=>fn(v));
    window.__hover=()=>{const dt=new DataTransfer();dt.items.add(new File(['image'],'image.png',{type:'image/png'}));document.querySelector('.cell[data-p="b"]').dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));};
   });
   await page.goto('file://'+UI+'/notch.html');await page.addStyleTag({content:'html{background:#52667d}'});await page.waitForTimeout(300);
   await page.evaluate(()=>{__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge:'top',along:.5,visible:true,tracking:false,pinned:true});__emit('appear');});await page.waitForTimeout(1400);
   const timings=await page.evaluate(async()=>{
    const samples=[],costs=[],original=window.paintAttachmentGravity;window.paintAttachmentGravity=function(){const start=performance.now();original();costs.push(performance.now()-start);};
    __hover();window.__keep=setInterval(__hover,180);const start=performance.now();let previous=null;
    await new Promise(resolve=>{const frame=now=>{if(previous!==null)samples.push(now-previous);previous=now;if(now-start<2600)requestAnimationFrame(frame);else resolve();};requestAnimationFrame(frame);});
    window.paintAttachmentGravity=original;
    const sorted=samples.slice().sort((a,b)=>a-b);return {frames:samples.length,fps:1000/(samples.reduce((a,b)=>a+b,0)/samples.length),p95FrameMs:sorted[Math.floor(sorted.length*.95)],maxGravityPaintMs:Math.max(...costs)};
   });
   assert.equal(await page.locator('#gravity-ink').count(),0,'settled absorption removes contour rendering');
   assert.equal(await page.locator('#shape-body').evaluate(e=>e.style.visibility),'hidden');
   assert.equal(await page.locator('.gravity-well').evaluate(e=>getComputedStyle(e,'::before').content),'none','no opaque backdrop');
   assert.equal(await page.locator('.gravity-beads').count(),8);
   assert.deepEqual(await page.locator('#attachment-particle-goo').evaluate(e=>[e.getAttribute('width'),e.getAttribute('height')]),['100','100'],'goo raster is bounded to the particle area');
   const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
   const before=await metrics();await page.waitForTimeout(450);const after=await metrics();
   timings.settledLayouts=after.LayoutCount-before.LayoutCount;assert.ok(timings.settledLayouts<=2,'settled particles do not trigger frame-by-frame layout: '+timings.settledLayouts);
   await page.screenshot({path:path.join(OUT,'particles-dpr-'+dpr+'.png'),clip:{x:650,y:0,width:600,height:140}});
   await page.evaluate(()=>{clearInterval(__keep);window.agentDropCancel();});assert.equal(await page.locator('.gravity-particles').count(),0);assert.equal(await page.locator('#shape-body').evaluate(e=>e.style.visibility),'');assert.deepEqual(errors,[]);
   results.push({dpr,...timings});await context.close();
  }
  fs.writeFileSync(path.join(OUT,'metrics.json'),JSON.stringify(results,null,2));console.log('Passed bounded goo raster, transparent backdrop, settled contour/layout budgets and cancellation. Frame timing:',JSON.stringify(results));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
