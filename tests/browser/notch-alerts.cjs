// Alerts open out of the notch instead of as Windows toasts. Real browser, stubbed bridge.
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
  { id: 'claude', base: 'claude', name: 'Claude', glyph: 'C', snap: { status: 'ok', windows: [win('session', '5 hours', .83, 3), win('seven_day', 'Weekly', .29, 90)], fetched_at: now, note: '', details: [], resets: { count: 1, expires: now + 20 * 86400e3 } } },
];
const glyphs = {};
for (const p of ['claude', 'codex', 'gemini']) glyphs[p] = { kind: 'svg', svg: fs.readFileSync(path.join(UI, 'glyphs', p + '.svg'), 'utf8') };
const answers = {
  get_agent_accounts: accounts, get_glyphs: glyphs, get_ui_flags: { notch_visible: false, notch_on_hover: true, tray_visible: false },
  get_notch_edge: 'right', get_state: { sessions: [], agg: 'idle', counts: {}, lang_resolved: 'en', clock_24h: false },
  get_weekly_ring: 'off', get_color_transition: 'hard_step', get_theme_resolved: 'dark', get_update_state: { status: 'current' },
  get_notch_slots: [], get_activity: [], get_antigravity_prefs: { limit: 'automatic', model: 'gemini' }, get_notch_buttons: { pin: true },
};
const quota = { kind: 'quota', account: 'claude', window: 'session', level: 80, title: 'Claude usage warning', body: '5 hours: 83% used.' };
async function open(browser, reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ answers }) => {
    const listeners = {};
    window.agentUsage = { invoke: c => Promise.resolve(c in answers ? answers[c] : null), on: (n, cb) => { (listeners[n] = listeners[n] || []).push(cb); return () => {}; } };
    window.__emit = (n, p) => (listeners[n] || []).forEach(cb => cb(p));
    window.__chimes = 0; // count the chime without needing an audio device
    window.AudioContext = class { constructor() { window.__chimes++; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
      createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
      createOscillator() { return { frequency: {}, connect() {}, start() {}, stop() {} }; } resume() {} };
  }, { answers });
  await page.goto('file://' + UI + '/notch.html');
  await page.waitForTimeout(300);
  return { page, errors };
}
// What main does for an alert while the notch is hidden: lay it out where it rested, bring it in, then send the alert
const arrive = (page, payload) => page.evaluate(payload => {
  __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge: 'right', along: .5, visible: true, tracking: false, pinned: false });
  __emit('appear', { edge: 'right' }); __emit('alert', payload);
}, payload);
(async () => {
  const browser = await chromium.launch();
  try {
    const { page, errors } = await open(browser);
    await arrive(page, { events: [quota], sound: true, hold: 2500 });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => card.classList.contains('show')), false, 'waits for the notch to finish arriving');
    await page.waitForTimeout(1100);
    assert.equal(await page.evaluate(() => alertShowing && card.classList.contains('show') && detailTarget), 1, 'opens as the notch lobe');
    assert.equal(await page.evaluate(() => pill.querySelector('.focused-account').dataset.p), 'claude', 'from the account ring it is about');
    assert.equal(await page.locator('#card .a-kick').innerText(), 'Usage warning');
    assert.equal(await page.locator('#card .w-pct').innerText(), '83%');
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => JSON.parse(lastHot).alerting), true, 'main is told to keep the notch out');
    assert.equal(await page.evaluate(() => window.__chimes), 1, 'sound on plays the chime');
    const lobe = await page.locator('#card').boundingBox(), ring = await page.locator('.cell[data-p="claude"] .ringwrap').boundingBox();
    assert.ok(lobe.y <= ring.y + ring.height / 2 && lobe.y + lobe.height >= ring.y + ring.height / 2, 'its words sit beside their ring');
    await page.screenshot({ path: path.join(OUT, 'alert.png') });
    // The overlay forwards every pointer move on the screen; those elsewhere must not dismiss it
    for (let i = 0; i < 6; i++) { await page.mouse.move(100 + i * 60, 600 - i * 40); await page.waitForTimeout(60); }
    assert.ok(await page.evaluate(() => !!alertShowing), 'pointer elsewhere leaves it open');
    await page.waitForTimeout(2300);
    assert.equal(await page.evaluate(() => alertShowing), null, 'closes once read');
    await page.waitForTimeout(50);
    assert.equal(await page.evaluate(() => JSON.parse(lastHot).alerting), false, 'and told when it is done');
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => card.classList.contains('show')), false);

    // Under the pointer it holds past its time, then leaves shortly after the pointer does
    await page.evaluate(q => __emit('alert', { events: [q], sound: false, hold: 1500 }), quota);
    await page.waitForTimeout(800);
    const box = await page.locator('#card .c-title').boundingBox();
    await page.mouse.move(box.x + 4, box.y + 4); await page.waitForTimeout(2200);
    assert.ok(await page.evaluate(() => !!alertShowing && alertHeld), 'held while read');
    assert.equal(await page.evaluate(() => window.__chimes), 1, 'sound off stays silent');
    // A click turns it into that account's usage
    await page.mouse.click(box.x + 4, box.y + 4); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => alertShowing), null);
    assert.equal(await page.locator('#card .a-kick').count(), 0);
    assert.match(await page.locator('#card .c-resets').innerText(), /1 reset available/);
    await page.mouse.move(640, 400); await page.waitForTimeout(1200);

    // Queued alerts wait for the usage card and for each other
    const codexRing = await page.locator('.cell[data-p="codex"] .ringwrap').boundingBox();
    await page.mouse.move(codexRing.x + 20, codexRing.y + 20); await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => card.dataset.account), 'codex');
    await page.evaluate(q => {
      __emit('alert', { events: [{ kind: 'waiting', account: 'codex', session: 'agent-usage', body: 'Approve running npm test?' }], sound: false, hold: 700 });
      __emit('alert', { events: [q, { kind: 'completion', account: 'codex', session: 'homelab' }], sound: false, hold: 700 });
    }, quota);
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => alertShowing), null, 'does not take over a card being read');
    await page.mouse.move(640, 400); await page.waitForTimeout(1300);
    assert.equal(await page.locator('#card .a-kick').innerText(), 'Needs you');
    assert.equal(await page.locator('#card .a-sub').innerText(), 'Approve running npm test?');
    await page.waitForTimeout(1700);
    assert.equal(await page.locator('#card .a-block').count(), 2, 'the next one follows, stacked');
    await page.screenshot({ path: path.join(OUT, 'alert-stack.png') });
    assert.deepEqual(errors, []);
    await page.close();

    const reduced = await open(browser, 'reduce');
    await arrive(reduced.page, { events: [quota], sound: false, hold: 2000 });
    await reduced.page.waitForTimeout(700);
    assert.equal(await reduced.page.evaluate(() => detailOpen), 1, 'reduced motion opens at once');
    assert.deepEqual(reduced.errors, []);
    console.log('Passed: alert waits for arrival, opens from its ring, survives pointer elsewhere, holds under the pointer, click to usage, queue behind the card, chime on/off, reduced motion.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
