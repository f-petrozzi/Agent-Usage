'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/agent-usage-history-browser';
fs.mkdirSync(OUT,{recursive:true});
const now=Date.now();
const accounts=['claude','codex-b','antigravity'].map(id=>({id,base:id==='antigravity'?'gemini':id.startsWith('codex')?'codex':'claude',name:id==='claude'?'Claude':id==='antigravity'?'Antigravity':'Codex b',glyph:'C',
  snap:{status:'ok',windows:[{id:'session',label:'Five hours',used:.35,resets_at:now+3600e3}],fetched_at:now,details:[],note:'',resets:{count:1,expires:now+86400e3,each:[{at:now+86400e3,count:1,known:true}]}}}));
(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(({accounts,now})=>{
      const listeners={},calls=[];window.__calls=calls;
      const answers={get_agent_accounts:accounts,get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en',clock_24h:false},get_activity:[],get_notch_slots:[],get_notch_edge:'top',get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true},get_update_state:{status:'current'}};
      window.agentUsage={invoke:async(c,a)=>{
        if(c==='get_session_history')return Array.from({length:30},(_,i)=>({id:a.account+'-'+i,sessionId:'12345678-1234-5678-abcd-123456789012',name:`${a.account==='claude'?'Review reset dropdown':'Continue workspace work'} ${i+1}`,since:now-i*3600e3,live:i===0,state:'idle',canOpen:true}));
        if(c==='open_history_session'||c==='open_working_session'){calls.push(a);return true;}
        return c in answers?answers[c]:null;
      },on:(n,cb)=>{(listeners[n]??=[]).push(cb);return()=>{};}};
      window.__emit=(n,p)=>(listeners[n]||[]).forEach(cb=>cb(p));
    },{accounts,now});
    await page.goto('file://'+UI+'/notch.html');
    await page.addStyleTag({content:'html{background:#52667d}'});
    await page.waitForTimeout(400);
    for(const edge of ['top','right','bottom','left']){
      await page.evaluate(edge=>{hideCard();__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});__emit('appear',{edge});},edge);
      await page.waitForTimeout(1000);
      await page.evaluate(()=>{historyOpen=null;hoverId='claude';showCard();});await page.waitForTimeout(1400);
      assert.equal(await page.locator('.history-session').count(),30);
      assert.ok(await page.evaluate(()=>card.querySelector('.c-resets').nextElementSibling.classList.contains('c-history')));
      const collapsed=await page.locator('#card').boundingBox();
      await page.locator('.h-head').hover();await page.waitForTimeout(900);
      assert.equal(await page.locator('.c-history.open').count(),1);
      assert.equal(await page.locator('.h-head').getAttribute('aria-expanded'),'true');
      const dimensions=await page.locator('.h-scroll').evaluate(e=>({height:e.clientHeight,scroll:e.scrollHeight}));
      assert.ok(dimensions.height<=156&&dimensions.scroll>dimensions.height);
      const expanded=await page.locator('#card').boundingBox();assert.ok(expanded.height-collapsed.height<=157,'history has bounded height');
      assert.ok(expanded.x>=0&&expanded.y>=0&&expanded.x+expanded.width<=1280&&expanded.y+expanded.height<=800);
      await page.screenshot({path:path.join(OUT,edge+'.png')});
      await page.locator('.h-scroll').hover();await page.mouse.wheel(0,480);await page.waitForTimeout(200);
      const before=await page.locator('.h-scroll').evaluate(e=>e.scrollTop);assert.ok(before>0);
      await page.evaluate(()=>renderCard());assert.equal(await page.locator('.h-scroll').evaluate(e=>e.scrollTop),before,'refresh retains scroll');
      await page.locator('.history-session').nth(12).focus();await page.keyboard.press('Enter');await page.waitForTimeout(200);
      assert.deepEqual(await page.evaluate(()=>__calls.at(-1)),{id:'claude-12',account:'claude'});
      await page.evaluate(()=>{hoverId='codex-b';showCard();});await page.waitForTimeout(1200);
      assert.match(await page.locator('.h-item').first().innerText(),/Continue workspace work/);
      await page.locator('.h-head').focus();await page.keyboard.press('Escape');assert.equal(await page.locator('.c-history.open').count(),0);
      await page.evaluate(()=>hideCard());await page.waitForTimeout(600);
    }
    await page.evaluate(()=>{const account=agentAccounts.find(a=>a.id==='antigravity');account.snap.windows.push({id:'claude',label:'Claude models',used:.5},{id:'3p-gpt',label:'GPT models',used:.6});__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge:'right',along:.5,visible:true,tracking:false,pinned:false});hoverId='antigravity';showCard();});await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(()=>!!card.querySelector('.inline-extras') && !!(card.querySelector('.inline-extras').compareDocumentPosition(card.querySelector('.c-history'))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'AGY model quotas precede history on a side edge');
    await page.evaluate(()=>{__emit('activity',[{account:'antigravity',provider:'antigravity',id:'live-agy',sessionId:'12345678-1234-5678-abcd-123456789012',name:'Live AGY',detail:'Working',state:'busy',since:Date.now()}]);renderCard();});
    await page.locator('.session-link').click();
    assert.deepEqual(await page.evaluate(()=>__calls.at(-1)),{id:'live-agy',account:'antigravity'},'AGY Working uses the same identity route');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.setViewportSize({width:360,height:300});
    for(const edge of ['top','right','bottom','left']){
      await page.evaluate(edge=>{__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});hoverId='antigravity';historyOpen='antigravity';showCard();},edge);
      await page.waitForTimeout(100);
      const b=await page.locator('#card').boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=360.5&&b.y+b.height<=300.5,'small viewport fits');
      await page.evaluate(()=>hideCard());
    }
    assert.deepEqual(errors,[]);console.log('Passed history: all four edges, bounded scrolling, refresh, account switch, keyboard resume, Escape, reduced motion and small viewports.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
