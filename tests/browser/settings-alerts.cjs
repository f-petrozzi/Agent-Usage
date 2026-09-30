'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async()=>{
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:820,height:680}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      let accounts=['Codex B','Claude','Antigravity'].map((name,i)=>({id:String(i),base:i===0?'codex':i===1?'claude':'gemini',name,snap:{status:'ok',windows:[]}}));
      let prefs={quota:true,waiting:false,completion:false,sound:false,muted:[]},slots=[{provider:'0'},{provider:'1'}];
      const listeners={};window.__calls=[];
      window.agentUsage={on:(event,cb)=>{(listeners[event]??=[]).push(cb);},invoke:async(cmd,args={})=>{
        window.__calls.push({cmd,args});
        if(cmd==='set_account_order'){accounts=args.ids.map(id=>accounts.find(a=>a.id===id));return accounts;}
        if(cmd==='set_notch_slots'){slots=args.slots;return slots;}
        if(cmd==='set_alert_preferences'){prefs={...prefs,...args};return prefs;}
        const answers={get_alert_preferences:prefs,get_agent_accounts:accounts,get_notch_slots:slots,get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true,tray_visible:false},get_collector:{source:'ssh',sshTarget:'homelab',shortcut:'Scrolllock'},get_theme_resolved:'dark',get_version:'3.1.0',get_monitors:[],get_notch_buttons:{pin:true},get_scale:1,get_theme:'dark',get_weekly_ring:'outside',get_color_transition:'ramp',get_notch_edge:'right',get_autostart:true,get_update_state:{status:'current'}};
        return answers[cmd]??null;
      }};
    });
    await page.goto('file://'+path.resolve(__dirname,'../../desktop/ui/settings.html'));
    const names=()=>page.locator('.acct-name').allTextContents();
    const notchOrder=()=>page.evaluate(()=>[...document.querySelectorAll('#notch .n-cell')].sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x).map(c=>c.getBoundingClientRect().x));
    await page.getByRole('listitem',{name:'Codex B',exact:true}).waitFor();
    // Alt+arrow moves the focused account, and focus stays on it
    await page.getByRole('listitem',{name:'Codex B',exact:true}).focus();
    await page.keyboard.press('Alt+ArrowDown');
    await page.waitForFunction(()=>document.querySelector('.acct-name').textContent==='Claude');
    assert.deepEqual(await names(),['Claude','Codex B','Antigravity']);
    assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Codex B');
    await page.waitForFunction(()=>window.__calls.some(c=>c.cmd==='set_account_order'));
    // The notch shows the two visible accounts; the hidden one has no ring there
    await page.waitForFunction(()=>document.querySelectorAll('#notch .n-cell').length===2);
    assert.equal((await notchOrder()).length,2);
    assert.equal(await page.getByRole('switch',{name:'Antigravity',exact:true}).getAttribute('aria-checked'),'false');
    await page.getByRole('switch',{name:'Usage warnings for Claude',exact:true}).click();
    await page.waitForFunction(()=>window.__calls.some(c=>c.cmd==='set_alert_preferences'&&c.args.muted?.includes('1')));
    assert.equal(await page.getByRole('switch',{name:'Usage warnings for Claude',exact:true}).getAttribute('aria-checked'),'false');
    // A drag let go with Escape puts the row back where it was
    const box=await page.locator('.acct').nth(2).boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2,box.y-100,{steps:6});
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.deepEqual(await names(),['Claude','Codex B','Antigravity']);
    await page.locator('.acct').nth(2).dragTo(page.locator('.acct').nth(0));
    await page.waitForFunction(()=>document.querySelector('.acct-name').textContent==='Antigravity');
    assert.deepEqual(await page.evaluate(()=>window.__calls.filter(c=>c.cmd==='set_account_order').at(-1).args.ids),['2','1','0']);
    await page.waitForFunction(()=>[...document.querySelectorAll('.acct')].every(e=>!e.style.transform));
    assert.equal(await page.getByRole('switch',{name:'Antigravity',exact:true}).getAttribute('aria-checked'),'false');
    await page.screenshot({path:'/tmp/agent-usage-3.1-accounts.png'});
    await page.getByRole('tab',{name:'General',exact:true}).click();
    for(const key of ['waiting','completion','sound']){
      await page.locator('#sw-alert-'+key).click();
      await page.waitForFunction(key=>document.querySelector('#sw-alert-'+key).getAttribute('aria-checked')==='true',key);
    }
    assert.equal(await page.locator('#sw-alert-quota').getAttribute('aria-checked'),'true');
    await page.screenshot({path:'/tmp/agent-usage-3.1-alerts.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: reorder, drag, visibility, per-account muting and alert preferences');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
