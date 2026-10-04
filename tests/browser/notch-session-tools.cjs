'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/agent-usage-session-tools';fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1.25}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   const listeners={},now=Date.now();window.__calls=[];window.__pins=[];window.__focus=[];
   const accounts=['codex_a','claude_b','gemini_c'].map((id,i)=>({id,base:['codex','claude','gemini'][i],name:['Codex a','Claude b','AGY c'][i],glyph:['Cx','Cl','A'][i],snap:{status:'ok',windows:[{id:'session',label:'Five hours',used:.35,resets_at:now+3600e3},{id:'secondary',label:'Weekly',used:.45,resets_at:now+7*86400e3}],fetched_at:now,details:[],note:''}}));
   window.__library=accounts.flatMap((a,index)=>Array.from({length:32},(_,i)=>({id:a.id+'-'+i,account:a.id,accountName:a.name,provider:['codex','claude','antigravity'][index],name:i===0?['Agent Usage','Orbit planning','Homelab maintenance'][index]:a.name+' session '+i,workspace:'/srv/'+['agent-usage','orbit','homelab'][index],since:now-i*3600e3-index*1000,live:i===1,state:'busy',canOpen:i!==31,pinned:false})));
   const answers={get_agent_accounts:accounts,get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en'},get_activity:[],get_notch_slots:[],get_notch_edge:'top',get_weekly_ring:'outside',get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true},get_update_state:{status:'current'}};
   window.__emit=(name,payload)=>(listeners[name]||[]).forEach(fn=>fn(payload));
   window.agentUsage={on:(name,fn)=>{(listeners[name]??=[]).push(fn);return()=>{};},invoke:async(name,args={})=>{
    __calls.push([name,args]);
    if(name==='get_session_library')return window.__deferLibrary?new Promise(resolve=>(window.__libraryLoads??=[]).push(resolve)):__library;
    if(name==='get_session_history')return __library.filter(s=>s.account===args.account).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.since-a.since);
    if(name==='get_session_pins')return __pins;
    if(name==='set_session_pin'){__pins=__pins.filter(s=>s.id!==args.id||s.account!==args.account);if(args.on)__pins.push({id:args.id,account:args.account});__library=__library.map(s=>({...s,pinned:__pins.some(p=>p.id===s.id&&p.account===s.account)}));__emit('session_pins',__pins);return args.on;}
    if(name==='get_focus_accounts')return __focus;
    if(name==='set_focus_accounts'){__focus=args.accounts;__emit('focus_accounts',__focus);return __focus;}
    if(name.startsWith('open_')&&name.endsWith('_session'))return new Promise((resolve,reject)=>{window.__completeResume=resolve;window.__failResume=reject;});
    return answers[name]??null;
   }};
  });
  await page.goto('file://'+UI+'/notch.html');await page.addStyleTag({content:'html{background:#52667d}'});await page.waitForTimeout(400);
  for(const edge of ['top','right','bottom','left']){
   await page.mouse.move(0,0);await page.evaluate(edge=>{hideCard();__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});__emit('appear',{edge});},edge);await page.waitForTimeout(900);
   await page.evaluate(()=>{holdCard('codex_a');pill.querySelector('[data-p=codex_a]').focus();__emit('session_switcher',true);pill.querySelector('[data-p=codex_a]').focus();});await page.waitForTimeout(1200);
   assert.equal(await page.locator('.session-search').evaluate(el=>el===document.activeElement),true,'shortcut focuses the search input');
   assert.equal(await page.locator('.session-head kbd,.session-reload,.session-head .session-close').count(),0,'Sessions has no shortcut badge or reload control');
   assert.equal(await page.locator('.session-result').count(),96);
   const box=await page.locator('#card').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=1280.5&&box.y+box.height<=800.5,'switcher fits '+edge);
   assert.ok(Math.abs(box.x*1.25-Math.round(box.x*1.25))<.02&&Math.abs(box.y*1.25-Math.round(box.y*1.25))<.02,'settled Sessions lands on the device pixel grid');
   assert.ok(await page.locator('.session-results').evaluate(el=>el.scrollHeight>el.clientHeight),'sessions scroll in a bounded lobe');
   await page.locator('.session-account').click();await page.waitForTimeout(350);
   assert.equal(await page.locator('.session-agent-option').count(),4);
   await page.screenshot({path:path.join(OUT,edge+'-agent-filter.png')});
   await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
   assert.equal(await page.locator('.session-result').count(),32);
   await page.locator('.session-account').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Home');await page.keyboard.press('Enter');
   assert.equal(await page.locator('.session-result').count(),96);
   await page.locator('.session-account').click();await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>sessionSwitcherShowing()),true,'Escape closes the filter first');
   await page.locator('.session-search').fill('Orbit');await page.waitForTimeout(100);assert.equal(await page.locator('.session-result').count(),32);
   await page.locator('.session-search').fill('planning');await page.waitForTimeout(100);assert.equal(await page.locator('.session-result').count(),1);
   if(await page.locator('.session-pin').getAttribute('aria-pressed')==='true'){await page.locator('.session-pin').click();assert.equal(await page.locator('.session-pin').getAttribute('aria-pressed'),'false');}
   await page.locator('.session-pin').click();assert.equal(await page.locator('.session-pin').getAttribute('aria-pressed'),'true');
   await page.locator('.session-search').fill('');await page.waitForTimeout(150);assert.match(await page.locator('.session-open').first().innerText(),/Orbit planning/,'pinned chat rises above more recent chats');
   await page.waitForTimeout(600);await page.screenshot({path:path.join(OUT,edge+'-switcher.png')});
   await page.locator('.session-search').focus();await page.keyboard.press('ArrowDown');assert.equal(await page.evaluate(()=>sessionIndex),1);
   await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');await page.waitForTimeout(100);
   assert.equal(await page.locator('.session-handoff[data-status="opened"]').count(),0,'success waits for VS Code acknowledgement');
   assert.equal(await page.locator('.session-handoff').count(),1);
   await page.evaluate(()=>__completeResume(true));await page.waitForTimeout(150);
   assert.equal(await page.locator('.session-handoff[data-status="opened"]').count(),1);
   assert.equal(await page.locator('#card').evaluate(el=>el.classList.contains('show')),false);
   assert.ok(await page.evaluate(()=>__calls.some(c=>c[0]==='close_session_switcher')),'keyboard focus is released on close');
   await page.waitForTimeout(950);
   await page.evaluate(()=>__emit('focus_accounts',['codex_a']));await page.waitForTimeout(1300);
   const small=await page.locator('#pill').boundingBox();assert.ok((['top','bottom'].includes(edge)?small.width:small.height)<120,'focus contracts to a single agent');
   const cellsBefore=await page.locator('.cell').count();
   await page.evaluate(()=>__emit('notch_pointer',true));await page.waitForTimeout(1000);
   const full=await page.locator('#pill').boundingBox();assert.ok((['top','bottom'].includes(edge)?full.width:full.height)>small[['top','bottom'].includes(edge)?'width':'height']+100,'hover restores all agents');
   assert.equal(await page.locator('.cell').count(),cellsBefore,'focus retains the live ring nodes');
   await page.screenshot({path:path.join(OUT,edge+'-focus-open.png')});
   assert.equal(await page.locator('.cell').evaluateAll(els=>els.every(el=>getComputedStyle(el).overflow==='visible')),true,'expanded weekly rings are never clipped by the cell');
   await page.evaluate(()=>{__emit('notch_pointer',false);__emit('focus_accounts',['codex_a','gemini_c']);});await page.waitForTimeout(1200);
   const group=await page.locator('#pill').boundingBox();assert.ok((['top','bottom'].includes(edge)?group.width:group.height)>180&&(['top','bottom'].includes(edge)?group.width:group.height)<200,'two focus accounts stay unfolded at rest');
   assert.equal(await page.locator('.cell[data-p="gemini_c"]').getAttribute('tabindex'),'0');assert.equal(await page.locator('.cell[data-p="claude_b"]').getAttribute('tabindex'),'-1');
   for(const selection of [['codex_a'],['codex_a','gemini_c']]){
    await page.evaluate(selection=>{__emit('focus_accounts',selection);__emit('edge_cursor',{edge:layout.edge,x:innerWidth/2,y:innerHeight/2});__emit('notch_pointer',true);},selection);await page.waitForTimeout(1000);
    assert.equal(await page.locator('.cell[data-p="claude_b"]').getAttribute('tabindex'),'-1','held dragging keeps unfocused accounts folded');
    assert.equal(await page.locator('.cell[data-p="gemini_c"]').getAttribute('tabindex'),selection.length===2?'0':'-1','dragging preserves the selected focus group');
    await page.evaluate(()=>{__emit('release');__emit('notch_pointer',false);});await page.waitForTimeout(800);
    await page.evaluate(()=>__emit('move_begin'));await page.waitForTimeout(800);
    assert.equal(await page.locator('.cell[data-p="claude_b"]').getAttribute('tabindex'),'-1','mouse dragging also preserves the focus group');
    await page.evaluate(()=>{__emit('move_end');__emit('notch_pointer',false);});await page.waitForTimeout(800);
   }
   const movement=await page.evaluate(async()=>{
    const lengths=[];let ended=false;const sample=()=>{const box=pill.getBoundingClientRect();lengths.push(edgeIsVertical()?box.height:box.width);if(!ended)requestAnimationFrame(sample);};requestAnimationFrame(sample);
    __emit('focus_accounts',['claude_b']);await new Promise(r=>setTimeout(r,100));__emit('focus_accounts',['codex_a','claude_b']);await new Promise(r=>setTimeout(r,100));setFocusExpanded(true);await new Promise(r=>setTimeout(r,1000));ended=true;
    return Math.max(...lengths.slice(1).map((n,i)=>Math.abs(n-lengths[i])));
   });assert.ok(movement<25,'changing focused groups mid-flight never snaps the notch: '+movement);
   await page.evaluate(()=>__emit('notch_pointer',true));

   await page.evaluate(()=>{__emit('notch_pointer',false);__emit('focus_accounts',[]);notificationRim.clear();__emit('alert',{events:[{id:'done-1',kind:'completion',account:'codex_a',session:'Agent Usage',target:{},took:120000},{id:'done-2',kind:'completion',account:'claude_b',session:'Orbit planning',target:{},took:60000}],hold:6000,sound:false});});await page.waitForTimeout(1200);
   assert.equal(await page.locator('.sliver-stack').count(),1);assert.match(await page.locator('.sliver-stack').innerText(),/2 finished/);
   await page.evaluate(()=>__emit('alert',{events:[{id:'done-3',kind:'completion',account:'gemini_c',session:'Homelab maintenance',target:{}}],hold:6000,sound:false}));await page.waitForTimeout(250);
   assert.match(await page.locator('.sliver-stack').innerText(),/3 finished/,'a later completion joins the existing stack');
   await page.locator('.sliver-stack').hover();await page.waitForTimeout(1100);assert.equal(await page.locator('.finished-session').count(),3);
   await page.screenshot({path:path.join(OUT,edge+'-finished.png')});
   await page.locator('.finished-session').first().click();await page.waitForTimeout(50);await page.evaluate(()=>__completeResume(true));await page.waitForTimeout(950);
   assert.ok(await page.evaluate(()=>__calls.some(c=>c[0]==='open_alert_session'&&c[1].id==='done-1')),'each stack entry opens its own linked session');
   await page.evaluate(()=>openCompletionStack(finishedSessions));await page.waitForTimeout(1000);await page.locator('.finished-session').last().click();await page.waitForTimeout(50);await page.evaluate(()=>__completeResume(true));await page.waitForTimeout(950);
   assert.ok(await page.evaluate(()=>__calls.some(c=>c[0]==='open_alert_session'&&c[1].id==='done-3')),'AGY stack entries also resume their linked session');
  }
  await page.evaluate(()=>__emit('session_switcher',true));await page.waitForTimeout(1000);await page.locator('.session-search').fill('planning');await page.waitForTimeout(100);
  await page.keyboard.press('Enter');await page.waitForTimeout(50);await page.evaluate(()=>__failResume(new Error('VS Code connection failed')));await page.waitForTimeout(100);
  assert.match(await page.locator('.session-status').innerText(),/connection failed/);assert.equal(await page.locator('.session-handoff[data-status="opened"]').count(),0);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#card').evaluate(el=>el.classList.contains('show')),false);
  assert.equal(await page.evaluate(()=>sessionRefreshTimer),0,'automatic refresh stops when Sessions closes');
  await page.evaluate(()=>__emit('session_switcher',true));await page.waitForTimeout(1000);
  assert.equal(await page.locator('.session-search').inputValue(),'planning','reopening keeps the last search and the matching results in sync');
  await page.locator('.session-search').fill('codex');await page.waitForTimeout(100);await page.keyboard.press('ArrowDown');
  const selection=await page.evaluate(()=>sessionMatches[sessionIndex].id);
  await page.locator('.session-results').evaluate(el=>el.scrollTop=80);
  await page.evaluate(()=>{__library=__library.map(s=>({...s,name:s.name+' updated'}));__emit('activity',[{id:'fresh',account:'codex_a',state:'busy'}]);});await page.waitForTimeout(1250);
  assert.equal(await page.locator('.session-search').inputValue(),'codex','automatic refresh preserves search');
  assert.equal(await page.evaluate(()=>sessionMatches[sessionIndex].id),selection,'automatic refresh preserves selection');
  assert.equal(await page.locator('.session-results').evaluate(el=>el.scrollTop),80,'automatic refresh preserves scroll');
  assert.ok(await page.evaluate(()=>__calls.some(c=>c[0]==='get_session_library'&&c[1].refresh===true)),'automatic refresh requests fresh collector history');
  assert.match(await page.locator('.session-open').first().innerText(),/updated/);
  await page.evaluate(()=>__emit('session_follow'));await page.waitForTimeout(120);
  assert.equal(await page.evaluate(()=>sessionSwitcherShowing()),false);
  assert.ok(await page.evaluate(()=>detailOpen>0&&detailOpen<1),'Scroll Lock closes the lobe smoothly before movement');
  await page.waitForTimeout(1300);assert.ok(await page.evaluate(()=>__calls.some(c=>c[0]==='session_follow_ready')),'movement begins once the lobe closes');
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{__emit('disappear');__emit('session_switcher',true);hideCard();});
  assert.equal(await page.evaluate(()=>switcherPending),true,'a closed card cannot cancel a shortcut queued while hidden');
  await page.evaluate(()=>{__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge:'top',along:.5,visible:true,tracking:false,pinned:false});__emit('appear',{edge:'top'});});await page.waitForTimeout(1100);
  assert.equal(await page.locator('.session-search').evaluate(el=>el===document.activeElement),true,'a hidden notch reveals the queued switcher');
  await page.evaluate(()=>{window.__deferLibrary=true;loadSessionLibrary(true);__emit('session_history_reset');});
  assert.equal(await page.evaluate(()=>__libraryLoads.length),2,'changing collector starts a new load despite an older pending request');
  await page.evaluate(()=>__libraryLoads[1]([{...__library[0],name:'New host chat'}]));await page.waitForTimeout(100);
  await page.evaluate(()=>__libraryLoads[0]([{...__library[0],name:'Old host chat'}]));await page.waitForTimeout(100);
  assert.match(await page.locator('.session-open').first().innerText(),/New host chat/,'late previous-host results cannot replace the current session list');
  await page.evaluate(()=>{window.__deferLibrary=false;});await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.__savedAccounts=agentAccounts.slice();__emit('notch_pointer',false);__emit('focus_accounts',['claude_b']);__emit('agent_accounts',__savedAccounts.slice(0,1));});await page.waitForTimeout(300);
  await page.evaluate(()=>__emit('agent_accounts',__savedAccounts));await page.waitForTimeout(1300);
  const restored=await page.locator('#pill').boundingBox();assert.ok(restored.height<120,'a saved focus group contracts when its accounts arrive, without requiring a hover');
  assert.equal(await page.locator('.cell[data-p="claude_b"]').getAttribute('tabindex'),'0');
  await page.evaluate(()=>{__emit('layout',{width:innerWidth,height:innerHeight,scale:.8,edge:'top',along:.5,visible:true,tracking:false,pinned:false});__emit('session_switcher',true);});await page.waitForTimeout(1200);
  assert.equal(await page.locator('.session-name').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)*.8),14,'Small keeps session titles at readable physical size');
  assert.equal(await page.locator('.session-meta').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)*.8),12,'Small keeps account labels readable');
  await page.screenshot({path:path.join(OUT,'small-sessions.png')});await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:360,height:300});
  for(const edge of ['top','right','bottom','left']){
   await page.evaluate(edge=>{__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});__emit('session_switcher',true);},edge);await page.waitForTimeout(150);
   const box=await page.locator('#card').boundingBox();assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=360.5&&box.y+box.height<=300.5,'small switcher fits '+edge);
   await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);console.log('Passed session tools: keyboard search on four edges, pins, bounded scrolling, acknowledged resume effects, focus contraction/hover, retained ring nodes, stacked completions, individual resume, failure, Escape, reduced motion and small viewports.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
