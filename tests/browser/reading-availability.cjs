// Real renderer checks for initial ink, cached-colour policy and touch metadata activation.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/mnt/ssd/homelab/tools/agent-toolkit/node_modules/playwright');
const UI=path.resolve(__dirname,'../../desktop/ui');
const OUT=process.argv[2]||'/tmp/agent-usage-reading-feedback';fs.mkdirSync(OUT,{recursive:true});
(async()=>{
 const browser=await chromium.launch({args:['--renderer-process-limit=2']});
 try{
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:900},hasTouch:width<761,isMobile:width<761});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    const now=Date.now(),listeners={};
    const quota=(id,used)=>({id,label:id,used,resets_at:now+3600000,count:null,derived:false});
    const accounts=[{id:'codex',base:'codex',name:'Codex',glyph:'Cx',snap:{status:'ok',windows:[quota('primary',.2)],fetched_at:now,details:['12.34 credits available'],hasCredits:true,resets:{count:1,expires:now+86400000,each:[{at:now+86400000,known:true,count:1}]}}},
     {id:'agy',base:'gemini',name:'Antigravity',glyph:'A',snap:{status:'stale',windows:[quota('gemini',.3)],fetched_at:now-1000000,details:[]}}];
    window.__accounts=accounts;
    const answers={get_agent_accounts:accounts,get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true},get_notch_edge:'top',get_state:{sessions:[],counts:{},agg:'idle',lang_resolved:'en'},get_theme_resolved:'dark',get_weekly_ring:'off',get_update_state:{status:'current'},get_notch_slots:[],get_activity:[],get_focus_accounts:[],get_alert_log:[]};
    window.agentUsage={invoke:(name)=>Promise.resolve(name in answers?answers[name]:name.startsWith('get_')?{}:true),on:(name,fn)=>{(listeners[name]||=[]).push(fn);return()=>{};}};
    window.__emit=(name,value)=>(listeners[name]||[]).forEach(fn=>fn(value));
   });
   await page.goto('file://'+UI+'/notch.html');
   await page.waitForSelector('#pill .cell',{state:'attached'});
   assert.equal(await page.locator('#root').evaluate(el=>getComputedStyle(el).getPropertyValue('--open').trim()),'0','no unbacked icon on initial load');
   await page.evaluate(()=>__emit('layout',{edge:'top',along:.5,scale:1,visible:true,tracking:false}));
   await page.waitForTimeout(1000);
   assert.equal(await page.locator('.cell[data-p="agy"] .ringwrap').evaluate(el=>el.classList.contains('unavailable')),false,'stale is still available');
   await page.evaluate(()=>holdCard('codex'));
   await page.waitForTimeout(1100);
   const trigger=page.locator('#card .metadata-trigger');
   if(width<761)await trigger.tap();else await trigger.hover();
   await page.waitForFunction(()=>extraTarget===1,null,{timeout:5000}).catch(async error=>{
    const debug=await page.evaluate(()=>({width:innerWidth,target:extraTarget,hoverId,held:cardHeld,card:card.className,extra:extraCard.textContent,focus:document.activeElement?.outerHTML}));console.log(JSON.stringify(debug));
    await page.screenshot({path:path.join(OUT,'failure-'+width+'.png')});throw error;
   });
   await page.waitForTimeout(650);
   assert.match(await page.locator('#extra-card').innerText(),/12.34 credits/);
   if(width>=761){await page.locator('.c-resets.expandable').hover();await page.waitForFunction(()=>!!resetsOpen);}
   await page.screenshot({path:path.join(OUT,'reading-'+width+'.png')});
   await page.evaluate(()=>{hideCard();__accounts[1].snap.windows=[];__emit('agent_accounts',__accounts);});
   assert(await page.locator('.cell[data-p="agy"] .ringwrap').evaluate(el=>el.classList.contains('unavailable')));
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS initial ink, stale colour, no-reading grey, reset hover and first-tap metadata at desktop/phone widths');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
