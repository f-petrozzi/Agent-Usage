'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/agent-usage-updates';
fs.mkdirSync(OUT,{recursive:true});
(async()=>{
  const browser=await chromium.launch();
  try{
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const listeners={};window.__calls=[];
      const now=Date.now(),accounts=['codex','claude'].map(id=>({id,base:id,name:id==='codex'?'Codex a':'Claude',glyph:'C',snap:{status:'ok',windows:[{id:'session',label:'Five hours',used:.35,resets_at:now+3600e3}],fetched_at:now,details:[],note:''}}));
      const answers={get_agent_accounts:accounts,get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en'},get_activity:[],get_notch_slots:[],get_notch_edge:'top',get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true},get_update_state:{status:'current'}};
      window.__emit=(n,p)=>(listeners[n]||[]).forEach(cb=>cb(p));
      window.agentUsage={invoke:async(c,a)=>{
        __calls.push([c,a]);
        if(c==='download_update')__emit('update_state',{status:'downloading',version:'3.3.8',percent:0});
        if(c==='install_update')__emit('update_state',{status:'installing',version:'3.3.8',percent:100});
        if(c==='check_for_update')__emit('update_state',{status:'checking'});
        return c in answers?answers[c]:null;
      },on:(n,cb)=>{(listeners[n]??=[]).push(cb);return()=>{};}};
    });
    await page.goto('file://'+UI+'/notch.html');
    await page.addStyleTag({content:'html{background:#52667d}'});
    await page.waitForTimeout(350);
    for(const edge of ['top','right','bottom','left']){
      await page.mouse.move(0,0);
      await page.evaluate(edge=>{__emit('update_state',{status:'current'});retractSlivers(true);__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});__emit('appear',{edge});},edge);
      await page.waitForTimeout(900);
      // An open account card defers the notification and its button stays a settings button.
      await page.evaluate(()=>{hoverId='codex';showCard();__emit('update_state',{status:'available',version:'3.3.8',percent:0});});
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.sliver-update').count(),0);
      assert.equal(await page.locator('#orb').getAttribute('aria-label'),'Settings');
      assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='download_update').length),['top','right','bottom','left'].indexOf(edge));
      await page.evaluate(()=>{hideCard();window.__gooSeen=false;const t=performance.now(),watch=()=>{if(document.querySelector('.sliver-ink[filter]'))__gooSeen=true;if(performance.now()-t<1400)requestAnimationFrame(watch);};requestAnimationFrame(watch);});
      await page.locator('.sliver-update').waitFor();await page.waitForTimeout(1400);
      assert.match(await page.locator('.sliver-update').innerText(),/Update available[\s\S]*Download · v3.3.8/);
      assert.ok(await page.evaluate(()=>__gooSeen),'uses the notification goo spring');
      assert.equal(await page.evaluate(()=>slivers.get('__update').path.getAttribute('filter')),null,'crisp once settled');
      const b=await page.locator('.sliver-update').boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=1280&&b.y+b.height<=800);
      await page.screenshot({path:path.join(OUT,edge+'-available.png')});
      await page.locator('.sliver-update').focus();await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.sliver-update').getAttribute('aria-disabled'),'true');
      const downloads=await page.evaluate(()=>__calls.filter(c=>c[0]==='download_update').length);
      await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='download_update').length),downloads,'download cannot be started twice');
      await page.evaluate(()=>__emit('update_state',{status:'downloading',version:'3.3.8',percent:42}));
      await page.waitForTimeout(350);
      assert.match(await page.locator('.sliver-update').innerText(),/Downloading[\s\S]*42%/);
      assert.ok(await page.locator('.sliver-update').evaluate(el=>parseFloat(getComputedStyle(el,'::after').width)>0),'visible download progress');
      await page.screenshot({path:path.join(OUT,edge+'-downloading.png')});
      // A finished turn preempts download progress. Ready waits for it instead of overlapping it.
      await page.evaluate(()=>{__emit('alert',{events:[{kind:'completion',account:'codex',session:'Finished workspace work'}],hold:5000,sound:false});});
      await page.waitForTimeout(1000);
      assert.equal(await page.locator('.sliver-update').count(),0);
      assert.match(await page.locator('.sliver').innerText(),/Finished/);
      await page.evaluate(()=>__emit('update_state',{status:'ready',version:'3.3.8',percent:100}));
      await page.waitForTimeout(250);assert.equal(await page.locator('.sliver-update').count(),0,'ready waits for session alert');
      await page.evaluate(()=>retractSlivers(true));await page.waitForTimeout(1400);
      assert.match(await page.locator('.sliver-update').innerText(),/Update ready[\s\S]*Restart · v3.3.8/);
      assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='install_update').length),['top','right','bottom','left'].indexOf(edge),'does not restart automatically');
      await page.screenshot({path:path.join(OUT,edge+'-ready.png')});
      await page.locator('.sliver-update').click();
      assert.equal(await page.locator('.sliver-update').getAttribute('aria-busy'),'true');
      assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='install_update').length),['top','right','bottom','left'].indexOf(edge)+1);
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>{__emit('update_state',{status:'current'});retractSlivers(true);__emit('update_state',{status:'error'});});
    await page.waitForTimeout(250);
    assert.match(await page.locator('.sliver-update').innerText(),/Update failed[\s\S]*Check again/);
    assert.equal(await page.evaluate(()=>slivers.get('__update').path.getAttribute('filter')),null);
    await page.locator('.sliver-update').focus();await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='check_for_update').length),1);
    assert.equal(await page.locator('.sliver-update').count(),0,'checking clears stale failure');
    // If ready arrives while the notch is hidden, it waits and returns on the next appearance.
    await page.evaluate(()=>{shown=false;__emit('update_state',{status:'ready',version:'3.3.8'});});
    await page.waitForTimeout(250);assert.equal(await page.locator('.sliver-update').count(),0);
    await page.evaluate(()=>__emit('appear',{edge:'left'}));await page.waitForTimeout(800);
    assert.equal(await page.locator('.sliver-update').count(),1);
    assert.deepEqual(errors,[]);
    console.log('Passed updater notifications: four edges, fluid animation, download and restart clicks, progress, alert priority, card deferral, retry, hidden notch and reduced motion.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
