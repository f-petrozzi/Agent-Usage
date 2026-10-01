// The unread dot rests in the notch's leading front corner; hovering it draws the bell out of that corner as a drop of
// the notch's ink, the dot riding out onto the bell's shoulder, and pressing it opens the log. Real browser, stubbed bridge.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path');
const UI = path.resolve(__dirname, '../../desktop/ui');
const OUT = process.argv[2] || '/tmp/agent-usage-sprout';
fs.mkdirSync(OUT, { recursive: true });
const now = Date.now();
const win = (id, label, used, h) => ({ id, label, used, resets_at: now + h * 3600e3, count: null, derived: false });
const accounts = [
  { id: 'codex', base: 'codex', name: 'Codex', glyph: 'Cx', snap: { status: 'ok', windows: [win('primary', '5 hours', .18, 2)], fetched_at: now, note: '', details: [] } },
  { id: 'claude', base: 'claude', name: 'Claude', glyph: 'C', snap: { status: 'ok', windows: [win('session', '5 hours', .83, 3)], fetched_at: now, note: '', details: [] } },
];
const glyphs = {};
for (const p of ['claude', 'codex', 'gemini']) glyphs[p] = { kind: 'svg', svg: fs.readFileSync(path.join(UI, 'glyphs', p + '.svg'), 'utf8') };
const unread = () => [{ id: 'c' + Math.random(), at: Date.now() - 2 * 60e3, kind: 'quota', account: 'claude', window: 'session', level: 80, used: .83, session: null, title: '', body: '', read: false }];
const answers = {
  get_agent_accounts: accounts, get_glyphs: glyphs, get_ui_flags: { notch_visible: false, notch_on_hover: true, tray_visible: false },
  get_notch_edge: 'right', get_state: { sessions: [], agg: 'idle', counts: {}, lang_resolved: 'en', clock_24h: false },
  get_weekly_ring: 'off', get_color_transition: 'hard_step', get_theme_resolved: 'dark', get_update_state: { status: 'current' },
  get_notch_slots: [], get_activity: [], get_antigravity_prefs: { limit: 'automatic', model: 'gemini' }, get_notch_buttons: { pin: true, alerts: true },
  get_alert_preferences: { quota: true, waiting: true, completion: false, sound: false, muted: [] }, get_alert_log: unread(),
};
const near = (a, b, tolerance = .75) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
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
          if (c === 'mark_alerts_read') { answers.get_alert_log = answers.get_alert_log.map(e => ({ ...e, read: true })); broadcast('alert_log', answers.get_alert_log); return Promise.resolve(answers.get_alert_log); }
          return Promise.resolve(c in answers ? answers[c] : null);
        },
        on: (n, cb) => { (listeners[n] = listeners[n] || []).push(cb); return () => {}; },
      };
      window.__emit = (n, p) => { if (n === 'alert_log') answers.get_alert_log = p; (listeners[n] || []).forEach(cb => cb(p)); };
    }, { answers });
    await page.goto('file://' + UI + '/notch.html');
    await page.waitForTimeout(300);
    const place = async (edge, along = .5) => {
      await page.evaluate(([edge, along]) => { hideCard(); __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge, along, visible: true, tracking: false, pinned: false }); __emit('appear', { edge }); }, [edge, along]);
      await page.mouse.move(640, 400); await page.waitForTimeout(1300);
    };
    const geo = () => page.evaluate(() => ({ ...sprout.geo, value: sprout.value, hovered, dot: (r => [r.left + r.width / 2, r.top + r.height / 2])(document.getElementById('notch-dot').getBoundingClientRect()),
      on: document.getElementById('notch-dot').classList.contains('on'), pill: (r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }))(pill.getBoundingClientRect()) }));
    await place('right');

    // At rest: the dot sits on the bisector of the leading front corner's rounding, away from the screen edge
    let g = await geo();
    assert.equal(g.on, true, 'an unread alert shows the dot');
    assert.ok(near(g.dot, g.P0), 'the dot is where the corner puts it: ' + JSON.stringify([g.dot, g.P0]));
    assert.ok(g.P0[0] < g.pill.left + 20 && g.P0[1] < g.pill.top + 20, 'in the leading front corner, not by the bezel: ' + JSON.stringify(g));
    const rounding = [g.pill.left + 20, g.pill.top + 20];
    assert.ok(Math.abs(Math.hypot(g.P0[0] - rounding[0], g.P0[1] - rounding[1]) - 10) < .5, 'inside the rounding, a dot and a gap in from the curve');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('notch-dot')).transform), 'none', 'round at rest');
    // A pointer on the ring below it is not on the dot
    const ring = await page.locator('.cell[data-p="codex"] .ringwrap').boundingBox();
    await page.mouse.move(ring.x + ring.width / 2, ring.y + ring.height / 2); await page.waitForTimeout(250);
    assert.notEqual(await page.evaluate(() => hovered), 'sprout');
    await page.mouse.move(640, 400); await page.waitForTimeout(500);

    // Hovering the dot: the corner swells and the bell is drawn out on a strand of goo, softening then sharpening,
    // swinging from the snap, with the dot stretched along the way and riding out onto the bell
    await page.evaluate(() => { window.__sprout = { goo: 0, strand: 0, blur: 0, sway: 0, stretch: 0, over: 0 }; const t0 = performance.now(); const f = () => {
      const st = document.getElementById('alert-sprout').style;
      __sprout.goo = Math.max(__sprout.goo, document.querySelector('.sprout-liquid').getAttribute('filter') ? +document.querySelector('#goo-sprout feGaussianBlur').getAttribute('stdDeviation') : 0);
      __sprout.strand = Math.max(__sprout.strand, document.querySelector('.sprout-neck').getAttribute('d') ? 1 : 0);
      __sprout.blur = Math.max(__sprout.blur, +st.getPropertyValue('--glyph-blur') || 0);
      __sprout.sway = Math.max(__sprout.sway, Math.abs(parseFloat(st.getPropertyValue('--sway')) || 0));
      __sprout.stretch = Math.max(__sprout.stretch, document.getElementById('notch-dot').style.transform ? 1 : 0);
      __sprout.over = Math.max(__sprout.over, sprout.value);
      if (performance.now() - t0 < 1300) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.mouse.move(g.P0[0], g.P0[1]); await page.waitForTimeout(1400);
    const motion = await page.evaluate(() => __sprout);
    assert.ok(motion.goo > 4, 'liquid while it is drawn out: ' + JSON.stringify(motion));
    assert.equal(motion.strand, 1, 'on a strand of the notch');
    assert.ok(motion.blur > 1, 'the bell sharpens as it arrives');
    assert.ok(motion.sway > 5, 'and swings from the snap');
    assert.equal(motion.stretch, 1, 'the dot stretches as it travels');
    assert.ok(motion.over > 1.02, 'it pops a little past and settles');
    g = await geo();
    assert.deepEqual([g.hovered, g.value], ['sprout', 1]);
    assert.equal(await page.evaluate(() => [document.querySelector('.sprout-liquid').getAttribute('filter'), document.querySelector('.sprout-neck').getAttribute('d')].join('')), '', 'sharp, and parted from the corner, once out');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.sprout-glyph')).opacity), '1');
    assert.ok(Math.hypot(g.P1[0] - rounding[0], g.P1[1] - rounding[1]) >= 20 + g.Rb + 3, 'the bell rests clear of the notch, off its rounded corner');
    const badge = await page.evaluate(() => { const r = document.querySelector('.sprout-glyph').getBoundingClientRect(); return [r.left + r.width * .5 + .34 * r.width, r.top + r.height * .5 - .39 * r.height]; });
    assert.ok(near(g.dot, badge, 1.5), 'the dot sits on the bell\'s shoulder: ' + JSON.stringify([g.dot, badge]));
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('notch-dot')).boxShadow.includes('2px')), true, 'ringed in black over the bell');
    // Main is told: the bell is hot and is the alerts control; the pin pocket is not reported under it
    const hot = await page.evaluate(() => JSON.parse(lastHot));
    assert.deepEqual(Object.keys(hot.controls).sort(), ['alerts', 'settings']);
    const box = hot.controls.alerts;
    assert.ok(box[0] <= g.P1[0] - g.Rb && box[0] + box[2] >= g.P0[0] && box[1] <= g.P1[1] - g.Rb && box[1] + box[3] >= g.P0[1], 'covers the dot and the bell');
    assert.ok(hot.rects.some(r => JSON.stringify(r) === JSON.stringify(box)));
    // Following it out keeps it out, and no account card opens under the way
    for (let i = 1; i <= 6; i++) { await page.mouse.move(g.P0[0] + (g.P1[0] - g.P0[0]) * i / 6, g.P0[1] + (g.P1[1] - g.P0[1]) * i / 6); await page.waitForTimeout(40); }
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => [hovered, sprout.value, card.classList.contains('show')]), ['sprout', 1, false]);
    await page.screenshot({ path: path.join(OUT, 'sprout-right.png') });

    // Pressing the bell asks main for the log, without pressing the ring underneath; main's answer opens the log there
    await page.mouse.down(); await page.mouse.up();
    assert.deepEqual(await page.evaluate(() => __calls.filter(c => c[0] === 'activate_control').at(-1)[1]), { control: 'alerts' });
    assert.equal(await page.evaluate(() => card.classList.contains('show')), false, 'no ring press');
    await page.evaluate(() => __emit('control_pressed', 'alerts')); await page.waitForTimeout(1600); // open long enough to be read
    assert.deepEqual(await page.evaluate(() => [card.classList.contains('show'), card.dataset.account]), [true, '__alerts']);
    assert.deepEqual(await page.evaluate(() => [sprout.value, sprout.available, document.getElementById('notch-dot').classList.contains('on')]), [0, false, false], 'the bell melts into the log and the dot goes');
    await page.mouse.move(g.P0[0], g.P0[1]); await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate(() => [hovered, card.classList.contains('show')]), [null, true], 'the corner does nothing under the open log');
    await page.screenshot({ path: path.join(OUT, 'sprout-log.png') });
    await page.evaluate(() => hideCard()); await page.mouse.move(640, 400); await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => document.getElementById('notch-dot').classList.contains('on')), false, 'read, so no dot');

    // Something new: the dot is back; let go, the bell is swallowed and the dot slides home
    await page.evaluate(log => __emit('alert_log', log), unread()); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.getElementById('notch-dot').classList.contains('on')), true);
    await page.mouse.move(g.P0[0], g.P0[1]); await page.waitForTimeout(900);
    await page.mouse.move(640, 400);
    await page.evaluate(() => { window.__home = { reach: 0 }; const t0 = performance.now(); const f = () => { if (sprout.target === 0 && sprout.value > .74 && document.querySelector('.sprout-neck').getAttribute('d')) __home.reach = 1; if (performance.now() - t0 < 800) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate(() => __home.reach), 1, 'the corner reaches out for the drop');
    g = await geo();
    assert.deepEqual([g.value, g.hovered], [0, null]);
    assert.ok(near(g.dot, g.P0), 'home in the corner');
    assert.equal(await page.evaluate(() => document.querySelector('.sprout-drop').getAttribute('d')), null);
    assert.equal(await page.evaluate(() => JSON.parse(lastHot).controls.alerts), undefined, 'and main no longer sees a bell there');

    // Quick passes in and out never leave a second spring running or the bell stranded
    for (let i = 0; i < 4; i++) { await page.mouse.move(g.P0[0], g.P0[1]); await page.waitForTimeout(50 + i * 30); await page.mouse.move(640, 400); await page.waitForTimeout(40); }
    await page.waitForTimeout(900);
    assert.deepEqual(await page.evaluate(() => [sprout.value, sprout.frame]), [0, 0]);

    // Keyboard: the bell is offered while the dot shows; focused, it comes out, and Enter asks for the log
    assert.equal(await page.evaluate(() => document.getElementById('alert-sprout').tabIndex), 0);
    await page.keyboard.press('Shift'); await page.focus('#alert-sprout'); await page.waitForTimeout(1300);
    assert.equal(await page.evaluate(() => sprout.value), 1, 'out under keyboard focus');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => __calls.filter(c => c[0] === 'activate_control').length), 2);
    await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => sprout.value), 0);

    // Every edge: the dot in the leading front corner, the bell out past the notch's front and on screen
    for (const edge of ['top', 'bottom', 'left']) {
      await place(edge);
      g = await geo();
      const front = { top: g.P0[1] > g.pill.bottom - 20, bottom: g.P0[1] < g.pill.top + 20, left: g.P0[0] > g.pill.right - 20 }[edge];
      assert.ok(front && near(g.dot, g.P0), edge + ': dot in the front corner ' + JSON.stringify(g));
      await page.mouse.move(g.P0[0], g.P0[1]); await page.waitForTimeout(1300);
      g = await geo();
      assert.deepEqual([edge, g.hovered, g.value], [edge, 'sprout', 1]);
      const out = { top: g.P1[1] - g.Rb > g.pill.bottom - 22, bottom: g.P1[1] + g.Rb < g.pill.top + 22, left: g.P1[0] - g.Rb > g.pill.right - 22 }[edge];
      assert.ok(out && g.P1[0] - g.Rb > 0 && g.P1[1] - g.Rb > 0 && g.P1[0] + g.Rb < 1280 && g.P1[1] + g.Rb < 800, edge + ': the bell is out and on screen ' + JSON.stringify(g));
      await page.screenshot({ path: path.join(OUT, 'sprout-' + edge + '.png') });
    }

    // Carried close to a screen corner, the way out turns toward the notch's front so the bell stays on screen
    await place('right');
    const L = await page.evaluate(() => pill.offsetHeight);
    await page.evaluate(([L]) => __emit('edge_cursor', { edge: 'right', perimeter: innerWidth + 14 + L / 2 }), [L]);
    await page.waitForTimeout(600);
    g = await geo();
    assert.ok(g.pill.top < 20 && g.P1[1] - g.Rb >= 5, 'on screen near the corner: ' + JSON.stringify(g));
    assert.ok(Math.abs(g.P1[0] - g.P0[0]) > Math.abs(g.P1[1] - g.P0[1]) * 1.5, 'turned toward the front');
    await page.evaluate(() => __emit('release')); await page.waitForTimeout(600);

    // Reduced motion: out and home at once, never liquid
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await place('right');
    g = await geo();
    await page.mouse.move(g.P0[0], g.P0[1]); await page.waitForTimeout(60);
    assert.deepEqual(await page.evaluate(() => [sprout.value, document.querySelector('.sprout-liquid').getAttribute('filter')]), [1, null]);
    await page.mouse.move(640, 400); await page.waitForTimeout(60);
    assert.equal(await page.evaluate(() => sprout.value), 0);
    assert.deepEqual(errors, []);
    console.log('Passed: dot rests in the leading front corner, bell drawn out on goo with the dot onto its shoulder, hot and alerts control while out, press opens the log without a ring press, swallowed on leave, quick passes, keyboard, every edge, near a screen corner, reduced motion.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
