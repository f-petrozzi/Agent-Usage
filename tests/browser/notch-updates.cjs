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
        if(c==='download_update')__emit('update_state',{status:'downloading',version:'3.3.10',percent:0});
        if(c==='install_update')__emit('update_state',{status:'installing',version:'3.3.10',percent:100});
        if(c==='check_for_update')__emit('update_state',{status:'checking'});
        return c in answers?answers[c]:null;
      },on:(n,cb)=>{(listeners[n]??=[]).push(cb);return()=>{};}};
    });
    await page.goto('file://'+UI+'/notch.html');
    await page.addStyleTag({content:'html{background:#52667d}'});
    await page.waitForTimeout(350);
    for(const edge of ['top','right','bottom','left']){
      await page.mouse.move(0,0);
      await page.evaluate(edge=>{alertQueue.length=0;__emit('update_state',{status:'current'});retractSlivers(true);__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});__emit('appear',{edge});},edge);
      await page.waitForTimeout(900);
      // An open account card defers the notification and its button stays a settings button.
      await page.evaluate(()=>{hoverId='codex';showCard();__emit('update_state',{status:'available',version:'3.3.10',percent:0});});
      await page.waitForTimeout(350);
      assert.equal(await page.locator('.sliver-update').count(),0);
      assert.equal(await page.locator('#orb').getAttribute('aria-label'),'Settings');
      assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='download_update').length),['top','right','bottom','left'].indexOf(edge));
      assert.equal(await page.locator('#update-dot').getAttribute('data-status'),'available');
      await page.evaluate(()=>hideCard());await page.waitForTimeout(500);
      assert.equal(await page.locator('.sliver-update').count(),0,'updates stay a dot until hovered');
      assert.equal(await page.locator('#update-dot span').evaluate(el=>getComputedStyle(el).animationName),'none','the update dot never pulses');
      await page.evaluate(()=>__emit('alert_log',[{id:'unread',read:false,kind:'completion'}]));
      assert.equal(await page.locator('#notch-dot').evaluate(el=>el.classList.contains('on')),false,'the update occupies the unread notification corner');
      assert.equal(await page.evaluate(()=>sprout.available),false,'the underlying notification bell cannot intercept the update');
      const position=await page.evaluate(()=>{const r=updateDot.getBoundingClientRect();return Math.hypot(r.x+r.width/2-sprout.geo.P0[0],r.y+r.height/2-sprout.geo.P0[1]);});
      assert.ok(position<.1,'the update uses exactly the notification dot position');
      await page.screenshot({path:path.join(OUT,edge+'-dot.png')});
      await page.evaluate(()=>{window.__gooSeen=false;const t=performance.now(),watch=()=>{if(document.querySelector('.sliver-ink[filter]'))__gooSeen=true;if(performance.now()-t<1400)requestAnimationFrame(watch);};requestAnimationFrame(watch);});
      await page.locator('#update-dot').hover();
      await page.locator('.sliver-update').waitFor();await page.waitForTimeout(1400);
      assert.match(await page.locator('.sliver-update').innerText(),/Update available[\s\S]*Download · v3.3.10/);
      assert.ok(await page.evaluate(()=>__gooSeen),'uses the notification goo spring');
      assert.equal(await page.evaluate(()=>slivers.get('__update').path.getAttribute('filter')),null,'crisp once settled');
      const b=await page.locator('.sliver-update').boundingBox();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=1280&&b.y+b.height<=800);
      const notch=await page.locator('#pill').boundingBox();
      assert.ok(Math.abs((['top','bottom'].includes(edge)?b.x-notch.x:b.y-notch.y))<1,'update options grow from the notification end, including reversed account layouts');
      await page.screenshot({path:path.join(OUT,edge+'-available.png')});
      await page.locator('.sliver-update').focus();await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.sliver-update').getAttribute('aria-disabled'),'true');
      const downloads=await page.evaluate(()=>__calls.filter(c=>c[0]==='download_update').length);
      await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='download_update').length),downloads,'download cannot be started twice');
      await page.evaluate(()=>__emit('update_state',{status:'downloading',version:'3.3.10',percent:42}));
      await page.waitForTimeout(350);
      assert.match(await page.locator('.sliver-update').innerText(),/Downloading[\s\S]*42%/);
      await page.waitForFunction(()=>Math.abs(parseFloat(getComputedStyle(document.querySelector('.update-progress-fill')).strokeDasharray)-42)<.1);
      assert.equal(await page.locator('#update-progress').getAttribute('hidden'),null);
      assert.equal(await page.locator('#update-progress').getAttribute('data-percent'),'42');
      assert.equal(await page.locator('#update-progress').evaluate(el=>getComputedStyle(el).pointerEvents),'none','the frame cannot intercept update actions');
      assert.equal(await page.locator('.sliver-update').evaluate(el=>getComputedStyle(el,'::after').content),'none','the old bottom bar is removed');
      const outline=await page.locator('.update-progress-fill').evaluate(el=>{
        const d=el.getAttribute('d'),length=el.getTotalLength(),s=slivers.get(UPDATE_ID),m=s.path.getScreenCTM().inverse();
        const samples=Array.from({length:65},(_,i)=>{const p=el.getPointAtLength(length*i/64),q=new DOMPoint(p.x,p.y).matrixTransform(m);return{x:q.x,y:q.y};});
        const [u0,u1,depth,radius]=s.path.rimPart;
        const distance=p=>Math.min(Math.abs(p.x-u0),Math.abs(p.x-u1),Math.abs(p.y-depth),
          p.x<=u0+radius&&p.y>=depth-radius?Math.abs(Math.hypot(p.x-u0-radius,p.y-depth+radius)-radius):Infinity,
          p.x>=u1-radius&&p.y>=depth-radius?Math.abs(Math.hypot(p.x-u1+radius,p.y-depth+radius)-radius):Infinity);
        return{moves:(d.match(/M/g)||[]).length,closed:/Z/i.test(d),maxError:Math.max(...samples.map(distance)),length,
          reachesTip:samples.some(p=>Math.abs(p.y-depth)<.1),touchesBothSides:samples.some(p=>Math.abs(p.x-u0)<.1)&&samples.some(p=>Math.abs(p.x-u1)<.1)};
      });
      assert.equal(outline.moves,1,'one seamless contour');assert.equal(outline.closed,false,'no attachment seam across the notch');
      assert.ok(outline.maxError<.1&&outline.reachesTip&&outline.touchesBothSides,'progress follows the actual ink sides and rounded front');
      await page.evaluate(()=>{window.__progressPath=document.querySelector('.update-progress-fill');__emit('update_state',{status:'downloading',version:'3.3.10',percent:64});});
      await page.waitForTimeout(90);
      const moving=await page.locator('.update-progress-fill').evaluate(el=>({same:el===__progressPath,percent:parseFloat(getComputedStyle(el).strokeDasharray)}));
      assert.ok(moving.same&&moving.percent>42&&moving.percent<64,'progress advances smoothly on the same persistent stroke');
      await page.evaluate(()=>__emit('update_state',{status:'downloading',version:'3.3.10',percent:42}));await page.waitForTimeout(600);
      await page.screenshot({path:path.join(OUT,edge+'-downloading.png')});
      await page.evaluate(()=>document.activeElement.blur());await page.mouse.move(0,0);await page.waitForTimeout(2300);
      assert.equal(await page.locator('.sliver-update').count(),0,'leaving melts the options back into the dot');
      assert.equal(await page.locator('#update-progress').getAttribute('hidden'),'','closed options leave no floating progress');
      await page.locator('#update-dot').hover();await page.waitForTimeout(1400);
      assert.match(await page.locator('.sliver-update').innerText(),/Downloading[\s\S]*42%/,'hover also reveals download progress');
      // Agent alerts wait while update options occupy the shared notification space.
      await page.evaluate(()=>{__emit('alert',{events:[{kind:'completion',account:'codex',session:'Finished workspace work'}],hold:5000,sound:false});});
      await page.waitForTimeout(1000);
      assert.equal(await page.locator('.sliver-update').count(),1);
      assert.equal(await page.locator('.sliver:not(.sliver-update)').count(),0);
      assert.equal(await page.evaluate(()=>alertQueue.length),1,'the agent alert is preserved');
      await page.evaluate(()=>__emit('update_state',{status:'ready',version:'3.3.10',percent:100}));
      await page.waitForTimeout(250);assert.match(await page.locator('.sliver-update').innerText(),/Update ready/,'ready retains priority');
      await page.waitForFunction(()=>parseFloat(getComputedStyle(document.querySelector('.update-progress-fill')).strokeDasharray)>99.9);
      assert.equal(await page.locator('#update-progress').getAttribute('data-percent'),'100','ready completes the frame');
      assert.equal(await page.locator('.update-progress-tip').evaluate(el=>getComputedStyle(el).opacity),'0','ready has a quiet complete outline');
      await page.mouse.move(0,0);await page.waitForTimeout(2500);
      assert.equal(await page.locator('.sliver-update').count(),0);
      assert.match(await page.locator('.sliver').innerText(),/Finished/,'the queued alert appears after update options close');
      await page.locator('#update-dot').hover();await page.waitForTimeout(1400);
      assert.equal(await page.locator('.sliver:not(.sliver-update)').count(),0,'opening updates preempts the active agent alert');
      assert.equal(await page.evaluate(()=>alertQueue.length),1,'the interrupted unread alert is requeued');
      assert.match(await page.locator('.sliver-update').innerText(),/Update ready[\s\S]*Restart · v3.3.10/);
      assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='install_update').length),['top','right','bottom','left'].indexOf(edge),'does not restart automatically');
      await page.screenshot({path:path.join(OUT,edge+'-ready.png')});
      await page.locator('.sliver-update').click();
      assert.equal(await page.locator('.sliver-update').getAttribute('aria-busy'),'true');
      assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='install_update').length),['top','right','bottom','left'].indexOf(edge)+1);
    }
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>{alertQueue.length=0;__emit('update_state',{status:'current'});retractSlivers(true);__emit('update_state',{status:'error'});});
    await page.locator('#update-dot').focus();await page.waitForTimeout(250);
    assert.equal(await page.locator('#update-dot span').evaluate(el=>getComputedStyle(el).animationName),'none');
    assert.match(await page.locator('.sliver-update').innerText(),/Update failed[\s\S]*Check again/);
    assert.equal(await page.evaluate(()=>slivers.get('__update').path.getAttribute('filter')),null);
    await page.locator('.sliver-update').focus();await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='check_for_update').length),1);
    assert.equal(await page.locator('.sliver-update').count(),0,'checking clears stale failure');
    // If ready arrives while the notch is hidden, it waits and returns on the next appearance.
    await page.evaluate(()=>{shown=false;__emit('update_state',{status:'ready',version:'3.3.10'});});
    await page.waitForTimeout(250);assert.equal(await page.locator('.sliver-update').count(),0);
    await page.evaluate(()=>__emit('appear',{edge:'left'}));await page.waitForTimeout(800);
    assert.equal(await page.locator('.sliver-update').count(),0,'appearance restores the dot without opening options');
    await page.locator('#update-dot').focus();await page.waitForTimeout(250);
    assert.equal(await page.locator('.sliver-update').count(),1);
    await page.keyboard.press('Escape');await page.waitForTimeout(250);
    assert.equal(await page.locator('.sliver-update').count(),0);
    await page.evaluate(()=>{__emit('update_state',{status:'downloading',version:'3.3.10',percent:37});openUpdate();});
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.update-progress-fill').evaluate(el=>parseFloat(getComputedStyle(el).strokeDasharray)),37,'reduced motion shows the exact progress without travel');
    assert.equal(await page.locator('.update-progress-fill').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
    await page.evaluate(()=>__emit('move_begin'));
    assert.equal(await page.locator('#update-progress').getAttribute('hidden'),'','dragging clears progress in the same frame');
    assert.deepEqual(errors,[]);
    console.log('Passed updater notifications: shared corner on four edges, steady dot, update priority, queued and interrupted alerts, fluid animation, download and restart clicks, progress, card deferral, retry, hidden notch and reduced motion.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
