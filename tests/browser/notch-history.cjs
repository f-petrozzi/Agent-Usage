'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/agent-usage-history-browser';
fs.mkdirSync(OUT,{recursive:true});
const now=Date.now();
const accounts=['claude','codex-b','antigravity'].map(id=>({id,base:id==='antigravity'?'gemini':id.startsWith('codex')?'codex':'claude',name:id==='claude'?'Claude Cedar':id==='antigravity'?'Antigravity':'Codex Birch',glyph:'C',
  snap:{status:'ok',windows:[{id:'session',label:'Five hours',used:.35,resets_at:now+3600e3}],fetched_at:now,details:[],note:'',resets:{count:1,expires:now+86400e3,each:[{at:now+86400e3,count:1,known:true}]}}}));
(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({accounts,now})=>{
      const listeners={},calls=[];window.__calls=calls;
      const answers={get_agent_accounts:accounts,get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en',clock_24h:false},get_activity:[],get_notch_slots:[],get_notch_edge:'top',get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true},get_update_state:{status:'current'},get_session_pins:[]};
      window.agentUsage={invoke:async(c,a)=>{
        calls.push([c,a]);
        if(c==='get_session_library')return accounts.flatMap(account=>Array.from({length:30},(_,i)=>({account:account.id,accountName:account.name,workspace:'/srv/projects/agent-usage',id:account.id+'-'+i,sessionId:'12345678-1234-5678-abcd-123456789012',name:`${i===0?'Inspect session route':i===1?'Refine the liquid outline':'Workspace review '+(i+1)}`,since:now-i*3600e3,live:i===0,state:'busy',canOpen:true})));
        if(c==='open_history_session'||c==='open_working_session')return true;
        return c in answers?answers[c]:null;
      },on:(n,cb)=>{(listeners[n]??=[]).push(cb);return()=>{};}};
      window.__emit=(n,p)=>(listeners[n]||[]).forEach(cb=>cb(p));
    },{accounts,now});
    await page.goto('file://'+UI+'/notch.html');await page.addStyleTag({content:'html{background:#52667d}'});await page.waitForTimeout(400);
    for(const edge of ['top','right','bottom','left']){
      await page.evaluate(edge=>{hideCard();__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});__emit('appear',{edge});},edge);await page.waitForTimeout(900);
      await page.evaluate(()=>{hoverId='claude';showCard();});await page.waitForTimeout(1100);
      assert.equal(await page.locator('.c-history').count(),0,'quota peeks contain no chat disclosure');
      assert.equal(await page.evaluate(()=>__calls.filter(([c])=>c==='get_session_history').length),0,'peeking never fetches account chat history');
      assert.equal(await page.locator('.c-history-trigger').getAttribute('aria-label'),'Sessions for Claude Cedar');
      assert.ok(await page.locator('.c-history-trigger').evaluate(e=>e.offsetWidth>=32&&e.offsetHeight>=32),'quiet icon has an accessible target');
      await page.screenshot({path:path.join(OUT,edge+'-usage.png')});
      // Use the real click handler without Playwright waiting for the new moving frame to settle.
      const start=await page.evaluate(()=>{card.querySelector('.c-history-trigger').click();return {open:detailOpen,target:detailTarget,focus:document.activeElement.className,account:sessionAccount};});
      assert.ok(start.open>.98&&start.target===1,'the morph never closes the existing lobe');
      assert.equal(start.focus,'session-search','search receives focus in the click turn');assert.equal(start.account,'claude');
      await page.locator('.session-search').fill('outline');await page.waitForTimeout(70);
      assert.equal(await page.locator('.session-result').count(),1,'search works while the droplet moves');
      await page.evaluate(()=>{sessionDrop.start=performance.now()-160;drawSessionDroplet(performance.now());});
      const drop=await page.evaluate(()=>{const bead=sessionDropInk.querySelector('.drop-bead');return {visible:getComputedStyle(sessionDropInk).display!=='none',extent:Number(bead.getAttribute('cy'))+Number(bead.getAttribute('ry'))-detailPath.rimPart[2],neck:!!sessionDropInk.querySelector('.drop-neck').getAttribute('d'),filter:getComputedStyle(card).filter};});
      assert.ok(drop.visible&&drop.extent>18&&drop.neck,'a visible bead and connected neck project outside the actual outline');
      assert.equal(drop.filter,'none','readable content is never goo filtered');
      await page.screenshot({path:path.join(OUT,edge+'-droplet.png')});
      await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>sessionDrop),null,'bead completes and removes its animation');
      await page.locator('.session-search').fill('');await page.waitForTimeout(450);
      assert.equal(await page.locator('.session-result').count(),30,'the icon opens only its account');
      const expanded=await page.locator('#card').boundingBox(),anchor=await page.locator('#pill').boundingBox();
      assert.ok(expanded.x>=0&&expanded.y>=0&&expanded.x+expanded.width<=1280.5&&expanded.y+expanded.height<=800.5);
      if(edge==='top'||edge==='bottom')assert.ok(Math.abs(expanded.x+expanded.width/2-anchor.x-anchor.width/2)<1,'horizontal morph stays centered');
      else assert.ok(Math.abs(expanded.y+expanded.height/2-anchor.y-anchor.height/2)<1,'side morph retains its attached center');
      assert.ok(await page.evaluate(()=>detailContains(...(()=>{const a=pill.getBoundingClientRect(),b=card.getBoundingClientRect();return notchEdge==='top'?[a.x+a.width/2,b.y+1]:notchEdge==='bottom'?[a.x+a.width/2,b.bottom-1]:notchEdge==='left'?[b.x+1,a.y+a.height/2]:[b.right-1,a.y+a.height/2];})())),'ink connects Sessions directly to the notch');
      await page.screenshot({path:path.join(OUT,edge+'-sessions.png')});
      await page.locator('.session-results').hover();await page.mouse.wheel(0,480);await page.waitForTimeout(150);
      const before=await page.locator('.session-results').evaluate(e=>e.scrollTop);assert.ok(before>0);
      await page.evaluate(()=>renderCard());assert.equal(await page.locator('.session-results').evaluate(e=>e.scrollTop),before,'refresh retains scroll');
      await page.locator('.session-back').click();await page.waitForTimeout(450);
      assert.equal(await page.locator('#card').getAttribute('data-account'),'claude','Back restores the original quota account');
      await page.locator('.c-history-trigger').focus();await page.keyboard.press('Enter');await page.waitForTimeout(450);
      await page.locator('.session-search').fill('outline');await page.waitForTimeout(100);await page.keyboard.press('Enter');await page.waitForTimeout(100);
      assert.deepEqual(await page.evaluate(()=>__calls.findLast(([c])=>c==='open_history_session')[1]),{id:'claude-1',account:'claude'},'resume retains the account and session identity');
      await page.evaluate(()=>{hoverId='codex-b';showCard();});await page.waitForTimeout(1000);
      await page.locator('.c-history-trigger').click();await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>sessionAccount),'codex-b');
      await page.evaluate(()=>requestSessionSwitcher());assert.equal(await page.evaluate(()=>sessionAccount),'','the global shortcut opens All agents');assert.equal(await page.locator('.session-back').isVisible(),false);
      await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>sessionDrop),null,'closing cancels the bead immediately');await page.waitForTimeout(600);
    }
    await page.evaluate(()=>{const account=agentAccounts.find(a=>a.id==='antigravity');account.snap.windows.push({id:'claude',label:'Claude models',used:.5},{id:'3p-gpt',label:'GPT models',used:.6});__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge:'right',along:.5,visible:true,tracking:false,pinned:false});hoverId='antigravity';showCard();__emit('activity',[{account:'antigravity',provider:'antigravity',id:'live-agy',sessionId:'12345678-1234-5678-abcd-123456789012',name:'Live AGY',detail:'Working',state:'busy',since:Date.now()}]);renderCard();});await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(()=>!!card.querySelector('.inline-extras')&&!!(card.querySelector('.inline-extras').compareDocumentPosition(card.querySelector('.c-sessions'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'AGY quotas still precede live sessions on side edges');
    await page.locator('.session-link').click();assert.deepEqual(await page.evaluate(()=>__calls.findLast(([c])=>c==='open_working_session')[1]),{id:'live-agy',account:'antigravity'});
    await page.evaluate(()=>{hoverId='claude';showCard();});await page.waitForTimeout(1100);
    for(const action of ['hide','follow','monitor']){
      await page.evaluate(()=>{hoverId='claude';showCard();});await page.waitForTimeout(1000);
      await page.evaluate(action=>{requestSessionSwitcher(true,'claude');if(action==='hide')hideCard();else if(action==='follow')__emit('session_follow');else __emit('monitor_stow',{placement:{}});},action);
      assert.equal(await page.evaluate(()=>sessionDrop),null,'closing/dragging/monitor transfer cancels stale liquid geometry: '+action);
      await page.waitForTimeout(450);assert.equal(await page.evaluate(()=>sessionDropInk.style.display),'none');
    }
    await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:360,height:300});
    for(const edge of ['top','right','bottom','left']){
      await page.evaluate(edge=>{__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false,placement:1});},edge);await page.waitForTimeout(100);
      await page.evaluate(edge=>{__emit('appear',{edge});hoverId='antigravity';showCard();requestSessionSwitcher(true,'antigravity');},edge);await page.waitForTimeout(100);
      const b=await page.locator('#card').boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=360.5&&b.y+b.height<=300.5,'small viewport fits '+edge);
      assert.equal(await page.evaluate(()=>sessionDrop),null,'reduced motion changes views immediately');
      const hit=await page.locator('.session-back').evaluate(e=>{const b=e.getBoundingClientRect();return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest('.session-back')===e;});assert.ok(hit,'Back wins the hit test over retracted pocket targets');
      await page.waitForTimeout(50);assert.ok(await page.evaluate(()=>!__calls.findLast(([c])=>c==='set_hot')[1].controls.pin&&!__calls.findLast(([c])=>c==='set_hot')[1].controls.settings),'native relayed clicks cannot activate retracted controls');
      assert.ok(await page.evaluate(()=>orb.inert&&pinHandle.inert),'retracted controls are also removed from keyboard focus');
      await page.locator('.session-back').click();assert.equal(await page.locator('#card').getAttribute('data-account'),'antigravity');await page.evaluate(()=>hideCard());
    }
    assert.deepEqual(errors,[]);console.log('Passed history morph: visible attached droplet on four edges, immediate search, account filter, Back, keyboard resume, bounded scroll, global shortcut, AGY Working, cancellation, reduced motion and small viewports.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
