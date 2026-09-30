'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch();
  try {
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const accounts=[{id:'codex',base:'codex',name:'Codex',glyph:'Cx',snap:{status:'ok',windows:[{id:'primary',label:'5-hour',used:.2,resets_at:Date.now()+3600000,count:null}],details:[]}}];
      const answers={get_agent_accounts:accounts,get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true},get_notch_edge:'right',get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en'},get_usage:accounts[0].snap,get_codex:accounts[0].snap,get_weekly_ring:'outside',get_color_transition:'ramp',get_theme_resolved:'dark',get_update_state:{status:'current'},get_notch_slots:[],get_activity:[{account:'codex',state:'busy',name:'Nest',since:1}],get_antigravity_prefs:{limit:'automatic'}};
      const listeners={};window.agentUsage={invoke:async cmd=>answers[cmd]??null,on:(name,cb)=>{(listeners[name]??=[]).push(cb);return()=>{};}};
      window.__emit=(name,value)=>(listeners[name]||[]).forEach(cb=>cb(value));window.__accounts=accounts;
    });
    await page.goto('file://'+path.resolve(__dirname,'../../desktop/ui/notch.html'));
    await page.evaluate(()=>{__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge:'right',along:.5,visible:true,tracking:false,pinned:true});__emit('appear',{});});
    await page.waitForTimeout(1500);
    const metrics=await page.evaluate(async()=>{
      const layer=document.querySelector('.activity-layer'),svg=layer.querySelector('svg');
      const animation=layer.getAnimations()[0];
      const style=getComputedStyle(layer);
      const begin=performance.now(),samples=[];
      await new Promise(resolve=>{function frame(now){samples.push({at:now,transform:getComputedStyle(layer).transform});if(now-begin<1000)requestAnimationFrame(frame);else resolve();}requestAnimationFrame(frame);});
      const child=svg.firstElementChild;
      __emit('agent_accounts',__accounts);
      __emit('activity',[{account:'codex',state:'busy',name:'Nest',since:1}]);
      return {samples,easing:style.animationTimingFunction,hint:style.willChange,width:layer.offsetWidth,svgWidth:svg.clientWidth,phasePreserved:animation===layer.getAnimations()[0],arcPreserved:child===svg.firstElementChild};
    });
    assert.equal(metrics.easing,'linear');assert.equal(metrics.hint,'transform');assert.equal(metrics.width,44);
    assert.ok(Math.abs(metrics.svgWidth-44)<1,'arc is sized to its small compositor layer');
    assert.ok(metrics.samples.length>=35,JSON.stringify({frames:metrics.samples.length}));
    assert.ok(new Set(metrics.samples.map(s=>s.transform)).size>=35,'rotation advances each frame instead of 12 steps');
    assert.ok(metrics.phasePreserved&&metrics.arcPreserved,'collector updates preserve rotation phase and arc DOM');
    // Chromium must promote the small rotating HTML layer, instead of repainting an SVG group.
    await page.locator('.cell:not(.alerts-cell) .ringwrap').screenshot({path:'/tmp/agent-usage-smooth-spin.png'});
    const cdp=await page.context().newCDPSession(page);let layers=[];
    cdp.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers||[];});await cdp.send('LayerTree.enable');
    // Force a fresh layer-tree update; enable alone need not emit a snapshot
    // when the compositor is already running a steady animation.
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForTimeout(100);
    layers=[];
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.waitForTimeout(300);
    for(let attempt=0;attempt<20&&!layers.some(l=>l.width<=56&&l.width>0);attempt++)await page.waitForTimeout(100);
    const reasons=[];
    for(const layer of layers){const r=await cdp.send('LayerTree.compositingReasons',{layerId:layer.layerId});reasons.push({width:layer.width,height:layer.height,reasons:r.compositingReasons});}
    assert.ok(reasons.some(l=>l.width<=56&&l.height<=56&&l.reasons.some(r=>/transform.*animation|animation.*transform/i.test(r))),JSON.stringify(reasons));
    await page.evaluate(()=>__emit('disappear',{}));
    assert.equal(await page.locator('.activity-layer').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    await page.evaluate(()=>__emit('appear',{}));
    await page.evaluate(()=>document.querySelector('.cell').classList.add('compact-account'));
    assert.equal(await page.locator('.activity-layer').evaluate(el=>getComputedStyle(el).animationPlayState),'paused');
    await page.evaluate(()=>document.querySelector('.cell').classList.remove('compact-account'));
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('.activity-layer').evaluate(el=>getComputedStyle(el).animationName),'none');
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.evaluate(()=>__emit('activity',[{account:'codex',state:'waiting',name:'Nest',since:2}]));
    assert.equal(await page.locator('.activity-layer').evaluate(el=>el.classList.contains('running')),false);
    assert.equal(await page.locator('.arc-pulse').count(),1);
    await page.evaluate(()=>__emit('activity',[]));
    assert.equal(await page.locator('svg.activity circle').count(),0);
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({frames:metrics.samples.length,uniqueTransforms:new Set(metrics.samples.map(s=>s.transform)).size,composited:true,phasePreserved:true,pausedWhenHidden:true,reducedMotion:true}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
