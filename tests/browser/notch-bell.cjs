// The bell at the end of the rings keeps the alert log. Real browser, stubbed bridge that answers like main.
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
          return Promise.resolve(c in answers ? answers[c] : null);
        },
        on: (n, cb) => { (listeners[n] = listeners[n] || []).push(cb); return () => {}; },
      };
      window.__emit = (n, p) => (listeners[n] || []).forEach(cb => cb(p));
      window.AudioContext = class { constructor() { window.__chimes = (window.__chimes || 0) + 1; this.state = 'running'; this.currentTime = 0; this.destination = {}; }
        createGain() { return { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; }
        createOscillator() { return { frequency: {}, connect() {}, start() {}, stop() {} }; } resume() {} };
    }, { answers });
    await page.goto('file://' + UI + '/notch.html');
    await page.waitForTimeout(300);
    await page.evaluate(() => { __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge: 'right', along: .5, visible: true, tracking: false, pinned: false }); __emit('appear', { edge: 'right' }); });
    await page.waitForTimeout(1200);

    // At rest: a cell after the rings, with a dot and the count of what is new
    assert.deepEqual(await page.evaluate(() => [...pill.querySelectorAll('.cell')].map(c => c.dataset.p)), ['codex', 'claude', '__alerts']);
    assert.equal(await page.locator('.alerts-cell .pct').innerText(), '2');
    assert.ok(await page.locator('.alerts-cell').evaluate(c => c.classList.contains('unread')));
    await page.screenshot({ path: path.join(OUT, 'bell-rest.png') });

    // A click on the bell is not a ring click: nothing refreshes
    const bell = await page.locator('.alerts-cell .ringwrap').boundingBox();
    await page.mouse.click(bell.x + bell.width / 2, bell.y + bell.height / 2); await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__calls.filter(c => c[0] === 'refresh_ring').length), 0);

    // Pointing at it opens the log in the notch's own lobe, newest first, with the switches along the top
    assert.equal(await page.evaluate(() => card.classList.contains('show') && card.dataset.account), '__alerts');
    assert.equal(await page.evaluate(() => detailTarget), 1, 'the same gooey lobe as an account');
    assert.deepEqual(await page.locator('#card .a-name').allInnerTexts(), ['Claude', 'Codex', 'Codex']);
    assert.deepEqual(await page.locator('#card .a-word').allInnerTexts(), ['Usage warning', 'Needs you', 'Finished']);
    assert.equal(await page.locator('#card .a-when').last().innerText(), 'yesterday');
    assert.equal(await page.locator('#card .a-row.fresh').count(), 2);
    assert.deepEqual(await page.locator('#card .a-chip.on').allInnerTexts(), ['Usage', 'Waiting']);
    assert.equal(await page.evaluate(() => pill.querySelector('.focused-account')?.dataset.p), '__alerts', 'the rings recede around the bell');
    await page.screenshot({ path: path.join(OUT, 'bell-log.png') });
    // Seen: marked read after a moment, and the bell's count and dot go
    await page.waitForTimeout(1500);
    assert.ok(await page.evaluate(() => window.__calls.some(c => c[0] === 'mark_alerts_read')));
    assert.equal(await page.locator('#card .a-row.fresh').count(), 0);
    assert.equal(await page.locator('.alerts-cell .pct').innerText(), '');
    assert.equal(await page.locator('#card .log-content.entering').count(), 0, 'a refresh while open does not replay the entrance');

    // A switch changes the alert preference it names
    await page.locator('#card .a-chip', { hasText: 'Finished' }).click(); await page.waitForTimeout(100);
    assert.deepEqual(await page.evaluate(() => window.__calls.filter(c => c[0] === 'set_alert_preferences').at(-1)[1]), { completion: true });
    assert.deepEqual(await page.locator('#card .a-chip.on').allInnerTexts(), ['Usage', 'Waiting', 'Finished']);

    // An alert that arrives while the log is open lands in it rather than opening over it
    await page.evaluate(() => {
      const e = { id: 'd', at: Date.now(), kind: 'waiting', account: 'claude', window: null, level: null, used: null, session: 'homelab', title: '', body: '', read: false };
      __emit('alert', { events: [e], sound: true, hold: 1000 }); __emit('alert_log', [...alertLogData, e]);
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => alertShowing), null);
    assert.equal(await page.evaluate(() => window.__chimes), 1, 'still heard');
    assert.equal(await page.locator('#card .a-row').first().locator('.a-word').innerText(), 'Needs you');

    // A row turns into that account's usage
    await page.locator('#card .a-row', { hasText: 'Usage warning' }).click(); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => card.dataset.account), 'claude');
    assert.equal(await page.locator('#card .w-pct').innerText(), '83%');

    // Clear empties it
    await page.mouse.move(bell.x + bell.width / 2, bell.y + bell.height / 2); await page.waitForTimeout(400);
    await page.locator('#card .a-clear').click(); await page.waitForTimeout(200);
    assert.equal(await page.locator('#card .a-row').count(), 0);
    assert.equal(await page.locator('#card .a-empty').innerText(), 'No alerts this week');
    await page.mouse.move(640, 400); await page.waitForTimeout(1200);

    // A new alert, the notch idle: the bell swings and its count ticks up
    await page.evaluate(() => __emit('alert_log', [{ id: 'e', at: Date.now(), kind: 'quota', account: 'codex', window: 'primary', level: 80, used: .81, session: null, title: '', body: '', read: false }]));
    await page.waitForTimeout(80);
    assert.ok(await page.locator('.alerts-cell .bell-mark').evaluate(m => m.getAnimations().length > 0), 'the bell swings');
    assert.equal(await page.locator('.alerts-cell .pct').innerText(), '1');

    // It rides round a corner with the rings
    const bent = await page.evaluate(() => {
      cancelAnimationFrame(frame); frame = 0; window.agentTracking = true;
      position = target = innerWidth; animate(performance.now());
      return pill.querySelector('.alerts-cell').style.transform;
    });
    assert.match(bent, /translate/, 'carried round the corner like a ring');
    await page.evaluate(() => { window.agentTracking = false; });

    // Settings can take it away
    await page.evaluate(() => __emit('notch_buttons', { pin: true, alerts: false })); await page.waitForTimeout(100);
    assert.equal(await page.locator('.alerts-cell').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Passed: bell count and dot, log in the lobe newest first, read on sight, switches, alert into an open log, row to usage, clear, swing, corner carry, hidden by setting.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
