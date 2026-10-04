'use strict';
// Render the real frontend with fictional fixtures. No collector, credentials or
// session files are read, and no external application is launched.
// PLAYWRIGHT_MODULE=/path/to/playwright node scripts/render-readme.cjs
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const ROOT=path.resolve(__dirname,'..'),UI=path.join(ROOT,'desktop/ui'),OUT=path.join(ROOT,'docs/images');
const VERSION=require('../desktop/package.json').version;
const NOW=Date.parse('2026-10-04T16:45:00Z'),HOUR=3600000,DAY=24*HOUR;
const win=(id,label,used,remaining)=>({id,label,used,resets_at:NOW+remaining,count:null,derived:false});
const account=(id,base,name,windows,details=[],resets=null)=>({id,base,name,glyph:base==='gemini'?'A':base==='codex'?'Cx':'Cl',snap:{status:'ok',windows,details,resets,fetched_at:NOW,note:''}});
const accounts=[
  account('codex_atlas','codex','Codex · Atlas',[win('primary','5 hours',.27,3.5*HOUR),win('secondary','Weekly',.56,3*DAY)],['Plan: Plus']),
  account('claude_cedar','claude','Claude · Cedar',[win('session','5 hours',.61,2*HOUR),win('seven_day','Weekly',.44,4*DAY)],['Plan: Max'],{count:2,expires:NOW+20*DAY,each:[{at:NOW+20*DAY,known:true,count:1},{at:NOW+27*DAY,known:true,count:1}]}),
  account('gemini_drift','gemini','AGY · Drift',[win('gemini_five_hour','Gemini · 5 hours',.18,4*HOUR),win('gemini_weekly','Gemini · Weekly',.37,5*DAY),win('3p_claude','Claude models',.22,4*DAY),win('3p_gpt','GPT models',.31,4*DAY)],['Demo account']),
  account('codex_harbor','codex','Codex · Harbor',[win('primary','5 hours',.42,HOUR),win('secondary','Weekly',.23,2*DAY)],['Plan: Plus']),
];
const conversations=[
  ['claude_cedar','Design the weather dashboard','weather-studio',true,false],
  ['codex_atlas','Build the recipe search','recipe-book',true,true],
  ['gemini_drift','Polish the gallery layout','photo-gallery',false,true],
  ['codex_harbor','Add keyboard navigation','recipe-book',false,false],
  ['claude_cedar','Review the onboarding flow','weather-studio',false,false],
  ['codex_atlas','Improve search suggestions','recipe-book',false,false],
  ['gemini_drift','Tune the mobile layout','photo-gallery',false,false],
  ['claude_cedar','Plan accessible color themes','weather-studio',false,false],
  ['codex_harbor','Add a favorites collection','recipe-book',false,false],
  ['codex_atlas','Write the setup guide','recipe-book',false,false],
];
const sessions=conversations.map(([id,name,folder,pinned,live],i)=>({
  id:'demo-chat-'+(i+1),sessionId:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),account:id,
  accountName:accounts.find(a=>a.id===id).name,provider:accounts.find(a=>a.id===id).base==='gemini'?'antigravity':accounts.find(a=>a.id===id).base,
  name,workspace:'/demo/projects/'+folder,since:NOW-i*45*60000,live,state:live?'busy':'idle',canOpen:true,pinned,
}));
const activity=sessions.filter(s=>s.live).map(s=>({...s,state:'busy',detail:'Working'}));
const alerts=[
  {id:'demo-finished',account:'codex_atlas',kind:'completion',session:'Build the recipe search',took:14*60000,at:NOW-3*60000,read:false,target:{account:'codex_atlas',id:'demo-chat-2'}},
  {id:'demo-waiting',account:'claude_cedar',kind:'waiting',session:'Choose a color theme',at:NOW-9*60000,read:false,target:{account:'claude_cedar',id:'demo-chat-1'}},
  {id:'demo-quota',account:'codex_harbor',kind:'quota',window:'primary',level:80,at:NOW-28*60000,read:true},
  {id:'demo-gallery',account:'gemini_drift',kind:'completion',session:'Polish the gallery layout',took:8*60000,at:NOW-48*60000,read:true,target:{account:'gemini_drift',id:'demo-chat-3'}},
];
alerts.sort((a,b)=>a.at-b.at);
const glyphs=Object.fromEntries(['codex','claude','gemini'].map(id=>[id,{kind:'svg',svg:fs.readFileSync(path.join(UI,'glyphs',id+'.svg'),'utf8')}]));

async function installFixtures(page){
  await page.addInitScript(({accounts,sessions,activity,alerts,glyphs,version,now})=>{
    const ActualDate=Date;
    window.Date=class extends ActualDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
    const listeners={},pins=sessions.filter(s=>s.pinned).map(s=>({id:s.id,account:s.account}));
    window.__demoEmit=(name,value)=>(listeners[name]||[]).forEach(fn=>fn(value));
    const answers={
      get_agent_accounts:accounts,get_glyphs:glyphs,get_activity:activity,get_alert_log:alerts,
      get_state:{sessions:[],agg:'busy',counts:{},lang_resolved:'en',clock_24h:false},
      get_ui_flags:{notch_visible:true,notch_on_hover:false,tray_visible:false},
      get_notch_slots:[],get_notch_edge:'top',get_move_handle:true,get_weekly_ring:'outside',get_color_transition:'ramp',
      get_notch_buttons:{pin:true,alerts:true},get_focus_accounts:[],get_session_pins:pins,
      get_session_library:sessions,get_alert_preferences:{quota:true,waiting:true,completion:true,sound:false,muted:['codex_harbor']},
      get_update_state:{status:'current'},get_theme_resolved:'dark',get_theme:'dark',get_scale:1,get_autostart:true,get_version:version,
      get_antigravity_prefs:{limit:'automatic',model:'gemini'},get_notification_test:null,
      get_collector:{source:'ssh',sshTarget:'demo-server',shortcut:'Scrolllock'},get_monitors:[],
    };
    window.agentUsage={on:(name,fn)=>{(listeners[name]??=[]).push(fn);return()=>{};},invoke:async(name,args={})=>{
      if(name==='get_session_history')return sessions.filter(s=>s.account===args.account);
      // A preview cannot invoke a real resume, sign-in, update, or filesystem action.
      if(name.startsWith('get_'))return answers[name]??null;
      return null;
    }};
  },{accounts,sessions,activity,alerts,glyphs,version:VERSION,now:NOW});
}
async function frame(page,name){
  const clip=await page.evaluate(()=>{
    const selectors=['#shape .part','#shape .arm','#shape .neck','#detail-shape > path','.sliver-ink','#card.show'];
    const rects=[...document.querySelectorAll(selectors.join(','))].filter(el=>el.tagName.toLowerCase()!=='path'||el.getAttribute('d')).map(el=>el.getBoundingClientRect()).filter(r=>r.width>0&&r.height>0);
    const left=Math.min(...rects.map(r=>r.left)),right=Math.max(...rects.map(r=>r.right));
    const top=Math.min(...rects.map(r=>r.top)),bottom=Math.max(...rects.map(r=>r.bottom));
    const x=Math.max(0,Math.floor(left-36)),y=Math.max(0,Math.floor(top-32));
    return{x,y,width:Math.min(innerWidth-x,Math.ceil(right+36-x)),height:Math.min(innerHeight-y,Math.ceil(bottom+36-y))};
  });
  assert.ok(clip.width>100&&clip.height>50,'a populated preview');
  await page.screenshot({path:path.join(OUT,name+'.png'),clip});
  console.log(name,JSON.stringify(clip));
}

(async()=>{
  fs.mkdirSync(OUT,{recursive:true});
  const browser=await chromium.launch();
  const errors=[];
  try{
    const context=await browser.newContext({viewport:{width:1024,height:720},deviceScaleFactor:2,timezoneId:'America/New_York',locale:'en-US'});
    // The only inputs to the preview are repository assets and the fixture above.
    await context.route(/^https?:\/\//,route=>route.abort());
    async function notch(edge='top'){
      const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await installFixtures(page);
      await page.goto(pathToFileURL(path.join(UI,'notch.html')).href);
      await page.addStyleTag({content:'html{background:#52667d}'});
      await page.mouse.move(20,700);await page.waitForTimeout(300);
      await page.evaluate(edge=>{__demoEmit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:true});__demoEmit('appear',{edge});},edge);
      await page.waitForTimeout(1200);return page;
    }
    let page=await notch();await frame(page,'notch');await page.close();

    page=await notch('right');await page.evaluate(()=>holdCard('claude_cedar'));await page.waitForTimeout(1400);
    assert.match(await page.locator('#card').innerText(),/Claude · Cedar/);await frame(page,'usage');await page.close();

    page=await notch();await page.evaluate(()=>__demoEmit('session_switcher',true));await page.waitForTimeout(1400);
    assert.equal(await page.locator('.session-result').count(),sessions.length);await page.locator('.session-result').nth(2).hover();await page.waitForTimeout(450);
    await frame(page,'sessions');await page.close();

    page=await notch('right');await page.evaluate(()=>openAlertLog());await page.waitForTimeout(1400);
    assert.match(await page.locator('#card').innerText(),/Choose a color theme/);await frame(page,'notifications');await page.close();

    page=await notch();await page.evaluate(()=>{showSliver(FINISHED_ID,[{id:'demo-finished',account:'codex_atlas',kind:'completion',session:'Build the recipe search',took:14*60000},{id:'demo-gallery',account:'gemini_drift',kind:'completion',session:'Polish the gallery layout',took:8*60000}],6500);holdSlivers(true);});await page.waitForTimeout(1400);
    await page.evaluate(()=>notificationRim.clear());await frame(page,'finished');await page.close();

    page=await notch('right');await page.evaluate(version=>{__demoEmit('update_state',{status:'downloading',version,percent:64});openUpdate();holdSlivers(true);},VERSION);await page.waitForTimeout(1400);
    await page.evaluate(()=>notificationRim.clear());assert.equal(await page.locator('#update-progress').getAttribute('data-percent'),'64');await frame(page,'updates');await page.close();

    page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await installFixtures(page);
    await page.setViewportSize({width:820,height:500});await page.goto(pathToFileURL(path.join(UI,'settings.html')).href);
    await page.getByRole('tab',{name:'Accounts',exact:true}).click();await page.waitForTimeout(700);
    await page.evaluate(()=>__demoEmit('focus_accounts',['codex_atlas','claude_cedar']));await page.waitForTimeout(300);
    assert.equal(await page.locator('.acct-name').count(),accounts.length);
    await page.screenshot({path:path.join(OUT,'accounts.png')});await page.close();
    assert.deepEqual(errors,[],'preview renderer errors');
    console.log('Saved fictional '+VERSION+' previews in docs/images.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
