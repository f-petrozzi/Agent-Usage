// Shared native renderer; synthetic records only, 1280/390 and reduced motion.
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const title='helper-20738760-ae0f-515c-a353-beec1d557013 long synthetic session title <one> "two"';
const UI=process.env.ORBIT_RENDERER_UI||path.resolve(__dirname,'../../desktop/ui');
const OUT=process.env.ORBIT_ROWS_OUTPUT||'/tmp/orbit-working-session-rows';
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch();
 try{
  for(const width of [1280,390])for(const reduce of [false,true]){
   const page=await browser.newPage({viewport:{width,height:844},reducedMotion:reduce?'reduce':'no-preference'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(title=>{
    const events={},snap={status:'ok',windows:[{id:'primary',label:'5 hours',used:.58,resets_at:Date.now()+3600000}],fetched_at:Date.now(),note:''};
    const accounts=[{id:'codex:a',base:'codex',name:'Codex A',glyph:'A',snap}];
    const rows=[{id:'synthetic-linked',sessionId:'native-linked',provider:'codex',account:'codex:a',state:'busy',name:title,detail:'Working',since:1},
     {id:'synthetic-unlinked',provider:'codex',account:'codex:a',state:'busy',name:title+' second',detail:'Working',since:2}];
    window.rowAccounts=accounts;window.rowActivity=rows;window.rowMoveBefore=Element.prototype.moveBefore;
    const values={get_agent_accounts:accounts,get_glyphs:{},get_activity:rows,get_notch_edge:'top',get_notch_insets:[0,0,0,0],get_notch_slots:[],get_focus_accounts:[],get_session_pins:[],get_session_library:[],get_alert_log:[],get_weekly_ring:'off',get_theme_resolved:'dark',get_color_transition:'hard_step',get_appearance:{},get_notch_buttons:{pin:false,alerts:true},get_ui_flags:{notch_visible:true},get_alert_preferences:{muted:[]},get_update_state:{status:'unavailable'},get_state:{sessions:[],counts:{},agg:'busy',lang_resolved:'en'}};
    window.rowEmit=(name,payload)=>(events[name]||[]).forEach(fn=>fn(payload));
    window.agentUsage={on:(name,fn)=>{(events[name]||=[]).push(fn);return()=>{};},invoke:async(command,args)=>{
     if(command==='ready')setTimeout(()=>{rowEmit('layout',{scale:1,edge:'top',along:.5,visible:true});rowEmit('appear');},30);
     window.rowLastCommand={command,args};return values[command]??null;
    }};
   },title);
   await page.goto('file://'+UI+'/notch.html');
   await page.locator('#root.visible .cell[data-p="codex:a"]').click();
   const row=page.locator('#card.show .s-row').filter({has:page.locator('[class="s-name"]')}).last();
   await row.waitFor();
   await page.waitForTimeout(400);
   const linked=page.locator('.s-row.session-link');
   assert.equal(await linked.getAttribute('aria-label'),title+', Working');
   assert.equal(await linked.getAttribute('title'),title+', Working');
   assert.equal(await linked.locator('.s-name').textContent(),title);
   assert.equal((await linked.innerText()).trim(),title,'no visible Working caption');
   assert.equal(await page.locator('.s-row[role="group"]').getAttribute('aria-label'),title+' second, Working');
   const geometry=await linked.locator('.s-name').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth,height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight),ellipsis:getComputedStyle(el).textOverflow,nowrap:getComputedStyle(el).whiteSpace}));
   assert(geometry.scroll>geometry.client);assert.equal(geometry.ellipsis,'ellipsis');assert.equal(geometry.nowrap,'nowrap');assert(geometry.height<geometry.line*1.5);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const mark=linked.locator('.s-working');
   const transform=()=>mark.evaluate(el=>getComputedStyle(el,'::after').transform);
   await page.waitForFunction(()=>document.querySelector('.s-row.session-link .s-working.is-visible'));
   await mark.evaluate(el=>{window.originalWorkingMark=el;window.originalWorkingAnimation=el.getAnimations({subtree:true})[0];});
   let clock=await mark.evaluate(el=>el.getAnimations({subtree:true})[0]?.currentTime||0);
   // Several complete revolutions, with both quota and activity updates between them.
   for(let step=0;step<8;step++){
    await page.waitForTimeout(340);
    const sample=await page.evaluate(step=>{
     if(step===4)Element.prototype.moveBefore=undefined;
     if(step===6)Element.prototype.moveBefore=rowMoveBefore;
     rowAccounts[0].snap.windows[0].used=.58+step/1000;
     rowEmit('agent_accounts',rowAccounts);
     rowEmit('activity',rowActivity.map(row=>({...row,since:row.since+step})));
     const current=document.querySelector('.s-row.session-link .s-working'),animation=current.getAnimations({subtree:true})[0];
     return {sameMark:current===originalWorkingMark,sameAnimation:animation===originalWorkingAnimation,time:animation?.currentTime||0,nativeMove:typeof current.parentElement.moveBefore};
    },step);
    assert(sample.sameMark,'existing working mark survives native and legacy snapshot reconciliation');
    if(!reduce){assert(sample.time-clock>280&&sample.time-clock<500,'native animation clock keeps a constant rate: '+JSON.stringify({clock,...sample}));clock=sample.time;}
   }
   if(!reduce)assert(clock>2400,'rotation runs continuously for more than two turns');
   if(reduce)assert.equal(await mark.evaluate(el=>getComputedStyle(el,'::after').animationName),'none');
   else{
    await page.waitForFunction(()=>document.querySelector('.s-row.session-link .s-working.is-visible'));
    const first=await transform();await page.waitForTimeout(160);assert.notEqual(await transform(),first);
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    assert.equal(await mark.evaluate(el=>getComputedStyle(el,'::after').animationPlayState),'paused');
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    await mark.evaluate(el=>el.style.transform='translateY(2000px)');
    await page.waitForFunction(()=>!document.querySelector('.s-row.session-link .s-working.is-visible'));
    assert.equal(await mark.evaluate(el=>getComputedStyle(el,'::after').animationPlayState),'paused');
    await mark.evaluate(el=>el.style.transform='');
    await page.waitForFunction(()=>document.querySelector('.s-row.session-link .s-working.is-visible'));

   }
   await page.evaluate(()=>{hoverId='codex:a';cardHeld=true;showCard();});
   await page.waitForTimeout(550);
   assert.equal(await page.locator('#card.show').evaluate(el=>getComputedStyle(el).opacity),'1');
   await page.screenshot({path:path.join(OUT,`session-rows-${width}${reduce?'-reduced':''}.png`)});
   if(!reduce){
    await page.evaluate(()=>document.getElementById('card').classList.remove('show'));
    assert.equal(await mark.evaluate(el=>getComputedStyle(el,'::after').animationPlayState),'paused');
    await page.evaluate(()=>document.getElementById('card').classList.add('show'));
   }
   await page.evaluate(()=>rowEmit('activity',[]));
   assert.equal(await page.locator('#card .s-working').count(),0,'finished work removes the live state');
   assert.equal(await page.locator('.s-working-exit').count(),reduce?0:2,'only ordinary motion settles the two previous marks');
   await page.waitForTimeout(210);
   assert.equal(await page.locator('.s-working-exit').count(),0,'finite settling releases its layers');
   if(!reduce)for(let i=0;i<3;i++)await page.evaluate(()=>{rowEmit('disappear');rowEmit('appear');});
   await page.evaluate(()=>{document.getElementById('card').classList.remove('show');});

   assert.deepEqual(errors,[]);console.log(JSON.stringify({width,reduce,ellipsis:true,fullTitle:true,accessibleWorking:true,caption:false,visibilityPause:true,snapshotPhase:true}));
   await page.close();
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
