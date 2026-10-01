// The leading pocket holds pin and the alert log; scrolling swaps them and the log grows out of the notch. Real browser, stubbed bridge that answers like main.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path');
const UI = path.resolve(__dirname, '../../desktop/ui');
const OUT = process.argv[2] || '/tmp/agent-usage-bell';
fs.mkdirSync(OUT, { recursive: true });
const now = Date.now();
const win = (id, label, used, h) => ({ id, label, used, resets_at: now + h * 3600e3, count: null, derived: false });
const accounts = [
  { id: 'codex', base: 'codex', name: 'Codex', glyph: 'Cx', snap: { status: 'ok', windows: [win('primary', '5 hours', .18, 2)], fetched_at: now, note: '', details: [] } },
  { id: 'claude', base: 'claude', name: 'Claude', glyph: 'C', snap: { status: 'ok', windows: [win('session', '5 hours', .83, 3)], fetched_at: now, note: '', details: [] } },
];
const glyphs = {};
for (const p of ['claude', 'codex', 'gemini']) glyphs[p] = { kind: 'svg', svg: fs.readFileSync(path.join(UI, 'glyphs', p + '.svg'), 'utf8') };
// The start of yesterday is over a day ago and one calendar day back at any time of day (26 hours ago is two days back
// just after midnight, and anything under 24 hours reads as hours)
const yesterdayStart = new Date(new Date(now).setHours(0, 0, 5, 0)).getTime() - 864e5;
const log = [
  { id: 'a', at: yesterdayStart, kind: 'completion', account: 'codex', window: null, level: null, used: null, session: 'homelab', title: '', body: '', read: true },
  { id: 'b', at: now - 14 * 60e3, kind: 'waiting', account: 'codex', window: null, level: null, used: null, session: 'agent-usage', title: '', body: 'Approve?', read: false },
  { id: 'c', at: now - 2 * 60e3, kind: 'quota', account: 'claude', window: 'session', level: 80, used: .83, session: null, title: '', body: '', read: false },
];
const answers = {
  get_agent_accounts: accounts, get_glyphs: glyphs, get_ui_flags: { notch_visible: false, notch_on_hover: true, tray_visible: false },
  get_notch_edge: 'right', get_state: { sessions: [], agg: 'idle', counts: {}, lang_resolved: 'en', clock_24h: false },
  get_weekly_ring: 'off', get_color_transition: 'hard_step', get_theme_resolved: 'dark', get_update_state: { status: 'current' },
  get_notch_slots: [], get_activity: [], get_antigravity_prefs: { limit: 'automatic', model: 'gemini' }, get_notch_buttons: { pin: true, alerts: true },
  get_alert_preferences: { quota: true, waiting: true, completion: false, sound: false, muted: [] }, get_alert_log: log,
};
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({ answers }) => {
      const listeners = {}; window.__calls = [];
      const broadcast = (n, v) => setTimeout(() => (listeners[n] || []).forEach(cb => cb(v)), 0);
      window.agentUsage = {
        invoke: (c, a = {}) => {
          window.__calls.push([c, a]);
          if (c === 'set_alert_preferences') { answers.get_alert_preferences = { ...answers.get_alert_preferences, ...a }; broadcast('alert_preferences', answers.get_alert_preferences); return Promise.resolve(answers.get_alert_preferences); }
          if (c === 'mark_alerts_read') { answers.get_alert_log = answers.get_alert_log.map(e => ({ ...e, read: true })); broadcast('alert_log', answers.get_alert_log); return Promise.resolve(answers.get_alert_log); }
          if (c === 'clear_alert_log') { answers.get_alert_log = []; broadcast('alert_log', []); return Promise.resolve([]); }
          if (c === 'open_alert_session') return Promise.resolve(a.id==='linked');
          if (c === 'open_working_session') return Promise.resolve(true);
          return Promise.resolve(c in answers ? answers[c] : null);
        },
        on: (n, cb) => { (listeners[n] = listeners[n] || []).push(cb); return () => {}; },
      };
      window.__emit = (n, p) => { if(n==='alert_log')answers.get_alert_log=p; (listeners[n] || []).forEach(cb => cb(p)); };
      window.AudioContext = class { constructor() { window.__chimes = (window.__chimes || 0) + 1; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
        createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
        createOscillator() { return { frequency: {}, connect() {}, start() {}, stop() {} }; } resume() {} };
    }, { answers });
    await page.goto('file://' + UI + '/notch.html');
    await page.waitForTimeout(300);
    await page.evaluate(() => { __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge: 'right', along: .5, visible: true, tracking: false, pinned: false }); __emit('appear', { edge: 'right' }); });
    await page.waitForTimeout(1200);

    // At rest: the rings are accounts only; the leading pocket holds pin and the log, showing pin, with a dot for what is new
    assert.deepEqual(await page.evaluate(() => [...pill.querySelectorAll('.cell')].map(c => c.dataset.p)), ['codex', 'claude']);
    assert.deepEqual(await page.evaluate(() => [leadFaces, leadFace(), pinHandle.classList.contains('unread')]), [['pin', 'alerts'], 'pin', true]);
    assert.equal(await page.locator('#pin-handle .lead-dot').count(), 0, 'the pin has no unread dot');
    assert.ok(await page.evaluate(() => document.getElementById('notch-dot').classList.contains('on')), 'unread dot sits inside the notch');
    const pocket = await page.evaluate(() => ({ x: pinAt.x, y: pinAt.y }));
    await page.mouse.move(pocket.x, pocket.y); await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => hovered), 'pin');
    await page.screenshot({ path: path.join(OUT, 'pocket-pin.png') });

    // Scrolling swaps what the pocket holds: the pin flows home, the bell buds out; a second scroll mid-swap is ignored
    // Sample the whole swap: the icon softens as it is swallowed, the goo is strong enough to join drop and notch,
    // the drop travels on a strand (the neck is drawn), and the bell's swing comes from the snap, not after it
    await page.evaluate(() => { window.__swap = { blur: 0, goo: 0, strand: 0, sway: 0 }; const f = () => { const h = handles[0], st = h.el.style;
      __swap.blur = Math.max(__swap.blur, +st.getPropertyValue('--glyph-blur') || 0);
      __swap.goo = Math.max(__swap.goo, h.swapping ? +document.querySelector('#goo-start feGaussianBlur').getAttribute('stdDeviation') : 0);
      __swap.strand = Math.max(__swap.strand, h.swapping && necks[0].getAttribute('d') ? 1 : 0);
      __swap.sway = Math.max(__swap.sway, Math.abs(parseFloat(st.getPropertyValue('--sway')) || 0));
      if (performance.now() - __swap.t0 < 1500) requestAnimationFrame(f); }; __swap.t0 = performance.now(); requestAnimationFrame(f); });
    await page.mouse.wheel(0, 100); await page.waitForTimeout(60); await page.mouse.wheel(0, 100);
    assert.ok(await page.evaluate(() => handles[0].swapping && handles[0].swap < 1 && pinHandle.classList.contains('swapping')), 'flowing back into the notch');
    await page.waitForTimeout(1600);
    const swap = await page.evaluate(() => __swap);
    assert.ok(swap.blur > 1, 'the icon softens as it is swallowed');
    assert.ok(swap.goo > 6, 'enough goo to join the drop and the notch');
    assert.equal(swap.strand, 1, 'the drop is pulled out on a strand of the notch');
    assert.ok(swap.sway > 5, 'the bell swings from the snap');
    assert.equal(await page.evaluate(() => handles[0].el.style.getPropertyValue('--sway')), '0deg', 'and is still once home');
    assert.deepEqual(await page.evaluate(() => [leadFace(), handles[0].swap, handles[0].swapping, pinHandle.classList.contains('face-alerts')]), ['alerts', 1, false, true]);
    assert.deepEqual(Object.keys(await page.evaluate(() => JSON.parse(lastHot).controls)).sort(), ['alerts', 'settings'], 'main is told the pocket now holds the log');
    assert.ok(await page.evaluate(() => pinHandle.classList.contains('bell-unread')&&!document.getElementById('notch-dot').classList.contains('on')), 'dot leaves the corner for the revealed bell');
    await page.screenshot({ path: path.join(OUT, 'pocket-bell.png') });

    // Pressing it asks main for the alerts control, and main's answer grows the log out of that end of the notch
    await page.mouse.down(); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.__calls.filter(c => c[0] === 'activate_control').at(-1)[1]), { control: 'alerts' });
    await page.evaluate(() => { window.__gooSeen = false; const f = () => { if (detailPath.getAttribute('filter')) window.__gooSeen = true; if (detailOpen < .999) requestAnimationFrame(f); }; requestAnimationFrame(f); __emit('control_pressed', 'alerts'); });
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => card.classList.contains('show') && card.dataset.account), '__alerts');
    assert.ok(await page.evaluate(() => window.__gooSeen), 'liquid while it grows');
    assert.equal(await page.evaluate(() => detailPath.getAttribute('filter')), null, 'sharp once open');
    assert.equal(await page.locator('.compact-account').count(), 0, 'the log is about every account, so no ring recedes');
    assert.ok(await page.evaluate(() => Math.abs(card.getBoundingClientRect().top - (pill.getBoundingClientRect().top - 12)) < 2), 'it grows from the pocket end');
    assert.ok(await page.evaluate(() => +getComputedStyle(pinHandle).getPropertyValue('--disc-glyph') < .05), 'the bell melts into the widened flare');
    assert.deepEqual(await page.locator('#card .a-name').allInnerTexts(), ['Claude', 'Codex', 'Codex']);
    assert.equal(await page.locator('#card .a-when').last().innerText(), 'yesterday');
    assert.deepEqual(await page.locator('#card .a-chip.on').allInnerTexts(), ['Usage', 'Waiting']);
    // The switches are drops of ink: the two that are on run together through a neck; the one that is off is an empty well
    const ink = () => page.evaluate(() => ({ drops: (card.querySelector('.a-chips .a-drop:not(.a-neck)').getAttribute('d').match(/M/g) || []).length,
      neck: !!card.querySelector('.a-chips .a-neck').getAttribute('d'), wells: (card.querySelector('.a-chips .a-well').getAttribute('d').match(/M/g) || []).length,
      inks: [...card.querySelectorAll('.a-chip')].map(b => +getComputedStyle(b).getPropertyValue('--ink')) }));
    assert.deepEqual(await ink(), { drops: 2, neck: true, wells: 3, inks: [1, 1, 0] });
    assert.equal(await page.evaluate(() => getComputedStyle(card.querySelector('.a-chip')).mixBlendMode), 'difference', 'words invert where the ink is');
    // Sound is its own drop in the title row, not one of the alert kinds
    assert.deepEqual(await page.evaluate(() => [card.querySelectorAll('.a-chips .a-chip').length, !!card.querySelector('.c-head .a-sound[data-pref="sound"][aria-pressed="false"]')]), [3, true]);
    // One bead of ink lies under the row the pointer is on and runs to the next one
    const rowBox = await page.locator('#card .a-row').nth(1).boundingBox();
    await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2); await page.waitForTimeout(700);
    const bead = await page.evaluate(() => { const b = card.querySelector('.a-bead').getBoundingClientRect(), r = card.querySelectorAll('.a-row')[1].getBoundingClientRect(); return [Math.round(b.top - r.top), Math.round(b.height - r.height), getComputedStyle(card.querySelector('.a-bead')).opacity]; });
    assert.deepEqual(bead, [0, 0, '1'], 'the bead settles exactly under the row');
    await page.mouse.move(pocket.x, pocket.y); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => getComputedStyle(card.querySelector('.a-bead')).opacity), '0', 'and drains away off the list');
    await page.screenshot({ path: path.join(OUT, 'log.png') });
    // Held over the pocket, the log stays; seen, it is marked read and the dot goes
    await page.mouse.move(pocket.x + 2, pocket.y + 1); await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => card.classList.contains('show')), true);
    assert.ok(await page.evaluate(() => window.__calls.some(c => c[0] === 'mark_alerts_read')));
    assert.equal(await page.evaluate(() => pinHandle.classList.contains('unread')), false);
    assert.equal(await page.locator('#card .log-content.entering').count(), 0, 'a refresh while open does not replay the entrance');

    // A switch changes the alert preference it names; its drop wells up and reaches the one beside it
    await page.locator('#card .a-chip', { hasText: 'Finished' }).click(); await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.__calls.filter(c => c[0] === 'set_alert_preferences').at(-1)[1]), { completion: true });
    await page.waitForTimeout(900);
    assert.deepEqual(await ink(), { drops: 3, neck: true, wells: 3, inks: [1, 1, 1] });
    assert.equal(await page.evaluate(() => (card.querySelector('.a-chips .a-neck').getAttribute('d').match(/M/g) || []).length), 2, 'three on in a row are one body');
    // Turned off, the middle one draws in and parts from both neighbours, and the goo is gone once it is still
    await page.evaluate(() => { window.__parted = 0; window.__gooed = false; const t0 = performance.now(); const f = () => { const d = card.querySelector('.a-chips .a-neck')?.getAttribute('d') || ''; __parted = Math.max(__parted, 2 - (d.match(/M/g) || []).length); if (card.querySelector('.a-chips .a-drops')?.getAttribute('filter')) __gooed = true; if (performance.now() - t0 < 900) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    // Each neck only narrows and then parts once (never a thread, never joining again mid-way)
    await page.evaluate(() => { window.__necks = []; window.__thinnest = Infinity; const t0 = performance.now(); const f = () => {
      __necks.push((card.querySelector('.a-chips .a-neck')?.getAttribute('d')?.match(/M/g) || []).length);
      for (const st of Object.values(neckState)) if (st.joined && st.last) __thinnest = Math.min(__thinnest, st.last.waist / card.querySelector('.a-chip').offsetHeight);
      if (performance.now() - t0 < 900) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.locator('#card .a-chip', { hasText: 'Waiting' }).click(); await page.waitForTimeout(1400); // stretch, pinch, part and settle
    assert.deepEqual(await page.evaluate(() => [__parted, __gooed, card.querySelector('.a-chips .a-drops').getAttribute('filter')]), [2, true, null]);
    const necks = await page.evaluate(() => __necks);
    assert.ok(necks.every((count, i) => !i || count <= necks[i - 1]), 'parted necks stay parted: ' + necks.join(''));
    assert.ok(necks.filter(count => count === 2).length > 6, 'the necks stretch for a while before they give');
    assert.ok(await page.evaluate(() => __thinnest) >= .19, 'a neck parts with body left, never as a thread');
    assert.deepEqual((await ink()).inks, [1, 0, 1]);
    await page.locator('#card .a-chip', { hasText: 'Waiting' }).click(); await page.waitForTimeout(900);
    await page.locator('#card .a-sound').click(); await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => [window.__calls.filter(c => c[0] === 'set_alert_preferences').at(-1)[1], card.querySelector('.a-sound').getAttribute('aria-pressed')]), [{ sound: true }, 'true']);
    await page.locator('#card .a-sound').click(); await page.waitForTimeout(100);
    // An alert that arrives while the log is open lands in it rather than opening over it
    await page.evaluate(() => {
      const e = { id: 'd', at: Date.now(), kind: 'waiting', account: 'claude', window: null, level: null, used: null, session: 'homelab', title: '', body: '', read: false };
      __emit('alert', { events: [e], sound: true, hold: 1000 }); __emit('alert_log', [...alertLogData, e]);
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => slivers.size), 0, 'no sliver over the open log');
    assert.equal(await page.evaluate(() => window.__chimes), 1, 'still heard');
    assert.equal(await page.locator('#card .a-row').first().locator('.a-word').innerText(), 'Needs you');
    // A row turns into that account's usage
    await page.locator('#card .a-row', { hasText: 'Usage warning' }).click(); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => card.dataset.account), 'claude');
    assert.equal(await page.locator('#card .w-pct').innerText(), '83%');
    // A linked log row uses the same session-opening action as a notification.
    await page.evaluate(() => { openAlertLog(); __emit('alert_log', [{ id: 'linked', at: Date.now(), kind: 'completion', account: 'claude', session: 'homelab', target: { provider: 'claude', sessionId: '12345678-1234-5678-abcd-123456789012' } }]); });
    await page.locator('#card .a-row').click();
    assert.deepEqual(await page.evaluate(() => __calls.filter(c => c[0] === 'open_alert_session').at(-1)), ['open_alert_session', { id: 'linked' }]);
    // A legacy row that cannot be restored explains the missing link instead of silently doing nothing.
    await page.evaluate(()=>{openAlertLog();__emit('alert_log',[{id:'legacy',at:Date.now(),kind:'completion',account:'codex',session:'homelab'}]);});
    await page.locator('#card .a-row').click();
    assert.match(await page.locator('.session-link-error').innerText(),/could not be matched uniquely/);
    await page.evaluate(()=>renderCard());
    assert.match(await page.locator('.session-link-error').innerText(),/could not be matched uniquely/);
    // The account's Working text is a button for that session, including keyboard activation.
    await page.evaluate(()=>{hideCard();__emit('activity',[{id:'rollout-live',sessionId:'12345678-1234-5678-abcd-123456789012',provider:'codex',account:'codex',state:'busy',name:'homelab',detail:'Working',since:Date.now()}]);holdCard('codex');});
    await page.locator('.session-link').click();
    assert.deepEqual(await page.evaluate(()=>__calls.filter(c=>c[0]==='open_working_session').at(-1)),['open_working_session',{id:'rollout-live',account:'codex'}]);
    await page.evaluate(()=>holdCard('codex'));
    await page.locator('.session-link').focus();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='open_working_session').length),2);
    // Clear empties it
    await page.evaluate(() => openAlertLog()); await page.waitForTimeout(300);
    // Clear draws the rows up into the title row before the log is emptied
    await page.locator('#card .a-clear').click(); await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => window.__calls.some(c => c[0] === 'clear_alert_log')), false, 'still draining');
    assert.ok(await page.evaluate(() => card.querySelector('.a-row').getAnimations().length > 0));
    await page.waitForTimeout(400);
    assert.equal(await page.locator('#card .a-empty').innerText(), 'No alerts this week');
    await page.mouse.move(640, 400); await page.waitForTimeout(1300);

    // Scrolling the other way brings the pin back, and a press is a pin press again
    await page.mouse.move(pocket.x, pocket.y); await page.waitForTimeout(700);
    await page.mouse.wheel(0, -100); await page.waitForTimeout(2000);
    assert.equal(await page.evaluate(() => leadFace()), 'pin');
    await page.mouse.down(); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => window.__calls.filter(c => c[0] === 'activate_control').at(-1)[1]), { control: 'pin' });
    await page.mouse.move(640, 400); await page.waitForTimeout(600);

    // Something new with the pin showing: the pocket's dot pops back
    await page.evaluate(() => __emit('alert_log', [{ id: 'e', at: Date.now(), kind: 'quota', account: 'codex', window: 'primary', level: 80, used: .81, session: null, title: '', body: '', read: false }]));
    await page.waitForTimeout(60);
    assert.ok(await page.evaluate(() => pinHandle.classList.contains('unread') && document.getElementById('notch-dot').getAnimations().length > 0));

    // Scroll, then leave before the swap is done: the new glyph still arrives and swings on its drop, and only then
    // does the drop melt back into an arm (it used to hang there blank, then pop into the arm in one frame)
    await page.mouse.move(pocket.x, pocket.y); await page.waitForTimeout(800);
    await page.evaluate(() => { window.__leave = []; const t0 = performance.now(); const f = () => { const h = handles[0], g = pinHandle.querySelector(pinHandle.classList.contains('face-alerts') ? '.h-glyph.bell' : '.h-glyph.pin');
      __leave.push({ value: h.value, swapping: h.swapping, glyph: +getComputedStyle(g).opacity, width: +(armStart.getAttribute('stroke-width') || 0) }); if (performance.now() - t0 < 2600) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.mouse.wheel(0, 100); await page.waitForTimeout(120);
    await page.mouse.move(640, 400); await page.waitForTimeout(2700);
    const leave = await page.evaluate(() => __leave), swapping = leave.filter(s => s.swapping);
    assert.ok(swapping.length > 20 && swapping.every(s => s.value > .95), 'the drop stays out through the whole swap: ' + JSON.stringify(swapping.map(s => +s.value.toFixed(2))));
    assert.ok(swapping.at(-1).glyph > .95, 'with its new glyph showing when the swap ends');
    const after = leave.slice(leave.indexOf(swapping.at(-1)) + 1);
    assert.ok(after.at(-1).value === 0 && Math.max(...after.map((s, i) => i ? s.width - after[i - 1].width : 0).map(Math.abs)) < 8, 'then melts back into the arm, never in one jump');
    await page.mouse.wheel(0, 0);
    await page.mouse.move(pocket.x, pocket.y); await page.waitForTimeout(700); await page.mouse.wheel(0, 100); await page.waitForTimeout(1800);
    await page.mouse.move(640, 400); await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => leadFace()), 'pin');

    // Settings decide what the pocket holds: one thing means nothing to scroll through
    await page.evaluate(() => __emit('notch_buttons', { pin: false, alerts: true })); await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => [leadFaces, leadFace(), showPin]), [['alerts'], 'alerts', true]);
    await page.mouse.move(pocket.x, pocket.y); await page.waitForTimeout(700);
    await page.mouse.wheel(0, 100); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => handles[0].swapping), false);
    await page.evaluate(() => __emit('notch_buttons', { pin: false, alerts: false })); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => showPin), false, 'nothing to hold, no pocket');
    await page.evaluate(() => __emit('notch_buttons', { pin: true, alerts: true })); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => leadFace()), 'pin');
    // Every edge: compact width, centered on flat edges, top aligned on side edges, no horizontal overflow.
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      await page.evaluate(edge => { hideCard(); __emit('alert_log',Array.from({length:40},(_,i)=>({id:'history-'+i,at:Date.now()-i*60000,kind:'completion',account:'codex',session:'homelab',took:60000,read:true}))); __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge, along: .5, visible: true, tracking: false, pinned: true }); openAlertLog(); }, edge);
      await page.waitForTimeout(700);
      const geometry = await page.evaluate(() => { const r = pill.getBoundingClientRect(), c = card.getBoundingClientRect(); return { r: { x: r.x, y: r.y, w: r.width }, c: { x: c.x, y: c.y, w: c.width }, overflow: card.scrollWidth > card.clientWidth }; });
      assert.equal(geometry.overflow, false);
      const tops=await page.locator('.a-chip').evaluateAll(bs=>bs.map(b=>b.getBoundingClientRect().top));
      assert.ok(Math.max(...tops)-Math.min(...tops)<1,'all four switches stay in one row');
      if (edge === 'top' || edge === 'bottom') {
        assert.ok(geometry.c.w>=geometry.r.w&&geometry.c.w<300, 'uses the notch width where readable: ' + JSON.stringify(geometry));
        assert.ok(Math.abs(geometry.c.x + geometry.c.w / 2 - geometry.r.x - geometry.r.w / 2) < 2, 'centers on the notch: ' + JSON.stringify(geometry));
      } else {
        assert.ok(geometry.c.w>=228&&geometry.c.w<300);
        assert.ok(Math.abs(geometry.c.y - geometry.r.y + 12) < 2, 'preserves top alignment');
      }
      assert.equal(await page.locator('[title], svg title').count(), 0, 'tooltips removed, including generated controls');
      assert.equal(await page.locator('.a-row').count(),40,'the entire retained history remains reachable');
      const history=await page.locator('.a-log').boundingBox();assert.ok(history.height<=228.5,'history stops at the default notch length: '+JSON.stringify(history)+edge);
      const titleTop=await page.locator('.c-head').evaluate(e=>e.getBoundingClientRect().top);
      await page.mouse.move(history.x+history.width/2,history.y+history.height/2);
      await page.mouse.wheel(0,400);
      await page.waitForFunction(()=>document.querySelector('.a-log').scrollTop>0);
      // Wheel scrolling animates: read the position once it has come to rest
      await page.waitForFunction(()=>new Promise(done=>{const a=document.querySelector('.a-log').scrollTop;setTimeout(()=>done(document.querySelector('.a-log').scrollTop===a),150);}));
      assert.ok(Math.abs(await page.locator('.c-head').evaluate(e=>e.getBoundingClientRect().top)-titleTop)<1,'title stays still while history scrolls');
      const scroll=await page.locator('.a-log').evaluate(e=>e.scrollTop);
      await page.evaluate(()=>renderCard());
      assert.equal(await page.locator('.a-log').evaluate(e=>e.scrollTop),scroll,'refresh preserves history scroll');
      // The always-black notch keeps its narrow transparent scrollbar in both app themes.
      for(const theme of ['dark','light']){
        await page.evaluate(theme=>__emit('theme_resolved',theme),theme);
        const scrollbar=await page.locator('.a-log').evaluate(e=>({width:getComputedStyle(e,'::-webkit-scrollbar').width,
          track:getComputedStyle(e,'::-webkit-scrollbar-track').backgroundColor,thumb:getComputedStyle(e,'::-webkit-scrollbar-thumb').backgroundColor}));
        assert.equal(scrollbar.width,'6px');assert.equal(scrollbar.track,'rgba(0, 0, 0, 0)');
        assert.ok(['rgb(76, 76, 80)','rgb(112, 112, 117)'].includes(scrollbar.thumb),'dark thumb with hover feedback in '+theme+' theme');
      }
      await page.screenshot({ path: path.join(OUT, 'log-' + edge + '.png') });
    }
    assert.deepEqual(errors, []);
    console.log('Passed: pocket holds pin and log, scroll swaps with one swap at a time, a swap left mid-way finishes then melts home, press follows the face, log grows liquid from the pocket end, read on sight, ink switches join and part, sound drop, row bead, alert into an open log, row to usage, clear drains, scroll back, unread dot, settings choose the faces.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
