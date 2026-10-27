// Real renderer activity rings use each account's own synthetic feed state.
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {parseSessions,accountId}=require('../../desktop/collector.cjs');
const output=process.argv[2]||path.resolve(__dirname,'../../artifacts/activity-account-isolation');
fs.mkdirSync(output,{recursive:true});
const raw=[
  {provider:'claude',account:'claude',id:'parent',name:'Synthetic parent',state:'busy',since:1},
  {provider:'codex',account:'codex:a',id:'helper-a',name:'Synthetic helper A',parentId:'parent',state:'idle'},
  {provider:'codex',account:'codex:b',id:'helper-b',name:'Synthetic helper B',parentId:'parent',state:'idle'},
];
const activity=rows=>parseSessions(JSON.stringify({schema:1,sessions:rows}));
const accounts=raw.map(row=>({id:accountId(row.provider,row.account),base:row.provider,name:row.name,glyph:'Cx',
  snap:{status:'ok',fetched_at:Date.now(),windows:[{id:'primary',label:'5-hour',used:.2,resets_at:Date.now()+3600000,count:null}],details:[]}}));
(async()=>{
 const browser=await chromium.launch();const results=[];
 try {
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:800}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(({accounts,initial})=>{
    const answers={get_agent_accounts:accounts,get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true},get_notch_edge:'top',get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en'},get_usage:accounts[0].snap,get_codex:accounts[0].snap,get_weekly_ring:'outside',get_color_transition:'ramp',get_theme_resolved:'dark',get_update_state:{status:'current'},get_notch_slots:[],get_activity:initial,get_antigravity_prefs:{limit:'automatic'}};
    const listeners={};window.agentUsage={invoke:async cmd=>answers[cmd]??null,on:(name,cb)=>{(listeners[name]??=[]).push(cb);return()=>{};}};
    window.__emit=(name,value)=>(listeners[name]||[]).forEach(cb=>cb(value));
   },{accounts,initial:activity(raw)});
   await page.goto('file://'+path.resolve(__dirname,'../../desktop/ui/notch.html'));
   await page.evaluate(()=>{__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge:'top',along:.5,visible:true,tracking:false,pinned:true});__emit('appear',{});});
   const states=()=>page.locator('.cell:not(.alerts-cell)').evaluateAll(els=>Object.fromEntries(els.map(el=>[el.dataset.p,el.querySelector('.activity-layer').dataset.state])));
   await page.waitForFunction(count=>document.querySelectorAll('.cell:not(.alerts-cell)').length===count,width===390?2:3);
   const expected=Object.fromEntries(accounts.map((a,i)=>[a.id,i?'idle':'running']));
   const assertStates=async expected=>{const actual=await states();assert.deepEqual(actual,Object.fromEntries(Object.keys(actual).map(id=>[id,expected[id]])));};
   await assertStates(expected);
   await page.waitForTimeout(1500);
   await page.screenshot({path:path.join(output,`parent-only-${width}.png`)});
   await page.evaluate(rows=>__emit('activity',rows),activity([raw[0],{...raw[1],state:'busy'},raw[2]]));
   await assertStates({...expected,[accounts[1].id]:'running'});
   await page.evaluate(rows=>__emit('activity',rows),activity(raw));
   await assertStates(expected);
   if(width===390){await page.evaluate(()=>{accountOffset=1;renderRing();});await assertStates(expected);await page.evaluate(()=>{accountOffset=0;renderRing();});}
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await page.locator('.activity-layer.running').evaluate(el=>getComputedStyle(el).animationName),'none');
   await assertStates(expected);
   await page.evaluate(()=>__emit('activity',[]));
   assert.equal(await page.locator('.activity-layer.running').count(),0);
   assert.equal(await page.locator('svg.activity circle').count(),0);
   assert.deepEqual(errors,[]);results.push({width,parentOnly:true,helperIndependent:true,reducedMotion:true});
   await page.close();
  }
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
