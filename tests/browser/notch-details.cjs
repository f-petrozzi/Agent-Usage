// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright module; frames go to /tmp.
const assert = require('node:assert/strict');
// Real-browser regression checks for corner transport and liquid handles with a stubbed bridge.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path');
const UI = path.resolve(__dirname, '../../desktop/ui');
const OUT = process.argv[2] || '/tmp/agent-usage-motion';
const EDGE = process.argv[3] || 'right', ALONG = Number(process.argv[4] || .5);
fs.mkdirSync(OUT, { recursive: true });
const now = Date.now();
const win = (id, used, h) => ({ id, label: id, used, resets_at: now + h * 3600e3, count: null, derived: false });
const accounts = [
  { id: 'claude', base: 'claude', name: 'Claude', glyph: 'C', snap: { status: 'ok', windows: [win('session', .42, 3), win('seven_day', .71, 90)], fetched_at: now, note: '', details: ['1 reset available', 'Reset expires Oct 22, 2026, 12:00 PM'] } },
  { id: 'codex', base: 'codex', name: 'Codex', glyph: 'Cx', snap: { status: 'ok', windows: [win('primary', .18, 2), win('secondary', .33, 100)], fetched_at: now, note: '', details: ['Plan: Plus'] } },
];
const glyphs = {};
for (const p of ['claude', 'codex', 'gemini']) glyphs[p] = { kind: 'svg', svg: fs.readFileSync(path.join(UI, 'glyphs', p + '.svg'), 'utf8') };
const answers = {
  get_agent_accounts: accounts, get_glyphs: { ...glyphs }, get_ui_flags: { notch_visible: false, notch_on_hover: true, tray_visible: false },
  get_notch_edge: process.env.INITIAL || EDGE, get_state: { sessions: [], agg: 'idle', counts: {}, lang_resolved: 'en', clock_24h: false },
  get_usage: accounts[0].snap, get_codex: accounts[1].snap, get_move_handle: true, get_weekly_ring: 'outside',
  get_color_transition: 'ramp', get_theme_resolved: 'dark', get_update_state: { status: 'current' }, get_notch_slots: [],
  get_activity: [], get_antigravity_prefs: { limit: 'automatic', model: 'gemini' },
};
(async () => {
  const browser = await chromium.launch();
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(process.env.DPR || 1) });
  await page.addInitScript(({ answers }) => {
    const listeners = {};
    window.agentUsage = {
      invoke: c => { return Promise.resolve(c in answers ? answers[c] : c.startsWith('get_') ? { status: 'absent', windows: [], fetched_at: 0, note: '' } : null); },
      on: (n, cb) => { (listeners[n] = listeners[n] || []).push(cb); return () => {}; },
    };
    window.__emit = (n, p) => (listeners[n] || []).forEach(cb => cb(p));
  }, { answers });
  const errors=[];page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto('file://' + UI + '/notch.html');
  await page.addStyleTag({ content: 'html{background:linear-gradient(135deg,#5a6f8a,#9aa9bb)}' });
  await page.waitForTimeout(300);
  await page.evaluate(({ EDGE, ALONG }) => {
    __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge: EDGE, along: ALONG, visible: true, tracking: false, pinned: false });
    __emit('appear', { edge: EDGE });
  }, { EDGE, ALONG });

  await page.waitForTimeout(1200);
  const sample=async t=>page.evaluate(t=>{
    cancelAnimationFrame(frame);frame=0;cancelAnimationFrame(armsFrame);armsOut=1;
    window.agentTracking=true;
    position=target=(t+2*(innerWidth+innerHeight))%(2*(innerWidth+innerHeight));
    animate(performance.now());
    return {pass:passage,edge:notchEdge,clip:getComputedStyle(pill).clipPath,
      transforms:[partA,partB].map(p=>p.getAttribute('transform'))};
  },t);
  for(const [edge,t] of [['right',1680],['left',3760],['top',640],['bottom',2720]]){
    await sample(t);
    await page.evaluate(()=>{window.agentTracking=false;});
    const ring=await page.locator('.cell .ringwrap').first().boundingBox();
    await page.mouse.move(ring.x+ring.width/2,ring.y+ring.height/2);
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(()=>card.classList.contains('show')),false,'hover dwell');
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(()=>detailArm>0&&detailArm<.4),'arms absorb gradually during the opening');
    assert.equal(await page.locator('.compact-account').count(),1);
    await page.screenshot({path:path.join(OUT,edge+'-extending.png')});
    await page.waitForTimeout(1600);
    const initial=await page.evaluate(()=>({open:detailOpen,account:card.dataset.account,ink:detailPath.getAttribute('d'),opacity:getComputedStyle(card).opacity,
      box:card.getBoundingClientRect().toJSON(),tail:getComputedStyle(tail).clipPath,background:getComputedStyle(card).backgroundColor}));
    assert.ok(initial.open>.99&&initial.open<1.01);assert.equal(initial.account,'claude');assert.equal(initial.tail,'none');assert.equal(initial.background,'rgba(0, 0, 0, 0)');assert.equal(initial.opacity,'1');assert.ok(initial.ink.includes('V0'));assert.ok(initial.ink.includes('A'));
    assert.ok(initial.box.x>=0&&initial.box.y>=0&&initial.box.right<=1280&&initial.box.bottom<=800);
    assert.ok(await page.evaluate(()=>{
      const {a0,a1,depth}=detailBox;
      // Both ends of the original notch continue outward as solid black, without a neck.
      return [a0+28,a1-28].every(u=>detailPath.isPointInFill(new DOMPoint(u,depth+8)));
    }),'expansion continues across the original notch width');
    assert.ok(await page.evaluate(()=>{
      const chosen=pill.querySelector('.focused-account'),other=pill.querySelector('.compact-account');
      return chosen.dataset.p==='claude'&&getComputedStyle(chosen.querySelector('.reading')).opacity==='1'&&getComputedStyle(other.querySelector('.pct')).opacity==='0'&&getComputedStyle(other.querySelector('.reading')).opacity==='0'&&+getComputedStyle(other.querySelector('.glyph')).opacity>0;
    }),'selected reading remains visible; other readings become live glyphs');
    const anchored=await page.locator('.cell .ringwrap').first().boundingBox();
    assert.ok(Math.abs(anchored.x-ring.x)<.1&&Math.abs(anchored.y-ring.y)<.1,'gauge extends without traveling');
    await page.screenshot({path:path.join(OUT,edge+'-details.png')});
    const shoulder=await page.evaluate(()=>{
      const matrix=detailPath.getScreenCTM(),u=(detailBox.a0+detailBox.a1)/2,v=12;
      const p=new DOMPoint(u,v).matrixTransform(matrix);return {x:p.x,y:p.y};
    });
    await page.mouse.move(shoulder.x,shoulder.y);await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>card.classList.contains('show')),true,'expanded notch stays open over its black');
    const bridge=await page.locator('#tail').boundingBox();
    await page.mouse.move(bridge.x+bridge.width/2,bridge.y+bridge.height/2);await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>card.classList.contains('show')),true,'cross the connected shoulder');
    await page.mouse.move(initial.box.x+initial.box.width/2,initial.box.y+initial.box.height/2);await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>card.classList.contains('show')),true,'read within the expansion');
    assert.equal(await page.locator('.account-extra,.extra-toggle').count(),0,'no separate Account details row');
    const geometry=await page.evaluate(()=>({ink:detailPath.getAttribute('d'),pill:pill.getBoundingClientRect().toJSON()}));
    const vertical=edge==='left'||edge==='right';
    if(vertical){
      assert.equal(await page.locator('#card .inline-extras').innerText(),'1 reset available\nReset expires Oct 22, 2026, 12:00 PM','side metadata opens inside the usage frame by default');
      assert.equal(await page.locator('.metadata-trigger').count(),0);
    }else{
    assert.equal(await page.evaluate(()=>extraTarget),0,'top/bottom extras start hidden');
    await page.locator('.metadata-trigger').hover();await page.waitForTimeout(950);
    assert.equal(await page.evaluate(()=>extraOpen),1);
    assert.equal(await page.evaluate(()=>detailPath.getAttribute('d')),geometry.ink,'metadata never enlarges the main notch');
    const metadata=await page.locator('#extra-card').boundingBox();
    assert.ok(Math.abs(metadata.x+metadata.width/2-(initial.box.x+initial.box.width/2))<1,'metadata is centered');
    await page.mouse.move(metadata.x+metadata.width/2,metadata.y+metadata.height/2);await page.waitForTimeout(350);
    assert.equal(await page.evaluate(()=>extraTarget),1,'metadata remains readable on hover');
    await page.screenshot({path:path.join(OUT,edge+'-metadata.png')});
    }
    const next=await page.locator('.cell .ringwrap').nth(1).boundingBox();
    await page.mouse.move(next.x+next.width/2,next.y+next.height/2);await page.waitForTimeout(110);
    assert.ok(await page.evaluate(()=>card.dataset.account==='codex'&&detailTarget===1&&pill.querySelector('.focused-account').dataset.p==='codex'),'small glyph switches without closing the notch');
    assert.equal(await page.locator('.compact-account').count(),1);
    assert.equal(await page.evaluate(()=>getComputedStyle(card.querySelector('.usage-content')).translate),'none','content stays in place');
    await page.screenshot({path:path.join(OUT,edge+'-handoff.png')});
    // Switching again before the frame settles keeps its live spring velocity.
    await page.evaluate(()=>{hoverId='claude';renderCard();});await page.waitForTimeout(35);
    assert.equal(await page.evaluate(()=>pill.querySelector('.focused-account').dataset.p),'claude');
    await page.evaluate(()=>{hoverId='codex';renderCard();});await page.waitForTimeout(1600);
    assert.equal(await page.evaluate(()=>card.dataset.account),'codex');
    assert.equal(await page.evaluate(()=>extraTarget),0,'switching accounts closes metadata');
    const switched=await page.locator('#card').boundingBox();
    assert.ok(edge==='top'||edge==='bottom'?Math.abs(switched.x+switched.width/2-(initial.box.x+initial.box.width/2))<1:Math.abs(switched.y+switched.height/2-(initial.box.y+initial.box.height/2))<1,'usage frame stays centered when accounts switch');
    if(vertical){
      assert.equal(await page.locator('#card .inline-extras').innerText(),'Plan: Plus','side metadata follows the selected account');
    }else{
      await page.locator('.metadata-trigger').hover();await page.waitForTimeout(950);
      assert.equal(await page.locator('#extra-card').innerText(),'Plan: Plus','name hover shows the newly selected account metadata');
    }
    await page.mouse.move(640,400);await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(()=>detailOpen),0);assert.equal(await page.evaluate(()=>detailPath.getAttribute('d')),null);
    assert.equal(await page.evaluate(()=>card.classList.contains('closing')),false);
  }
  // A fourth account can arrive from the collector without losing any existing accounts.
  await sample(640);await page.evaluate(()=>{window.agentTracking=false;});
  const agy={id:'antigravity',base:'gemini',name:'Antigravity',glyph:'A',snap:{status:'ok',fetched_at:now,note:'',details:[],windows:[
    {...win('gemini-5h',.12,3),group:'Gemini Models'}, {...win('gemini-weekly',.28,100),group:'Gemini Models'},
    {...win('3p-5h',.05,3),group:'Claude and GPT models'}, {...win('3p-weekly',.1,100),group:'Claude and GPT models'}
  ]}};
  await page.evaluate(value=>__emit('agent_accounts',value),[...accounts,{...accounts[1],id:'codex-b',name:'Codex b'},agy]);
  await page.waitForTimeout(500);await sample(640);await page.evaluate(()=>{window.agentTracking=false;});
  assert.equal(await page.locator('.cell').count(),4);
  await page.locator('.cell[data-p="antigravity"]').hover();await page.waitForTimeout(2000);
  assert.equal(await page.evaluate(()=>card.dataset.account),'antigravity');
  assert.equal(await page.locator('#card .g-box').count(),0);assert.equal(await page.locator('#card .w-track').count(),2);
  assert.equal(await page.locator('#card .g-head').count(),0,'Gemini uses the same plain usage rows as other accounts');
  assert.equal(await page.locator('.c-title').innerText(),'Antigravity Usage');
  assert.equal(await page.locator('.compact-account').count(),3);
  await page.screenshot({path:path.join(OUT,'four-accounts-antigravity.png')});
  const agyOutline=await page.evaluate(()=>detailPath.getAttribute('d'));
  await page.locator('.metadata-trigger').hover();await page.waitForTimeout(950);
  assert.equal(await page.evaluate(()=>extraOpen),1);
  assert.equal(await page.locator('#extra-card .g-head').innerText(),'Claude and GPT models');
  assert.equal(await page.locator('#extra-card .w-track').count(),2);
  assert.equal(await page.locator('#extra-card .g-box').count(),0,'extra model quotas also use plain rows');
  assert.equal(await page.locator('#card .w-track').count(),2);
  assert.equal(await page.evaluate(()=>detailPath.getAttribute('d')),agyOutline,'extra models do not enlarge main usage');
  const agyExtras=await page.locator('#extra-card').boundingBox();
  await page.mouse.move(agyExtras.x+agyExtras.width/2,agyExtras.y+agyExtras.height/2);await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>extraTarget),1,'extra quotas remain readable while hovered');
  await page.screenshot({path:path.join(OUT,'antigravity-extra-models.png')});
  await page.locator('.cell[data-p="codex-b"]').focus();
  assert.equal(await page.evaluate(()=>card.dataset.account),'codex-b','small account glyph supports keyboard focus');
  assert.equal(await page.evaluate(()=>extraTarget),0,'account switch closes extra models');
  assert.equal(await page.locator('#extra-card .w-track').count(),0,'extra models do not leak into another account');
  await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>detailTarget),1);
  await page.evaluate(()=>hideCard());await page.waitForTimeout(1600);
  await sample(1680);await page.evaluate(()=>{window.agentTracking=false;hoverId='antigravity';showCard();});await page.waitForTimeout(1800);
  assert.equal(await page.locator('#card .inline-extras .w-track').count(),2,'side extra model quotas open by default');
  assert.equal(await page.locator('#extra-card').innerText(),'','side extras stay within the main frame');
  await page.screenshot({path:path.join(OUT,'side-antigravity-extras.png')});
  for(const [state,selector] of [['busy','.arc-spin'],['waiting','.arc-pulse']]){
    await page.evaluate(state=>__emit('activity',[{provider:'antigravity',account:'antigravity',state,name:'AGY',detail:state==='busy'?'Working':'Input needed',since:Date.now()}]),state);
    assert.equal(await page.locator('.cell[data-p="antigravity"] svg.activity '+selector).count(),1,'AGY shares the existing live activity indicator');
    await page.screenshot({path:path.join(OUT,'antigravity-'+state+'.png')});
  }
  await page.evaluate(()=>__emit('activity',[]));
  assert.equal(await page.locator('.cell[data-p="antigravity"] svg.activity > *').count(),0,'idle AGY clears activity');
  await page.evaluate(()=>hideCard());await page.waitForTimeout(1200);
  const tallAccounts=accounts.map(a=>({...a,snap:{...a.snap,details:Array.from({length:12},(_,i)=>`Account detail ${i+1}`)}}));
  await page.evaluate(value=>__emit('agent_accounts',value),tallAccounts);
  await page.evaluate(()=>{hoverId='claude';showCard();});await page.waitForTimeout(1800);
  assert.ok(await page.evaluate(()=>card.offsetHeight>pill.offsetHeight&&detailBox.u1-detailBox.u0>=card.offsetHeight-.1),'side frame extends along the edge when metadata exceeds notch length');
  assert.ok(await page.evaluate(()=>{const r=card.querySelector('.inline-extras').getBoundingClientRect();return detailContains(r.left+12,r.bottom-4);}), 'extended metadata has black beneath it');
  await page.screenshot({path:path.join(OUT,'side-extended-metadata.png')});
  await page.evaluate(()=>hideCard());await page.waitForTimeout(1200);
  await page.evaluate(value=>__emit('agent_accounts',value),accounts);
  // Interrupted close/reopen continues from the live shape; shortcut tracking dismisses instantly.
  await sample(1680);await page.evaluate(()=>{window.agentTracking=false;hoverId='claude';showCard();});await page.waitForTimeout(250);
  await page.evaluate(()=>hideCard());await page.waitForTimeout(80);await page.evaluate(()=>showCard());await page.waitForTimeout(1700);
  assert.equal(await page.evaluate(()=>detailOpen),1);
  await page.evaluate(()=>{window.agentTracking=true;hideCard();});assert.equal(await page.evaluate(()=>detailOpen),0);assert.equal(await page.locator('.compact-account').count(),0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>{window.agentTracking=false;showCard();});assert.equal(await page.evaluate(()=>detailOpen),1);assert.equal(await page.locator('.compact-account').count(),1);
  await page.evaluate(()=>hideCard());assert.equal(await page.evaluate(()=>detailOpen),0);
  await page.setViewportSize({width:360,height:300});
  for(const t of [180,510,840,1170]){
    await sample(t);await page.evaluate(()=>{window.agentTracking=false;hoverId='claude';showCard();});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const box=await page.locator('#card').boundingBox();
    assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=360&&box.y+box.height<=300,'details fit a small viewport');
    await page.evaluate(()=>hideCard());
  }
  assert.deepEqual(errors,[]);
  console.log('Passed: connected hover expansion on all four edges, small viewport fit, hover dwell, bridge/card traversal, account switching, dismissal, interrupted spring, reduced motion.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
