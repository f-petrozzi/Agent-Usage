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
const log = [
  { id: 'a', at: now - 26 * 3600e3, kind: 'completion', account: 'codex', window: null, level: null, used: null, session: 'homelab', title: '', body: '', read: true },
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
          if (c === 'open_alert_session') return Promise.resolve(true);
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
    await page.screenshot({ path: path.join(OUT, 'log.png') });
    // Held over the pocket, the log stays; seen, it is marked read and the dot goes
    await page.mouse.move(pocket.x + 2, pocket.y + 1); await page.waitForTimeout(600);
    assert.equal(await page.evaluate(() => card.classList.contains('show')), true);
    assert.ok(await page.evaluate(() => window.__calls.some(c => c[0] === 'mark_alerts_read')));
    assert.equal(await page.evaluate(() => pinHandle.classList.contains('unread')), false);
    assert.equal(await page.locator('#card .log-content.entering').count(), 0, 'a refresh while open does not replay the entrance');

    // A switch changes the alert preference it names
    await page.locator('#card .a-chip', { hasText: 'Finished' }).click(); await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.__calls.filter(c => c[0] === 'set_alert_preferences').at(-1)[1]), { completion: true });
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
    // Clear empties it
    await page.evaluate(() => openAlertLog()); await page.waitForTimeout(300);
    await page.locator('#card .a-clear').click(); await page.waitForTimeout(200);
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
      await page.evaluate(edge => { hideCard(); __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge, along: .5, visible: true, tracking: false, pinned: true }); openAlertLog(); }, edge);
      await page.waitForTimeout(700);
      const geometry = await page.evaluate(() => { const r = pill.getBoundingClientRect(), c = card.getBoundingClientRect(); return { r: { x: r.x, y: r.y, w: r.width }, c: { x: c.x, y: c.y, w: c.width }, overflow: card.scrollWidth > card.clientWidth }; });
      assert.equal(geometry.overflow, false);
      if (edge === 'top' || edge === 'bottom') {
        assert.ok(Math.abs(geometry.c.w - Math.max(208, geometry.r.w)) < 2, 'uses the notch width where readable: ' + JSON.stringify(geometry));
        assert.ok(Math.abs(geometry.c.x + geometry.c.w / 2 - geometry.r.x - geometry.r.w / 2) < 2, 'centers on the notch');
      } else {
        assert.equal(geometry.c.w, 228);
        assert.ok(Math.abs(geometry.c.y - geometry.r.y + 12) < 2, 'preserves top alignment');
      }
      assert.equal(await page.locator('[title], svg title').count(), 0, 'tooltips removed, including generated controls');
      await page.screenshot({ path: path.join(OUT, 'log-' + edge + '.png') });
    }
    assert.deepEqual(errors, []);
    console.log('Passed: pocket holds pin and log, scroll swaps with one swap at a time, press follows the face, log grows liquid from the pocket end, read on sight, switches, alert into an open log, row to usage, clear, scroll back, unread dot, settings choose the faces.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
