'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/agent-usage-placement-browser';fs.mkdirSync(OUT,{recursive:true});
const answers={get_agent_accounts:[{id:'claude',base:'claude',name:'Claude',glyph:'C',snap:{status:'ok',windows:[],details:[]}}],
  get_glyphs:{claude:{kind:'svg',svg:fs.readFileSync(path.join(UI,'glyphs/claude.svg'),'utf8')}},
  get_ui_flags:{notch_visible:false,notch_on_hover:true,tray_visible:false},get_notch_edge:'right',get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en'},
  get_weekly_ring:'off',get_theme_resolved:'dark',get_update_state:{status:'current'},get_notch_slots:[],get_activity:[],get_focus_accounts:[],get_alert_log:[]};
(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(answers=>{
      const listeners={};window.calls=[];
      window.agentUsage={invoke:(name,args={})=>{calls.push([name,args]);return Promise.resolve(name in answers?answers[name]:true);},on:(name,fn)=>{(listeners[name]||=[]).push(fn);return()=>{};}};
      window.emit=(name,value)=>(listeners[name]||[]).forEach(fn=>fn(value));
    },answers);
    await page.goto('file://'+path.join(UI,'notch.html'));await page.waitForTimeout(300);
    await page.evaluate(()=>{
      const frame=uiMotion.frame,cancel=uiMotion.cancel,held=new Map();let serial=1000000;window.late=[];
      uiMotion.frame=fn=>{held.set(++serial,fn);late.push(fn);return serial;};uiMotion.cancel=id=>{if(!held.delete(id))cancel(id);};
      window.resume=()=>{uiMotion.frame=frame;uiMotion.cancel=cancel;for(const fn of held.values())frame(fn);held.clear();};
      emit('monitor_stow',{placement:10});emit('monitor_stow',{placement:11});
    });
    await page.waitForFunction(()=>calls.some(([name,args])=>name==='monitor_stowed'&&args.placement===11));
    assert.deepEqual(await page.evaluate(()=>calls.filter(([name])=>name==='monitor_stowed').map(([,args])=>args.placement)),[11]);
    await page.evaluate(()=>emit('layout',{width:1500,height:800,scale:1,edge:'top',along:.5,visible:true,placement:11}));
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(()=>calls.some(([name])=>name==='monitor_placed')),false,'viewport mismatch must remain masked');
    assert.equal(await page.evaluate(()=>document.getElementById('root').classList.contains('placing')),true);
    await page.setViewportSize({width:1500,height:800});
    await page.waitForFunction(()=>calls.some(([name,args])=>name==='monitor_placed'&&args.placement===11));
    await page.evaluate(()=>{for(const fn of [...late])fn();resume();});await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>calls.filter(([name,args])=>name==='monitor_placed'&&args.placement===11).length),1,'late frames must not duplicate acknowledgment');
    for(const edge of ['top','right','bottom','left']){
      await page.evaluate(edge=>{emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,placement:null});notice('Display placement could not finish. Reveal the notch again to retry.');},edge);
      const box=await page.locator('#notice').boundingBox();assert.ok(box.x>0&&box.y>0&&box.x+box.width<=1500&&box.y+box.height<=800);
    }
    await page.screenshot({path:path.join(OUT,'positioned-notice.png')});
    await page.waitForFunction(()=>document.getElementById('notice').textContent==='',null,{timeout:7000});
    assert.equal(await page.locator('#notice').isVisible(),false,'expired warning stays hidden on the next reveal');
    assert.deepEqual(errors,[]);
    console.log('PASS: suspended and late frames, stale tokens, viewport safety, positioned notices on all edges and expiry');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
