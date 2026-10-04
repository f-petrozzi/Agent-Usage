'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/agent-usage-v5';fs.mkdirSync(OUT,{recursive:true});
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  const listeners={},now=Date.now(),accounts=['codex','claude'].map(id=>({id,base:id,name:id,glyph:'C',snap:{status:'ok',windows:[{id:'primary',label:'5 hours',used:.8,resets_at:now-1000}],fetched_at:now,note:'',details:[]}}));
  const answers={get_agent_accounts:accounts,get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en'},get_activity:[],get_notch_slots:[],get_notch_edge:'right',get_glyphs:{},get_ui_flags:{},get_update_state:{status:'current'},get_alert_preferences:{quota:true,waiting:true,completion:true,sound:false,muted:[]},get_alert_log:[]};
  window.__calls=[];window.__emit=(n,p)=>(listeners[n]||[]).forEach(fn=>fn(p));window.agentUsage={invoke:async(c,a)=>{__calls.push([c,a]);return answers[c]??null;},on:(n,fn)=>{(listeners[n]??=[]).push(fn);return()=>{};}};
 });
 await page.goto('file://'+UI+'/notch.html');await page.addStyleTag({content:'html{background:#52667d}'});await page.waitForTimeout(350);
 const checkContour=async account=>{
  const outline=await page.evaluate(account=>{
   const s=slivers.get(account),el=s.countdown,d=el.getAttribute('d'),length=el.getTotalLength(),m=s.path.getScreenCTM().inverse();
   const samples=Array.from({length:65},(_,i)=>{const p=el.getPointAtLength(length*i/64),q=new DOMPoint(p.x,p.y).matrixTransform(m);return{x:q.x,y:q.y};});
   const [u0,u1,depth,radius]=s.path.rimPart;
   const distance=p=>Math.min(Math.abs(p.x-u0),Math.abs(p.x-u1),Math.abs(p.y-depth),
    p.x<=u0+radius&&p.y>=depth-radius?Math.abs(Math.hypot(p.x-u0-radius,p.y-depth+radius)-radius):Infinity,
    p.x>=u1-radius&&p.y>=depth-radius?Math.abs(Math.hypot(p.x-u1+radius,p.y-depth+radius)-radius):Infinity);
   return{moves:(d.match(/M/g)||[]).length,closed:/Z/i.test(d),maxError:Math.max(...samples.map(distance)),
    reachesTip:samples.some(p=>Math.abs(p.y-depth)<.1),touchesBothSides:samples.some(p=>Math.abs(p.x-u0)<.1)&&samples.some(p=>Math.abs(p.x-u1)<.1)};
  },account);
  assert.equal(outline.moves,1,'countdown has one seamless contour');assert.equal(outline.closed,false,'no countdown across the attachment seam');
  assert.ok(outline.maxError<.1&&outline.reachesTip&&outline.touchesBothSides,'countdown follows the real ink sides and rounded front');
 };
 const place=async edge=>{await page.mouse.move(400,300);await page.evaluate(edge=>{retractSlivers(true);notchEffects.clear();hideCard();__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});__emit('appear',{edge});},edge);await page.waitForTimeout(850);};
 for(const edge of ['top','right','bottom','left']){
  await place(edge);
  await page.evaluate(()=>showSliver('claude',[{id:'countdown',account:'claude',kind:'completion',session:'Review'}],2600));await page.waitForTimeout(850);
  await checkContour('claude');
  const initial=await page.locator('.sliver-countdown').evaluate(el=>parseFloat(getComputedStyle(el).strokeDasharray));
  await page.waitForTimeout(200);assert.ok(await page.locator('.sliver-countdown').evaluate(el=>parseFloat(getComputedStyle(el).strokeDasharray))<initial-4,'countdown drains');
  await page.evaluate(()=>holdSlivers(true));const frozen=await page.locator('.sliver-countdown').evaluate(el=>parseFloat(getComputedStyle(el).strokeDasharray));
  await page.waitForTimeout(2900);assert.equal(await page.evaluate(()=>slivers.size),1,'reading pauses expiry');
  assert.ok(Math.abs(await page.locator('.sliver-countdown').evaluate(el=>parseFloat(getComputedStyle(el).strokeDasharray))-frozen)<.1,'reading pauses the outline too');
  await page.evaluate(()=>notificationRim.clear());await page.screenshot({path:path.join(OUT,edge+'-countdown.png')});
  await page.evaluate(()=>holdSlivers(false));await page.waitForTimeout(150);
  assert.ok(await page.locator('.sliver-countdown').evaluate(el=>parseFloat(getComputedStyle(el).strokeDasharray))<frozen,'resume continues from the held fraction');
  await page.waitForTimeout(2000);assert.equal(await page.locator('.sliver-countdown').count(),0,'expiry removes the outline');
  // A single bounded body stretch on docking; gauges and text retain their layout.
  await page.evaluate(()=>{__emit('edge_cursor',{edge:layout.edge,perimeter:perimeterAt(layout.edge,.5)});__emit('release');});
  await page.waitForTimeout(150);assert.ok(Math.abs(await page.evaluate(()=>notchEffects.dock.value))>.5,'release stretches the ink');
  assert.equal(await page.locator('.ringwrap').first().evaluate(el=>getComputedStyle(el).transform),'none','docking does not scale gauges');
  await page.screenshot({path:path.join(OUT,edge+'-dock.png')});
  await page.waitForTimeout(750);assert.deepEqual(await page.evaluate(()=>[notchEffects.dock.value,notchEffects.dock.frame]),[0,0],'docking settles and stops');
  // Several finished chats gather, with at most three transient droplets for a batch.
  await page.evaluate(()=>showSliver(FINISHED_ID,[{id:'merge-a',kind:'completion',account:'claude',session:'A'},{id:'merge-b',kind:'completion',account:'codex',session:'B'}],6000));
  await page.waitForFunction(()=>document.querySelectorAll('.notification-droplet').length>0);
  assert.ok(await page.locator('.notification-droplet').count()<=3);assert.equal(await page.locator('.notification-droplet').first().evaluate(el=>getComputedStyle(el).pointerEvents),'none');
  await page.waitForTimeout(120);await page.screenshot({path:path.join(OUT,edge+'-merge.png')});
  await page.waitForTimeout(1000);assert.equal(await page.locator('.notification-droplet').count(),0,'merged drops leave no persistent animation');
  assert.equal(await page.evaluate(()=>slivers.get(FINISHED_ID).events.length),2,'visual merging preserves sessions');await page.evaluate(()=>notificationRim.clear());await checkContour('__finished');await page.screenshot({path:path.join(OUT,edge+'-finished-contour.png')});
  await page.evaluate(()=>showSliver(FINISHED_ID,[...slivers.get(FINISHED_ID).events,{id:'merge-next',kind:'completion',account:'claude',session:'Next'}],6000));
  await page.waitForFunction(()=>document.querySelectorAll('.notification-droplet').length===1);
  await page.evaluate(()=>retract(slivers.get(FINISHED_ID)));assert.equal(await page.locator('.notification-droplet').count(),0,'closing the stack absorbs any in-flight drop');
  await page.waitForTimeout(400);
  await page.evaluate(()=>__emit('move_begin'));assert.equal(await page.locator('.sliver-countdown,.notification-droplet,.quota-renewal').count(),0,'carrying clears transient surfaces');
  await page.evaluate(()=>{__emit('release');__emit('move_end');});
 }
 await place('right');
 const detection=await page.evaluate(()=>{
  const now=Date.now(),old=[{...agentAccounts[0],snap:{...agentAccounts[0].snap,windows:[{id:'p',label:'5 hours',used:.9,resets_at:now-1000}],fetched_at:now}}];
  const next=[{...old[0],snap:{...old[0].snap,windows:[{id:'p',label:'5 hours',used:.05,resets_at:now+3600000}]}}];
  const shifted=[{...old[0],snap:{...old[0].snap,windows:[{id:'p',label:'5 hours',used:.7,resets_at:now+3600000}]}}];
  const unexpired=[{...old[0],snap:{...old[0].snap,windows:[{id:'p',label:'5 hours',used:.9,resets_at:now+20000}]}}];
  const stale=[{...old[0],snap:{...old[0].snap,fetched_at:now-3600000}}];
  return{actual:notchEffects.renewals(old,next,now).length,initial:notchEffects.renewals([],next,now).length,estimate:notchEffects.renewals(unexpired,shifted,now).length,
   stale:notchEffects.renewals(stale,next,now).length,same:notchEffects.renewals(next,next,now).length};
 });assert.deepEqual(detection,{actual:1,initial:0,estimate:0,stale:0,same:0});
 await page.evaluate(()=>{
  const now=Date.now();__emit('agent_accounts',agentAccounts.map(a=>({...a,snap:{...a.snap,windows:[{...a.snap.windows[0],used:.9,resets_at:now-1000}],fetched_at:now}})));
  __emit('agent_accounts',agentAccounts.map(a=>({...a,snap:{...a.snap,windows:[{...a.snap.windows[0],used:.03,resets_at:now+3600000}],fetched_at:now}})));
 });
 await page.waitForTimeout(180);assert.equal(await page.locator('.quota-renewal').count(),2,'real account updates sweep each renewed gauge');
 await page.screenshot({path:path.join(OUT,'quota-reset.png')});await page.waitForTimeout(1100);assert.equal(await page.locator('.quota-renewal').count(),0);
 // Sample combined motion once, and report actual frames rather than asserting a device-specific refresh rate.
 const frames=await page.evaluate(async()=>{
  const times=[];let last=performance.now(),start=last;
  showSliver(FINISHED_ID,[{id:'fps-a',kind:'completion',account:'claude',session:'A'},{id:'fps-b',kind:'completion',account:'codex',session:'B'}],5000);
  notchEffects.renewed([{account:'codex',window:'primary'}]);
  await new Promise(resolve=>{const tick=now=>{times.push(now-last);last=now;if(now-start<1300)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
  return times.slice(1).sort((a,b)=>a-b);
 });console.log(JSON.stringify({frames:frames.length,median:frames[Math.floor(frames.length*.5)],p95:frames[Math.floor(frames.length*.95)],over34:frames.filter(n=>n>34).length}));
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.evaluate(()=>{retractSlivers(true);__emit('edge_cursor',{edge:'right',perimeter:perimeterAt('right',.5)});__emit('release');showSliver(FINISHED_ID,[{id:'r-a',kind:'completion',account:'claude'},{id:'r-b',kind:'completion',account:'codex'}],2000);});
 await page.waitForTimeout(100);assert.equal(await page.locator('.notification-droplet').count(),0);assert.deepEqual(await page.evaluate(()=>[notchEffects.dock.value,notchEffects.dock.frame]),[0,0]);
 assert.equal(await page.locator('.sliver-countdown').evaluate(el=>el.getAnimations().length),0,'reduced motion keeps the countdown stationary');await checkContour('__finished');
 await page.evaluate(()=>__emit('monitor_stow',{placement:99}));assert.equal(await page.locator('.sliver-countdown,.notification-droplet,.quota-renewal').count(),0);
 assert.deepEqual(errors,[]);console.log('Passed 5.0 motion: countdown pause/resume and expiry, docking settlement, stack droplets and cleanup on four edges, genuine quota renewals, initial/corrected/stale readings, combined frame sample, reduced motion and monitor stow.');
 }finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
