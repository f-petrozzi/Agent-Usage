'use strict';
// Structural performance budgets with synthetic accounts, independent of machine FPS.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/agent-usage-performance';
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch();const results=[];
 try{
  for(const dpr of [1,2]){
   const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:dpr}),page=await context.newPage(),errors=[];
   page.on('pageerror',error=>errors.push(error.message));
   await page.addInitScript(()=>{
    const native=window.requestAnimationFrame.bind(window);window.__stamp=0;
    window.requestAnimationFrame=fn=>native(now=>{window.__stamp=now;fn(now);});
    const listeners={},accounts=['codex-a','claude-b'].map((id,i)=>({id,base:i?'claude':'codex',name:i?'Claude Cedar':'Codex Atlas',glyph:'C',snap:{status:'ok',fetched_at:Date.now(),windows:[{id:i?'session':'primary',label:'5 hours',used:.3}],details:[]}}));
    const answers={get_agent_accounts:accounts,get_activity:[],get_notch_slots:[],get_notch_edge:'top',get_ui_flags:{notch_visible:true,notch_on_hover:false},get_update_state:{status:'current'},get_state:{sessions:[],agg:'idle'},get_focus_accounts:[],get_session_pins:[],get_session_library:[]};
    window.agentUsage={invoke:async name=>answers[name]??null,on:(name,fn)=>{(listeners[name]??=[]).push(fn);return()=>{};}};
    window.__emit=(name,value)=>(listeners[name]||[]).forEach(fn=>fn(value));
   });
   await page.goto('file://'+UI+'/notch.html');await page.waitForTimeout(200);
   await page.evaluate(()=>{
    window.__paints={};for(const name of ['paintShape','paintDetails','paintSliver']){
     const original=window[name];window[name]=function(...args){if(uiMotion.phase==='paint'){const key=name+':'+__stamp;__paints[key]=(__paints[key]||0)+1;}return original.apply(this,args);};
    }
   });
   const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');
   const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
   for(const edge of ['top','right','bottom','left']){
    await page.evaluate(edge=>{notificationRim.clear();hideCard();__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:true});__emit('appear');},edge);await page.waitForTimeout(1600);
    await page.evaluate(()=>{__paints={};uiMotion.frame(()=>setHovered('pin'));setTimeout(()=>setHovered('orb'),100);setTimeout(()=>setHovered(null),350);});await page.waitForTimeout(1400);
    assert.ok(await page.evaluate(()=>Math.max(0,...Object.values(__paints))<=1),'one geometry paint per scheduler frame on '+edge);
    await page.evaluate(()=>notificationRim.start('#fff'));await page.waitForTimeout(200);
    await page.evaluate(()=>{window.__trackWrites=0;window.__observer=new MutationObserver(records=>__trackWrites+=records.length);__observer.observe(document.getElementById('rim-track'),{attributes:true,attributeFilter:['d']});});
    const before=await metrics();await page.waitForTimeout(900);const after=await metrics();
    const writes=await page.evaluate(()=>{__observer.disconnect();return __trackWrites;});
    assert.equal(writes,0,'a stationary rim never rewrites its contour on '+edge);
    const layouts=after.LayoutCount-before.LayoutCount;
    assert.ok(layouts<=3,'a stationary rim does not relayout per frame on '+edge+': '+layouts);
    results.push({dpr,edge,trackWrites:writes,layouts});
   }
   assert.deepEqual(errors,[]);await context.close();
  }
  fs.writeFileSync(path.join(OUT,'metrics.json'),JSON.stringify(results,null,2));console.log('Passed: one keyed geometry paint per frame and stationary rim contour/layout budgets, all edges at DPR 1 and 2.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
