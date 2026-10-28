// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright module. Synthetic accounts and alerts only.
// Reveal geometry: details reopen at the notch's current place after a same-edge move, and every painted frame of a
// growing notification or details panel stays inside the hot regions an embedded host clips to (plus its 22px margin).
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path');
const UI = path.resolve(__dirname, '../../desktop/ui');
const now = Date.now();
const win = (id, used, h) => ({ id, label: id, used, resets_at: now + h * 3600e3, count: null, derived: false });
const accounts = [
  { id: 'claude', base: 'claude', name: 'Claude', glyph: 'C', snap: { status: 'ok', windows: [win('session', .42, 3), win('seven_day', .71, 90)], fetched_at: now, note: '', details: ['Synthetic'] } },
  { id: 'codex', base: 'codex', name: 'Codex', glyph: 'Cx', snap: { status: 'ok', windows: [win('primary', .18, 2), win('secondary', .33, 100)], fetched_at: now, note: '', details: ['Plan: Plus'] } },
];
const glyphs = {};
for (const p of ['claude', 'codex', 'gemini']) glyphs[p] = { kind: 'svg', svg: fs.readFileSync(path.join(UI, 'glyphs', p + '.svg'), 'utf8') };
const answers = {
  get_agent_accounts: accounts, get_glyphs: glyphs, get_ui_flags: { notch_visible: false, notch_on_hover: true, tray_visible: false },
  get_state: { sessions: [], agg: 'idle', counts: {}, lang_resolved: 'en', clock_24h: false }, get_usage: accounts[0].snap,
  get_codex: accounts[1].snap, get_move_handle: true, get_weekly_ring: 'outside', get_color_transition: 'ramp',
  get_theme_resolved: 'dark', get_update_state: { status: 'current' }, get_notch_slots: [], get_activity: [],
  get_antigravity_prefs: { limit: 'automatic', model: 'gemini' },
};
// Installed in the page: counts frames whose ink (clamped to the viewport) leaves the last reported regions.
function watch(name, element) {
  window.__watch = { name, frames: 0, clipped: 0, centers: [] };
  const tick = () => {
    const el = element();
    if (el?.getAttribute('d')) {
      const b = el.getBoundingClientRect(), pad = 22;
      const rects = (window.__hot?.rects || []).map(([x, y, w, h]) => [x - pad, y - pad, x + w + pad, y + h + pad]);
      const inside = (x, y) => rects.some(r => x >= r[0] - 1 && x <= r[2] + 1 && y >= r[1] - 1 && y <= r[3] + 1);
      const corners = [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]]
        .map(([x, y]) => [Math.max(0, Math.min(innerWidth, x)), Math.max(0, Math.min(innerHeight, y))]);
      window.__watch.frames++;
      if (corners.some(c => !inside(...c))) window.__watch.clipped++;
      window.__watch.centers.push(Math.round(b.x + b.width / 2));
    }
    if (window.__watch.frames < 40) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
(async () => {
  const browser = await chromium.launch();
  try {
    for (const [width, height, edge, reduced] of [[1280, 800, 'top', false], [1280, 800, 'right', false], [390, 844, 'top', false], [1280, 800, 'top', true]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(({ answers, edge, watch }) => {
        const listeners = {};
        window.__hot = null;
        window.__watchSource = watch;
        window.agentUsage = {
          invoke: (c, a) => {
            if (c === 'set_hot') window.__hot = a;
            if (c === 'get_notch_edge') return Promise.resolve(edge);
            return Promise.resolve(c in answers ? answers[c] : c.startsWith('get_') ? { status: 'absent', windows: [], fetched_at: 0, note: '' } : null);
          },
          on: (n, cb) => { (listeners[n] = listeners[n] || []).push(cb); return () => {}; },
        };
        window.__emit = (n, p) => (listeners[n] || []).forEach(cb => cb(p));
      }, { answers, edge, watch: watch.toString() });
      await page.goto('file://' + UI + '/notch.html');
      await page.waitForTimeout(300);
      await page.evaluate(() => { window.watch = eval('(' + window.__watchSource + ')'); });
      const layout = along => page.evaluate(([edge, along]) => __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge, along, visible: true, tracking: false }), [edge, along]);
      await layout(.3);
      await page.evaluate(edge => __emit('appear', { edge }), edge);
      await page.waitForTimeout(1500);
      const label = `${width} ${edge}${reduced ? ' reduced' : ''}`;

      // A notification grows inside the reported region on every frame.
      await page.evaluate(() => {
        watch('notification', () => [...slivers.values()][0]?.path);
        __emit('alert', { events: [{ kind: 'waiting', account: 'codex', session: 'Synthetic session needs input', took: 60000 }], hold: 2500 });
      });
      await page.waitForTimeout(1200);
      const alert = await page.evaluate(() => window.__watch);
      assert.ok(alert.frames > 0, 'notification painted ' + label);
      assert.equal(alert.clipped, 0, 'notification ink inside hot regions ' + label + ' ' + JSON.stringify(alert));
      await page.waitForTimeout(3500);

      // Open details, carry the notch along the same edge, reopen: it opens where the notch now is.
      const hover = async () => {
        const r = await page.locator('.cell .ringwrap').first().boundingBox();
        await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
      };
      await hover();
      await page.waitForTimeout(1400);
      await page.mouse.move(width / 2, height - 10);
      await page.waitForTimeout(1200);
      await page.evaluate(() => __emit('move_begin'));
      for (const a of [.4, .55, .7]) {
        await page.evaluate(([edge, a]) => __emit('edge_cursor', { edge, x: a * innerWidth, y: a * innerHeight, trackingStarted: false }), [edge, a]);
        await page.waitForTimeout(60);
      }
      await page.evaluate(() => { __emit('move_end'); __emit('release'); });
      await layout(.7);
      await page.waitForTimeout(1200);
      const vertical = edge === 'left' || edge === 'right';
      const notch = await page.evaluate(vertical => { const b = pill.getBoundingClientRect(); return Math.round(vertical ? b.y + b.height / 2 : b.x + b.width / 2); }, vertical);
      await page.evaluate(() => watch('details', () => detailPath));
      await hover();
      await page.waitForTimeout(1400);
      const details = await page.evaluate(() => window.__watch);
      assert.ok(details.frames > 0, 'details painted ' + label);
      assert.equal(details.clipped, 0, 'details ink inside hot regions ' + label + ' ' + JSON.stringify(details));
      if (!vertical) assert.ok(Math.max(...details.centers.map(x => Math.abs(x - notch))) <= 4, 'details open at the current notch ' + label + ' ' + JSON.stringify({ notch, centers: details.centers.slice(0, 6) }));
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('PASS: details reopen at the moved notch; notification and details ink stay inside hot regions every frame (1280 top/right, 390 top, reduced motion)');
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
