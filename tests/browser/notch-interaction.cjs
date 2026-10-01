// Peek on hover, hold on click. Real browser, stubbed bridge.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path');
const UI = path.resolve(__dirname, '../../desktop/ui');
const OUT = process.argv[2] || '/tmp/agent-usage-interaction';
fs.mkdirSync(OUT, { recursive: true });
const now = Date.now();
const win = (id, label, used, h) => ({ id, label, used, resets_at: now + h * 3600e3, count: null, derived: false });
const account = (id, base, name, used) => ({ id, base, name, glyph: 'C', snap: { status: 'ok', windows: [win(base === 'claude' ? 'session' : 'primary', '5 hours', used, 2)], fetched_at: now, note: '', details: [] } });
const accounts = [account('a', 'codex', 'Codex A', .42), account('b', 'codex', 'Codex B', .07), account('c', 'claude', 'Claude', .83)];
const glyphs = {};
for (const p of ['claude', 'codex', 'gemini']) glyphs[p] = { kind: 'svg', svg: fs.readFileSync(path.join(UI, 'glyphs', p + '.svg'), 'utf8') };
const answers = {
  get_agent_accounts: accounts, get_glyphs: glyphs, get_ui_flags: { notch_visible: true, notch_on_hover: true, tray_visible: false },
  get_notch_edge: 'right', get_state: { sessions: [], agg: 'idle', counts: {}, lang_resolved: 'en', clock_24h: false },
  get_weekly_ring: 'off', get_color_transition: 'hard_step', get_theme_resolved: 'dark', get_update_state: { status: 'current' },
  get_notch_slots: [], get_activity: [], get_antigravity_prefs: { limit: 'automatic', model: 'gemini' }, get_notch_buttons: { pin: true, alerts: true },
  get_alert_preferences: { quota: true, waiting: true, completion: false, sound: false, muted: [] }, get_alert_log: [],
};
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({ answers }) => {
      const listeners = {}; window.__calls = [];
      window.agentUsage = { invoke: (c, a = {}) => { window.__calls.push([c, a]); return Promise.resolve(c in answers ? answers[c] : null); },
        on: (n, cb) => { (listeners[n] = listeners[n] || []).push(cb); return () => {}; } };
      window.__emit = (n, p) => (listeners[n] || []).forEach(cb => cb(p));
    }, { answers });
    await page.goto('file://' + UI + '/notch.html');
    await page.waitForTimeout(300);
    await page.evaluate(() => { __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge: 'right', along: .5, visible: true, tracking: false, pinned: false }); __emit('appear', { edge: 'right' }); });
    await page.waitForTimeout(1200);
    const ring = async id => { const b = await page.locator(`.cell[data-p="${id}"] .ringwrap`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const open = () => page.evaluate(() => card.classList.contains('show') ? card.dataset.account : null);
    const [A, B, C] = [await ring('a'), await ring('b'), await ring('c')];
    const refreshes = () => page.evaluate(() => window.__calls.filter(c => c[0] === 'refresh_ring').length);
    assert.equal(await page.evaluate(() => pinHandle.getAttribute('aria-label')), 'Keep on screen', 'the pin says what it does (no native tooltips since 3.2.4)');

    // A pointer sweeping across the rings opens nothing; one at rest peeks
    await page.mouse.move(A.x - 20, A.y - 30);
    for (let t = 0; t <= 1; t += .1) { await page.mouse.move(A.x, A.y + (C.y - A.y) * t); await page.waitForTimeout(35); }
    assert.equal(await open(), null, 'passing over the rings is not asking to see them');
    await page.waitForTimeout(60);
    assert.equal(await open(), null, 'not before the pointer has rested');
    await page.waitForTimeout(200);
    assert.equal(await open(), 'c', 'at rest, it peeks');
    assert.equal(await page.evaluate(() => cardHeld), false);
    assert.equal(await page.evaluate(() => JSON.parse(lastHot).expanded), true, 'main is told a card is open, so the notch waits for it');

    // Peeking, a ring crossed on the way does not take over; one rested on does
    for (let t = 0; t <= 1; t += .2) { await page.mouse.move(C.x, C.y + (A.y - C.y) * t); await page.waitForTimeout(30); }
    await page.mouse.move(A.x - 60, A.y); await page.waitForTimeout(30);
    assert.equal(await open(), 'c', 'Codex A and B were only passed over');
    await page.mouse.move(B.x, B.y); await page.waitForTimeout(250);
    assert.equal(await open(), 'b', 'resting on Codex B swaps to it');

    // A peek goes a moment after the pointer leaves
    await page.mouse.move(400, 400); await page.waitForTimeout(150);
    assert.equal(await open(), 'b', 'a short grace');
    await page.waitForTimeout(450);
    assert.equal(await open(), null, 'then it closes');
    await page.waitForTimeout(900);

    // Main's own cursor check closes a peek even when this page is sent no move at all
    await page.mouse.move(A.x, A.y); await page.waitForTimeout(300);
    assert.equal(await open(), 'a');
    await page.evaluate(() => __emit('notch_pointer', false)); await page.waitForTimeout(500);
    assert.equal(await open(), null, 'no forwarded move needed');
    await page.waitForTimeout(900);

    // A click holds: no refresh, rings passed over and rested on leave it be, and it outlasts a short absence
    const before = await refreshes();
    await page.mouse.move(C.x, C.y); await page.waitForTimeout(250); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => [card.dataset.account, cardHeld, card.classList.contains('held')]), ['c', true, true]);
    assert.equal(await refreshes(), before, 'a ring click is not a refresh any more');
    await page.mouse.move(A.x, A.y); await page.waitForTimeout(400);
    assert.equal(await open(), 'c', 'held: resting on another ring does not take it');
    await page.mouse.move(400, 400); await page.waitForTimeout(900);
    assert.equal(await open(), 'c', 'held through a short absence');
    await page.waitForTimeout(900);
    assert.equal(await open(), null, 'but not forever while the notch can hide');
    await page.waitForTimeout(900);

    // Kept on screen, a held card stays until put away: by a press elsewhere, or by its own ring again
    await page.evaluate(() => __emit('ui_flags', { notch_visible: true, notch_on_hover: false, tray_visible: false }));
    assert.equal(await page.evaluate(() => pinHandle.getAttribute('aria-label')), 'Let it hide');
    await page.mouse.move(A.x, A.y); await page.waitForTimeout(250); await page.mouse.down(); await page.mouse.up();
    await page.mouse.move(400, 400); await page.waitForTimeout(2200);
    assert.equal(await open(), 'a', 'kept on screen, it stays');
    await page.evaluate(() => __emit('outside_press')); await page.waitForTimeout(100);
    assert.equal(await open(), null, 'a press outside puts it away');
    await page.waitForTimeout(900);
    await page.mouse.move(B.x, B.y); await page.waitForTimeout(250); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(100);
    assert.equal(await open(), 'b');
    await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(100);
    assert.equal(await open(), null, 'its own ring again puts it away');
    await page.evaluate(() => __emit('ui_flags', { notch_visible: true, notch_on_hover: true, tray_visible: false }));
    await page.waitForTimeout(900);

    // Refresh is the card's own button: the ring presses in and the button turns
    await page.mouse.move(C.x, C.y); await page.waitForTimeout(300);
    const r0 = await refreshes();
    await page.locator('#card .c-refresh').click(); await page.waitForTimeout(60);
    assert.equal(await refreshes(), r0 + 1);
    assert.ok(await page.evaluate(() => card.querySelector('.c-refresh').classList.contains('spinning') && !!refreshing.c));
    assert.equal(await page.evaluate(() => cardHeld), true, 'using the card holds it');
    await page.evaluate(() => __emit('outside_press')); await page.waitForTimeout(900);

    // The bell's log, opened by a press, is held: resting on a ring on the way does not replace it
    await page.evaluate(() => { leadIndex = 1; renderLead(); __emit('control_pressed', 'alerts'); }); await page.waitForTimeout(700);
    assert.deepEqual(await page.evaluate(() => [card.dataset.account, cardHeld]), ['__alerts', true]);
    await page.mouse.move(A.x, A.y); await page.waitForTimeout(400);
    assert.equal(await open(), '__alerts', 'the log stays while the pointer crosses the rings to reach it');
    await page.evaluate(() => __emit('control_pressed', 'alerts')); await page.waitForTimeout(100);
    assert.equal(await open(), null, 'pressing the bell again puts it away');
    await page.screenshot({ path: path.join(OUT, 'interaction.png') });
    assert.deepEqual(errors, []);
    console.log('Passed: sweeping opens nothing, rest to peek and to switch, peek grace, main closes a peek, click holds without refresh, held ignores rings and short absence, kept on screen stays, outside press and own ring put it away, card refresh, held log.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
