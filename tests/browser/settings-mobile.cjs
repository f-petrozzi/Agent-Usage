// Real settings renderer: phone geometry, selected tabs and single-row option ink.
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const OUT = process.env.AGENT_USAGE_OUTPUT || '/tmp/agent-usage-settings-mobile';
fs.mkdirSync(OUT, {recursive:true});
(async()=>{
 const browser=await chromium.launch();
 try {
  for(const width of [320,390,820]) {
   const context=await browser.newContext({viewport:{width,height:760},hasTouch:width<520,isMobile:width<520});
   const page=await context.newPage(), errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{
    const accounts=['Codex A','Codex B','Claude'].map((name,i)=>({id:String(i),base:i===2?'claude':'codex',name,snap:{status:'ok',windows:[],fetched_at:Date.now()}}));
    const answers={get_focus_accounts:[],get_notch_slots:[],get_agent_accounts:accounts,get_glyphs:{},get_alert_preferences:{quota:true,waiting:true,completion:true,muted:[]},get_appearance:{aliases:false},get_ui_flags:{notch_visible:true},get_collector:{source:'ssh',sshTarget:'synthetic',shortcut:'Scrolllock'},get_monitors:[],get_theme_resolved:'light',get_theme:'light',get_scale:1,get_weekly_ring:'outside',get_color_transition:'ramp',get_notch_edge:'top',get_notch_buttons:{pin:true,alerts:true},get_update_state:{status:'unavailable'},get_performance_capture:{status:'idle'}};
    window.agentUsage={on:()=>()=>{},invoke:async(cmd,args={})=>{
     if(cmd in answers)return answers[cmd];
     const getter=cmd.replace('set_','get_');
     return getter in answers?answers[getter]=Object.values(args)[0]:null;
    }};
   });
   await page.goto('file://'+path.resolve(__dirname,'../../desktop/ui/settings.html'));
   // Embedded hosts omit Quit; it is a desktop application control.
   await page.addStyleTag({content:'#quit{display:none}'});
   await page.locator('.acct').first().waitFor();
   for(const tab of ['accounts','appearance','general']) {
    await page.locator('#tab-'+tab).click();
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#tab-'+tab).getAttribute('aria-selected'),'true');
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.querySelector('#body').getBoundingClientRect().toJSON(),head:document.querySelector('#head').getBoundingClientRect().toJSON(),close:document.querySelector('#close').getBoundingClientRect().toJSON(),selected:getComputedStyle(document.querySelector('.row.sel')).backgroundColor}));
    assert.ok(layout.scroll<=layout.width,JSON.stringify(layout));
    if(width<520) {
     assert.equal(layout.head.height,0);
     assert.ok(layout.close.width>=44&&layout.close.height>=44);
     assert.notEqual(layout.selected,'rgba(0, 0, 0, 0)');
     assert.ok(layout.body.top<=60,'no blank desktop header band');
     for(const seg of await page.locator('.pane:not([hidden]) .seg').all()) {
      const boxes=await seg.locator('button').evaluateAll(buttons=>buttons.map(b=>b.getBoundingClientRect().toJSON()));
      assert.ok(boxes.every(b=>b.y===boxes[0].y&&b.height>=44&&b.x>=0&&b.right<=width),'options stay in a single touch-sized row');
     }
    }
    await page.screenshot({path:path.join(OUT,`${tab}-${width}.png`)});
   }
   await page.locator('#tab-accounts').click();
   await page.locator('#tab-accounts').focus();
   assert.equal(await page.locator('#side').getAttribute('aria-orientation'),width<520?'horizontal':'vertical');
   await page.keyboard.press(width<520?'ArrowRight':'ArrowDown');
   assert.equal(await page.locator('#tab-appearance').getAttribute('aria-selected'),'true');
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.locator('#tab-appearance').click();
   await page.locator('#seg-theme button').last().click();
   assert.deepEqual(errors,[]);
   await context.close();
  }
  console.log('PASS mobile settings at 320/390, desktop at 820, option rows, selected navigation and reduced motion');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
