/* Real renderer, synthetic expired quota, no provider or personal records. */
'use strict';
const assert=require('node:assert/strict'), path=require('node:path'),fs=require('node:fs');
const {chromium}=require('/mnt/ssd/homelab/tools/agent-toolkit/node_modules/playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/usage-refresh-truth';fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch();
 try{
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<761,reducedMotion:width<761?'reduce':'no-preference'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    const now=Date.now(),listeners={}; window.__calls=[];
    const accounts=[{id:'claude',base:'claude',name:'Claude',glyph:'C',snap:{status:'stale',windows:[{id:'session',label:'5 hours',used:.73,resets_at:now-660000}],fetched_at:now-900000,details:[],note:'Usage reading is stale; waiting for a provider update.'}}];
    const answers={get_agent_accounts:accounts,get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true},get_notch_edge:'top',get_state:{sessions:[],counts:{},agg:'idle',lang_resolved:'en'},get_theme_resolved:'dark',get_weekly_ring:'off',get_update_state:{status:'current'},get_notch_slots:[],get_activity:[],get_focus_accounts:[],get_alert_log:[]};
    window.agentUsage={invoke:(name,args)=>{__calls.push([name,args]);return Promise.resolve(name==='refresh_ring'?false:name in answers?answers[name]:name.startsWith('get_')?{}:true);},on:(name,fn)=>{(listeners[name]||=[]).push(fn);return()=>{};}};
    window.__emit=(name,value)=>(listeners[name]||[]).forEach(fn=>fn(value));
   });
   await page.goto('file://'+UI+'/notch.html');
   await page.waitForSelector('#pill .cell',{state:'attached'});
   await page.evaluate(()=>__emit('layout',{edge:'top',along:.5,scale:1,visible:true,tracking:false}));
   await page.waitForTimeout(1000);
   await page.evaluate(()=>holdCard('claude'));
   await page.waitForTimeout(1100);
   assert.match(await page.locator('.w-reset').innerText(),/Waiting for usage update/);
   assert.match(await page.locator('#card').innerText(),/73%/);
   await page.evaluate(()=>refreshRing('claude'));
   assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='refresh_ring').length),1);
   assert.equal(await page.locator('svg.reading').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length),0);
   assert.match(await page.locator('#card').innerText(),/73%/);
   await page.screenshot({path:path.join(OUT,'expired-'+width+'.png')});
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS expired Claude reset remains truthful and unchanged refresh keeps reading still at desktop/phone widths');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
