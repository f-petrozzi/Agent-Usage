// Alerts grow out of their account's ring as a sliver of the notch. Real browser, stubbed bridge.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path');
const UI = path.resolve(__dirname, '../../desktop/ui');
const OUT = process.argv[2] || '/tmp/agent-usage-alerts';
fs.mkdirSync(OUT, { recursive: true });
const now = Date.now();
const win = (id, label, used, h) => ({ id, label, used, resets_at: now + h * 3600e3, count: null, derived: false });
const accounts = [
  { id: 'codex', base: 'codex', name: 'Codex', glyph: 'Cx', snap: { status: 'ok', windows: [win('primary', '5 hours', .18, 2)], fetched_at: now, note: '', details: [] } },
  { id: 'claude', base: 'claude', name: 'Claude', glyph: 'C', snap: { status: 'ok', windows: [win('session', '5 hours', .83, 3), win('seven_day', 'Weekly', .29, 90)], fetched_at: now, note: '', details: [], resets: { count: 1, expires: now + 20 * 86400e3, each: [] } } },
];
const glyphs = {};
for (const p of ['claude', 'codex', 'gemini']) glyphs[p] = { kind: 'svg', svg: fs.readFileSync(path.join(UI, 'glyphs', p + '.svg'), 'utf8') };
const answers = {
  get_agent_accounts: accounts, get_glyphs: glyphs, get_ui_flags: { notch_visible: false, notch_on_hover: true, tray_visible: false },
  get_state: { sessions: [], agg: 'idle', counts: {}, lang_resolved: 'en', clock_24h: false },
  get_weekly_ring: 'off', get_color_transition: 'hard_step', get_theme_resolved: 'dark', get_update_state: { status: 'current' },
  get_notch_slots: [], get_activity: [], get_antigravity_prefs: { limit: 'automatic', model: 'gemini' }, get_notch_buttons: { pin: true, alerts: true },
  get_alert_preferences: { quota: true, waiting: true, completion: true, sound: true, muted: [] }, get_alert_log: [],
};
const quota = { id: 'q1', kind: 'quota', account: 'claude', window: 'session', level: 80, title: 'Claude usage warning', body: '5 hours: 83% used.' };
async function open(browser, edge = 'right', reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ answers, edge }) => {
    const listeners = {}; window.__calls = [];
    window.agentUsage = { invoke: (c, a = {}) => { window.__calls.push([c, a]); if(c==='open_alert_session'&&a.id==='failed')return Promise.reject(new Error('VS Code was not found.')); return Promise.resolve(c === 'open_alert_session' ? !!a.id && ['linked','keyboard'].includes(a.id) : c === 'get_notch_edge' ? edge : c in answers ? answers[c] : null); },
      on: (n, cb) => { (listeners[n] = listeners[n] || []).push(cb); return () => {}; } };
    window.__emit = (n, p) => (listeners[n] || []).forEach(cb => cb(p));
    window.__chimes = 0;
    window.AudioContext = class { constructor() { window.__chimes++; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createOscillator() { return { frequency: {}, connect() {}, start() {}, stop() {} }; } resume() {} };
  }, { answers, edge });
  await page.goto('file://' + UI + '/notch.html');
  await page.waitForTimeout(300);
  return { page, errors };
}
const arrive = (page, payload, edge = 'right') => page.evaluate(({ payload, edge }) => {
  __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge, along: .5, visible: true, tracking: false, pinned: false });
  __emit('appear', { edge }); __emit('alert', payload);
}, { payload, edge });
// The body is the tab without the fillets that join it to the notch; its outline (fillets and all) is what can be pointed at
const box = (page, account) => page.evaluate(a => { const s = slivers.get(a); if (!s) return null; const r = s.el.getBoundingClientRect(), o = s.path.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, outline: { x: o.x, y: o.y, w: o.width, h: o.height }, text: s.el.innerText.replace(/\n/g, ' '), fits: s.el.scrollWidth <= s.el.clientWidth + 1 }; }, account);
const ringBox = (page, id) => page.locator(`.cell[data-p="${id}"] .ringwrap`).boundingBox();
const sideSection = (page, id) => page.evaluate(id => {
  const r=pill.getBoundingClientRect(),cells=[...pill.querySelectorAll('.cell')].sort((a,b)=>a.getBoundingClientRect().y-b.getBoundingClientRect().y);
  const i=cells.findIndex(e=>e.dataset.p===id),height=r.height/cells.length;
  return {y:r.y+i*height,height};
},id);
(async () => {
  const browser = await chromium.launch();
  try {
    const { page, errors } = await open(browser);
    await arrive(page, { events: [quota], sound: true, hold: 2500 });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => slivers.size), 0, 'waits for the notch to finish arriving');
    await page.waitForTimeout(1100);
    const ring = await ringBox(page, 'claude'), s = await box(page, 'claude');
    assert.ok(s, 'a sliver out of Claude\'s ring');
    assert.equal(s.text, 'Usage warning 5 hours · 83%');
    const section=await sideSection(page,'claude');
    assert.ok(Math.abs(s.h-section.height)<.1&&Math.abs(s.y-section.y)<.1,'fills its equal share of the whole notch');
    const cell = await page.locator('.cell[data-p="claude"]').boundingBox();
    assert.ok(s.y <= cell.y && s.y+s.h >= cell.y+cell.height, 'covers the entire account section');
    assert.ok(s.x + s.w <= ring.x + 2 && s.w < 320, 'beside the ring, only as long as its line');
    assert.ok(s.fits, 'its line fits it');
    assert.equal(await page.evaluate(() => card.classList.contains('show')), false, 'the notch itself does not open');
    assert.equal(await page.evaluate(() => window.__chimes), 1, 'sound on plays the chime');
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => JSON.parse(lastHot).alerting), true, 'main keeps the notch out for it');
    await page.screenshot({ path: path.join(OUT, 'sliver.png') });
    // Pointer moves elsewhere on the screen do not dismiss it; it draws back in once its time is up
    for (let i = 0; i < 6; i++) { await page.mouse.move(100 + i * 60, 600 - i * 40); await page.waitForTimeout(60); }
    assert.equal(await page.evaluate(() => slivers.size), 1);
    await page.waitForTimeout(2400);
    assert.equal(await page.evaluate(() => slivers.size), 0, 'drawn back in');
    await page.waitForTimeout(80);
    assert.equal(await page.evaluate(() => JSON.parse(lastHot).alerting), false);

    // Pointed at, it holds past its time and counts as seen; clicked, it opens that account's usage, held
    await page.evaluate(q => __emit('alert', { events: [q], sound: false, hold: 1200 }), { ...quota, id: 'q2' });
    await page.waitForTimeout(700);
    const s2 = await box(page, 'claude');
    await page.mouse.move(s2.x + s2.w / 2, s2.y + s2.h / 2); await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => slivers.size), 1, 'held while read');
    assert.deepEqual(await page.evaluate(() => window.__calls.filter(c => c[0] === 'mark_alerts_read').at(-1)[1]), { ids: ['q2'] }, 'seen');
    await page.mouse.click(s2.x + s2.w / 2, s2.y + s2.h / 2); await page.waitForTimeout(700);
    assert.deepEqual(await page.evaluate(() => [card.classList.contains('show'), card.dataset.account, cardHeld]), [true, 'claude', true]);
    assert.equal(await page.evaluate(() => slivers.size), 0, 'the card takes its place');
    await page.evaluate(() => __emit('outside_press')); await page.mouse.move(640, 400); await page.waitForTimeout(1200);

    // Several accounts at once each come out of their own ring; a second for the same account joins its sliver
    await page.evaluate(() => {
      __emit('alert', { events: [{ id: 'w1', kind: 'waiting', account: 'codex', session: 'agent-usage' }, { id: 'c1', kind: 'completion', account: 'claude', session: 'homelab', took: 14 * 60000 }], sound: false, hold: 3000 });
      __emit('alert', { events: [{ id: 'q3', kind: 'quota', account: 'claude', window: 'session', level: 100 }], sound: false, hold: 3000 });
    });
    await page.waitForTimeout(900);
    assert.equal((await box(page, 'codex')).text, 'Needs you agent-usage');
    assert.equal((await box(page, 'claude')).text, 'Limit reached 5 hours · 83% +1', 'the more urgent one leads, the other is counted');
    const [cr, dr] = [await ringBox(page, 'codex'), await box(page, 'codex')];
    const dc=await sideSection(page,'codex');
    assert.ok(Math.abs(dr.y-dc.y)<.1&&Math.abs(dr.h-dc.height)<.1,'fills its own account section');
    await page.screenshot({ path: path.join(OUT, 'slivers.png') });
    await page.waitForTimeout(3400);

    // An open card comes first: an alert waits for it to close
    const codexRing = await ringBox(page, 'codex');
    await page.mouse.move(codexRing.x + 20, codexRing.y + 20); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => card.dataset.account), 'codex');
    await page.evaluate(() => __emit('alert', { events: [{ id: 'f1', kind: 'completion', account: 'codex', session: 'homelab', took: 60000 }], sound: false, hold: 1500 }));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => slivers.size), 0, 'does not grow over a card being read');
    await page.mouse.move(640, 400); await page.waitForTimeout(1300);
    assert.equal((await box(page, 'codex')).text, 'Finished homelab · 1 min');
    // The notch going away takes its slivers with it
    await page.evaluate(() => __emit('disappear')); await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => slivers.size), 0);
    assert.deepEqual(errors, []);
    await page.close();

    // A session notification opens VS Code by its logged alert identity, by click and keyboard.
    const linked = await open(browser);
    const target = { provider: 'claude', sessionId: '12345678-1234-5678-abcd-123456789012' };
    await arrive(linked.page, { events: [{ id: 'linked', kind: 'completion', account: 'claude', session: 'homelab', took: 120000, target }], hold: 4000 });
    await linked.page.waitForTimeout(1300);
    await linked.page.locator('.sliver').click();
    assert.deepEqual(await linked.page.evaluate(() => __calls.filter(c => c[0] === 'open_alert_session').at(-1)), ['open_alert_session', { id: 'linked' }]);
    assert.equal(await linked.page.evaluate(() => card.classList.contains('show')), false);
    assert.equal(await linked.page.locator('[title], svg title').count(), 0, 'no native hover tooltips');
    await linked.page.evaluate(target => __emit('alert', { events: [{ id: 'keyboard', kind: 'waiting', account: 'claude', session: 'homelab', target }], hold: 4000 }), target);
    await linked.page.waitForTimeout(900);
    await linked.page.locator('.sliver').focus(); await linked.page.keyboard.press('Enter');
    assert.deepEqual(await linked.page.evaluate(() => __calls.filter(c => c[0] === 'open_alert_session').at(-1)), ['open_alert_session', { id: 'keyboard' }]);
    await linked.page.evaluate(() => openNotifiedAlert({id:'failed',kind:'completion'},'claude'));
    assert.equal(await linked.page.evaluate(() => card.classList.contains('show')),true,'notification launch failures show a visible card');
    assert.equal(await linked.page.locator('.session-link-error').textContent(),'VS Code was not found.');
    // Settings previews use the notification geometry, stay until disabled, and do not enter history.
    await linked.page.evaluate(()=>__emit('notification_test','claude'));
    await linked.page.waitForFunction(()=>slivers.get('claude')?.test);
    assert.equal(await linked.page.evaluate(()=>slivers.get('claude').timer),0,'sample stays while enabled');
    assert.equal(await linked.page.evaluate(()=>alertLogData.length),0,'sample does not change history');
    await linked.page.evaluate(()=>{__emit('notch_slots',[{provider:'claude'}]);__emit('notification_test','codex');});
    await linked.page.waitForFunction(()=>slivers.get('codex')?.test);
    assert.equal(await linked.page.evaluate(()=>slivers.size),1,'switching the test replaces the preview');
    assert.equal(await linked.page.locator('.cell[data-p="codex"]').count(),1,'hidden accounts get their own temporary gauge for the test');
    await linked.page.evaluate(()=>__emit('notification_test',null));
    assert.equal(await linked.page.evaluate(()=>slivers.size),0,'off dismisses the preview');
    assert.equal(await linked.page.locator('.cell[data-p="codex"]').count(),0,'hidden account visibility returns after the test');
    await linked.page.close();

    // On a flat edge it hangs below its ring, spreading to its length
    for(const edge of ['top','bottom','left']){
      const { page: ep, errors: ee } = await open(browser, edge);
      await arrive(ep, { events: [quota], sound: false, hold: 4000 }, edge);
      await ep.waitForTimeout(1300);
      const [er, es] = [await ringBox(ep, 'claude'), await box(ep, 'claude')];
      assert.ok(es.fits, 'line fits on ' + edge);
      if(edge==='left'){
        const section=await sideSection(ep,'claude');
        assert.ok(Math.abs(es.h-section.height)<.1&&Math.abs(es.y-section.y)<.1);
        const cell=await ep.locator('.cell[data-p="claude"]').boundingBox();
        assert.ok(es.y<=cell.y&&es.y+es.h>=cell.y+cell.height);
      }else{
        assert.ok(es.h>=42&&es.h<60, 'a text-sized lift');
        const notch=await ep.locator('#pill').boundingBox();
        assert.ok(es.outline.x>=notch.x-1&&es.outline.x+es.outline.w<=notch.x+notch.width+1, 'end-gauge outline stays inside the notch width');
        const join=await ep.evaluate(() => {
          const path=slivers.get('claude').path.getAttribute('d');
          return {corner:SHAPE.corner,rounded:path.includes(`A${SHAPE.corner} ${SHAPE.corner}`),curves:(path.match(/C/g)||[]).length};
        });
        assert.equal(join.rounded,true,'notification corners use the notch radius');
        assert.equal(join.curves,0,'simple rounded rectangles have no tapered neck');
        assert.ok(er.x+er.width/2>=es.x&&er.x+er.width/2<=es.x+es.w);
        assert.ok(edge==='top'?es.y>=er.y+er.height-4:es.y+es.h<=er.y+4, 'outside the ring');
      }
      await ep.screenshot({ path: path.join(OUT, 'sliver-' + edge + '.png') });
      if(edge==='top'){
        await ep.evaluate(() => { retractSlivers(true); __emit('alert',{events:[{kind:'waiting',id:'first',account:'codex',session:'homelab'},{kind:'completion',id:'last',account:'claude',session:'homelab',took:60000}],hold:900,sound:false}); });
        await ep.waitForTimeout(600);
        assert.equal(await ep.evaluate(() => slivers.size),1,'flat-edge alerts do not overlap');
        assert.equal(await ep.evaluate(() => alertQueue.length),1,'next account waits');
        await ep.waitForFunction(() => slivers.has('claude'),null,{timeout:4000});
        assert.ok(await ep.evaluate(() => slivers.has('claude')),'the queued account follows');
      }
      assert.deepEqual(ee, []); await ep.close();
    }

    // Every flat-edge section, including the physical order reversed on the bottom.
    for(const edge of ['top','bottom']){
      const flat=await open(browser,edge,'reduce');
      await flat.page.evaluate(()=>__emit('agent_accounts',[...agentAccounts,
        {...agentAccounts[0],id:'work',name:'Work'}, {...agentAccounts[1],id:'personal',name:'Personal'}]));
      await arrive(flat.page,{events:[],hold:4000},edge);
      await flat.page.waitForTimeout(400);
      const order=await flat.page.locator('.cell').evaluateAll(es=>es.map(e=>({id:e.dataset.p,x:e.getBoundingClientRect().x})).sort((a,b)=>a.x-b.x).map(e=>e.id));
      for(let i=0;i<order.length;i++){
        await flat.page.evaluate(id=>{retractSlivers(true);showSliver(id,[{kind:'waiting',account:id,session:'homelab'}],4000);},order[i]);
        const g=await flat.page.evaluate(id=>{
          const s=slivers.get(id),notch=pill.getBoundingClientRect(),cells=[...pill.querySelectorAll('.cell')].sort((a,b)=>a.getBoundingClientRect().x-b.getBoundingClientRect().x);
          const centers=cells.map(e=>{const r=e.getBoundingClientRect();return r.x+r.width/2;});
          const index=cells.findIndex(e=>e.dataset.p===id),path=s.path.getAttribute('d'),bounds=s.path.getBoundingClientRect();
          const body=s.el.getBoundingClientRect(),middle=(notch.x+notch.right)/2;
          return {index,count:cells.length,x:bounds.x,end:bounds.right,notchX:notch.x,notchEnd:notch.right,width:body.width,
            center:body.x+body.width/2,expected:middle+(centers[index]-middle)*.65,rect:!path.includes('C'),rounded:path.includes(`A${SHAPE.corner} ${SHAPE.corner}`)};
        },order[i]);
        assert.ok(g.x>=g.notchX-1&&g.end<=g.notchEnd+1,'rectangle stays within the notch');
        assert.ok(g.width>=128&&g.width<=160,'text body remains compact and readable');
        assert.equal(g.rect,true);assert.equal(g.rounded,true,'shares the notch corner radius');
        if(i===0)assert.ok(Math.abs(g.x-g.notchX)<.1,'left end matches the notch edge');
        else if(i===order.length-1)assert.ok(Math.abs(g.end-g.notchEnd)<.1,'right end matches the notch edge');
        else assert.ok(Math.abs(g.center-g.expected)<.1,'middle rectangles stay closer to center on their account side');
        await flat.page.screenshot({path:path.join(OUT,`four-${edge}-${i}.png`)});
      }
      assert.deepEqual(flat.errors,[]);await flat.page.close();
    }

    // Even partitions include all notch padding, for one through four accounts and both side orders.
    for(const edge of ['left','right']){
      const side=await open(browser,edge,'reduce');
      await arrive(side.page,{events:[],hold:4000},edge);
      await side.page.waitForTimeout(450);
      for(const count of [1,2,3,4]){
        await side.page.evaluate(count=>{
          retractSlivers(true);__emit('agent_accounts',Array.from({length:count},(_,i)=>({...agentAccounts[i%agentAccounts.length],id:'section-'+i})));
          aim(layout.edge,layout.along,true);
        },count);
        const ids=await side.page.locator('.cell').evaluateAll(es=>es.map(e=>({id:e.dataset.p,y:e.getBoundingClientRect().y})).sort((a,b)=>a.y-b.y).map(e=>e.id));
        for(const id of ids){
          await side.page.evaluate(id=>{retractSlivers(true);showSliver(id,[{kind:'waiting',account:id,session:'homelab'}],4000);},id);
          const expected=await sideSection(side.page,id),body=await box(side.page,id);
          assert.ok(Math.abs(body.y-expected.y)<.1&&Math.abs(body.h-expected.height)<.1,'body matches its entire partition');
          assert.ok(Math.abs(body.outline.y-expected.y)<.1&&Math.abs(body.outline.h-expected.height)<.1,'corners add no height beyond the partition');
          await side.page.screenshot({path:path.join(OUT,`sections-${edge}-${count}-${id}.png`)});
        }
      }
      assert.deepEqual(side.errors,[]);await side.page.close();
    }

    // Long details pan within a bounded notification; the status and outer shape stay still.
    const longEvent={id:'long',kind:'waiting',account:'claude',session:'a very long project name with enough detail to exceed the default notch length'};
    for(const edge of ['right','top']){
      const long=await open(browser,edge);
      await arrive(long.page,{events:[longEvent],hold:4000},edge);
      await long.page.waitForFunction(() => !!slivers.get('claude')?.scroll,null,{timeout:4000});
      const ticker=await long.page.evaluate(() => {
        const s=slivers.get('claude'),word=s.el.querySelector('.s-word'),text=s.el.querySelector('.s-scroll');
        const width=s.el.getBoundingClientRect().width,first=word.getBoundingClientRect().x;
        s.scroll.currentTime=s.scroll.effect.getTiming().duration/4;
        return {width,distance:s.scrollDistance,translation:new DOMMatrix(getComputedStyle(text).transform).m41,
          statusShift:word.getBoundingClientRect().x-first,rows:s.el.querySelector('.s-text').getBoundingClientRect().height};
      });
      assert.ok(ticker.width<=228,'long notifications stop at the default notch length');
      assert.ok(ticker.distance>0&&ticker.translation<0,'overflowing details scroll');
      assert.equal(ticker.statusShift,0,'status stays still');
      assert.ok(ticker.rows<20,'long details do not wrap into extra rows');
      assert.deepEqual(long.errors,[]);await long.page.close();
    }

    for(const edge of ['top','right','bottom','left']){
      const dragged=await open(browser,edge);
      await arrive(dragged.page,{events:[quota],hold:10000},edge);await dragged.page.waitForTimeout(1400);
      assert.equal(await dragged.page.evaluate(()=>slivers.size),1);
      await dragged.page.evaluate(()=>__emit('edge_cursor',{edge:layout.edge,x:300,y:300}));
      assert.equal(await dragged.page.locator('.sliver,.sliver-ink').count(),0,'held dragging leaves no detached notification text or ink on '+edge);
      assert.equal(await dragged.page.locator('#notification-rim').getAttribute('hidden'),'','dragging cancels the glow in the same frame');
      await dragged.page.evaluate(()=>{__emit('release');showSliver('claude',[{kind:'waiting',account:'claude',session:'Follow-up'}],10000);});await dragged.page.waitForTimeout(1100);
      await dragged.page.evaluate(()=>__emit('move_begin'));
      assert.equal(await dragged.page.locator('.sliver,.sliver-ink').count(),0,'mouse dragging also removes notification ink immediately');
      assert.deepEqual(dragged.errors,[]);await dragged.page.close();
    }
    const reduced = await open(browser, 'right', 'reduce');
    await arrive(reduced.page, { events: [quota], sound: false, hold: 2000 });
    await reduced.page.waitForTimeout(600);
    assert.equal(await reduced.page.evaluate(() => slivers.get('claude')?.t), 1, 'reduced motion: out at once');
    await reduced.page.evaluate(e => showSliver('claude',[e],4000),longEvent);
    assert.equal(await reduced.page.evaluate(() => slivers.get('claude').el.querySelector('.s-scroll').getAnimations().length),0,'reduced motion disables text panning');
    assert.deepEqual(reduced.errors, []);
    console.log('Passed: waits for arrival, a notification spanning its account and sized to its line, chime, pointer elsewhere, time out, hold and seen, click to held usage, one per account with the urgent one leading, waits for a card, goes with the notch, flat edge, reduced motion.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
