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
      let prefs={quota:true,waiting:false,completion:false,sound:false,muted:[]},slots=[{provider:'0'},{provider:'1'}],testAccount=null,focusAccounts=[];
      let appearance={aliases:false,compactSessions:false};const listeners={};window.__calls=[];window.__emit=(name,value)=>(listeners[name]||[]).forEach(fn=>fn(value));
      window.agentUsage={on:(event,cb)=>{(listeners[event]??=[]).push(cb);},invoke:async(cmd,args={})=>{
        window.__calls.push({cmd,args});
        if(cmd==='get_appearance')return appearance;
        if(cmd==='set_appearance'){appearance={...appearance,...args};return appearance;}
        if(cmd==='set_account_alias'){accounts=accounts.map(a=>a.id===args.account?{...a,originalName:a.originalName||a.name,alias:args.alias,name:args.alias||a.originalName||a.name}:a);return accounts;}
        if(cmd==='get_performance_capture')return {status:'idle'};
        if(cmd==='start_performance_capture')return {status:'recording'};
        if(cmd==='set_account_order'){accounts=args.ids.map(id=>accounts.find(a=>a.id===id));return accounts;}
        if(cmd==='set_notch_slots'){slots=args.slots;return slots;}
        if(cmd==='set_alert_preferences'){prefs={...prefs,...args};return prefs;}
        if(cmd==='get_focus_accounts')return focusAccounts;
        if(cmd==='get_notch_slots')return slots;
        if(cmd==='set_focus_accounts'){await new Promise(r=>setTimeout(r,80));focusAccounts=args.accounts;return focusAccounts;}
        if(cmd==='get_notification_test')return testAccount;
        if(cmd==='set_notification_test'){testAccount=args.on?args.account:null;return testAccount;}
        const answers={get_alert_preferences:prefs,get_agent_accounts:accounts,get_notch_slots:slots,get_glyphs:{},get_ui_flags:{notch_visible:false,notch_on_hover:true,tray_visible:false},get_collector:{source:'ssh',sshTarget:'homelab',shortcut:'Scrolllock'},get_theme_resolved:'dark',get_version:'3.1.0',get_monitors:[],get_notch_buttons:{pin:true,alerts:true},get_scale:1,get_theme:'dark',get_weekly_ring:'outside',get_color_transition:'ramp',get_notch_edge:'right',get_autostart:true,get_update_state:{status:'current'}};
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
    await page.getByRole('button',{name:'Test notification for Claude',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Test notification for Claude',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'Test notification for Antigravity',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Test notification for Claude',exact:true}).getAttribute('aria-pressed'),'false');
    assert.equal(await page.getByRole('button',{name:'Test notification for Antigravity',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('button',{name:'Test notification for Antigravity',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>__calls.filter(c=>c.cmd==='set_notification_test').at(-1).args),{account:'2',on:false});
    // A drag let go with Escape puts the row back where it was
    const box=await page.locator('.acct-name').nth(2).boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.mouse.move(box.x+box.width/2,box.y-100,{steps:6});
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.deepEqual(await names(),['Claude','Codex B','Antigravity']);
    await page.waitForFunction(()=>[...document.querySelectorAll('.acct')].every(e=>!e.style.transform));
    await page.locator('.acct-name').nth(2).dragTo(page.locator('.acct-name').nth(0),{targetPosition:{x:20,y:0}});
    await page.waitForFunction(()=>document.querySelector('.acct-name').textContent==='Antigravity');
    assert.deepEqual(await page.evaluate(()=>window.__calls.filter(c=>c.cmd==='set_account_order').at(-1).args.ids),['2','1','0']);
    await page.waitForFunction(()=>[...document.querySelectorAll('.acct')].every(e=>!e.style.transform));
    assert.equal(await page.getByRole('switch',{name:'Antigravity',exact:true}).getAttribute('aria-checked'),'false');
    await page.getByRole('button',{name:'Focus Claude',exact:true}).click();await page.getByRole('button',{name:'Focus Codex B',exact:true}).click();
    await page.waitForFunction(()=>__calls.filter(c=>c.cmd==='set_focus_accounts').at(-1)?.args.accounts.length===2);
    assert.deepEqual(await page.evaluate(()=>__calls.filter(c=>c.cmd==='set_focus_accounts').at(-1).args.accounts),['1','0']);
    assert.equal(await page.getByRole('button',{name:'Focus Claude',exact:true}).getAttribute('aria-pressed'),'true');
    await page.screenshot({path:'/tmp/agent-usage-4.1.5-accounts.png'});
    assert.equal(await page.locator('#clear-focus,.focus-hint').count(),0);await page.getByRole('button',{name:'Focus Claude',exact:true}).click();await page.getByRole('button',{name:'Focus Codex B',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Focus Claude',exact:true}).getAttribute('aria-pressed'),'false');
    await page.setViewportSize({width:680,height:500});await page.evaluate(()=>document.documentElement.dataset.theme='light');
    await page.getByRole('button',{name:'Focus Claude',exact:true}).click();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.acct[data-id="1"] .account-focus')).color==='rgb(53, 106, 195)');
    assert.equal(await page.getByRole('button',{name:'Focus Claude',exact:true}).evaluate(el=>getComputedStyle(el).color),'rgb(53, 106, 195)');
    for(const button of await page.locator('.acct button').all()){const box=await button.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=680,'account actions fit the minimum window width');}
    await page.screenshot({path:'/tmp/agent-usage-4.1.5-accounts-small-light.png'});
    await page.setViewportSize({width:820,height:680});await page.evaluate(()=>document.documentElement.dataset.theme='dark');
    await page.getByRole('tab',{name:'General',exact:true}).click();
    for(const key of ['waiting','completion','sound']){
      await page.locator('#sw-alert-'+key).click();
      await page.waitForFunction(key=>document.querySelector('#sw-alert-'+key).getAttribute('aria-checked')==='true',key);
    }
    assert.equal(await page.locator('#sw-alert-quota').getAttribute('aria-checked'),'true');
    await page.screenshot({path:'/tmp/agent-usage-3.1-alerts.png'});
    await page.getByRole('tab',{name:'Appearance',exact:true}).click();
    assert.equal(await page.getByRole('switch',{name:'Alerts button',exact:true}).getAttribute('aria-checked'),'true','the notch bell is on unless turned off');
    await page.getByRole('switch',{name:'Alerts button',exact:true}).click();
    await page.waitForFunction(()=>window.__calls.some(c=>c.cmd==='set_notch_buttons'&&c.args.alerts===false));
    await page.locator('#sw-account-labels').click();await page.locator('#sw-compact-sessions').click();
    assert.equal(await page.locator('#sw-account-labels').getAttribute('aria-checked'),'true');
    assert.equal(await page.locator('#sw-compact-sessions').getAttribute('aria-checked'),'true');
    await page.getByRole('tab',{name:'Accounts',exact:true}).click();
    const alias=page.getByRole('textbox',{name:'Alias for Codex B',exact:true});await alias.click();
    assert.ok(await page.evaluate(()=>drag===null),'editing an alias never lifts an account');
    await alias.fill('Atlas');await page.keyboard.press('Tab');
    await page.waitForFunction(()=>__calls.some(c=>c.cmd==='set_account_alias'&&c.args.alias==='Atlas'));
    assert.ok((await names()).includes('Atlas'));
    await page.getByRole('tab',{name:'General',exact:true}).click();await page.locator('#performance-action').click();
    assert.equal(await page.locator('#performance-action').isDisabled(),true);
    await page.evaluate(()=>__emit('performance_capture',{status:'saved',file:'/synthetic/trace.json'}));
    assert.equal(await page.locator('#performance-action').isDisabled(),false);
    await page.locator('#performance-open').click();assert.ok(await page.evaluate(()=>__calls.some(c=>c.cmd==='show_performance_capture')));
    assert.deepEqual(errors,[]);
    console.log('PASS: reorder, drag, visibility, per-account muting, aliases, compact preferences and explicit performance recording.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
