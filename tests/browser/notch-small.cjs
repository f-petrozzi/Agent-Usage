// Small shrinks the notch, not what is read on it; goo edges stay smooth while they move. Real browser at the device
// scale small mode draws at (0.8 device px per CSS px), stubbed bridge.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path');
const UI = path.resolve(__dirname, '../../desktop/ui');
const OUT = process.argv[2] || '/tmp/agent-usage-small';
fs.mkdirSync(OUT, { recursive: true });
const now = Date.now();
const glyphs = {};
for (const p of ['claude', 'codex']) glyphs[p] = { kind: 'svg', svg: fs.readFileSync(path.join(UI, 'glyphs', p + '.svg'), 'utf8') };
const answers = {
  get_agent_accounts: [{ id: 'codex', base: 'codex', name: 'Codex', snap: { status: 'ok', windows: [{ id: 'p', label: '5 hours', used: .2, resets_at: now + 7e6 }], fetched_at: now, note: '', details: [] } },
    { id: 'claude', base: 'claude', name: 'Claude', snap: { status: 'ok', windows: [{ id: 'session', label: '5 hours', used: .83, resets_at: now + 9e6 }], fetched_at: now, note: '', details: [] } }],
  get_glyphs: glyphs, get_ui_flags: {}, get_notch_edge: 'right', get_state: { sessions: [], agg: 'idle', counts: {}, lang_resolved: 'en', clock_24h: false }, get_notch_buttons: { pin: true, alerts: true },
  get_alert_log: [{ id: 'a', at: now - 6e4, kind: 'completion', account: 'codex', session: 'homelab', took: 840000, read: true }, { id: 'b', at: now - 36e5, kind: 'waiting', account: 'claude', session: 'agent-usage', read: true }],
  get_alert_preferences: { quota: true, waiting: true, completion: true, sound: false }, get_update_state: { status: 'current' },
};
async function open(browser, zoom) {
  const page = await browser.newPage({ viewport: { width: Math.round(1280 / zoom), height: Math.round(800 / zoom) }, deviceScaleFactor: zoom });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ answers }) => { const l = {};
    window.agentUsage = { invoke: (c, a = {}) => { if (c === 'set_alert_preferences') { answers.get_alert_preferences = { ...answers.get_alert_preferences, ...a }; setTimeout(() => (l.alert_preferences || []).forEach(cb => cb(answers.get_alert_preferences))); }
      return Promise.resolve(c in answers ? answers[c] : null); }, on: (n, cb) => { (l[n] = l[n] || []).push(cb); return () => {}; } };
    window.__emit = (n, p) => (l[n] || []).forEach(cb => cb(p)); }, { answers: structuredClone(answers) });
  await page.goto('file://' + UI + '/notch.html'); await page.waitForTimeout(300);
  await page.evaluate(z => { __emit('layout', { width: innerWidth * z, height: innerHeight * z, scale: z, edge: 'right', along: .5, visible: true }); __emit('appear', { edge: 'right' }); }, zoom);
  await page.waitForTimeout(1300);
  return { page, errors };
}
const measure = page => page.evaluate(() => {
  const px = sel => parseFloat(getComputedStyle(card.querySelector(sel)).fontSize), tops = [...card.querySelectorAll('.a-chip')].map(b => b.getBoundingClientRect().top);
  return { tz: getComputedStyle(document.documentElement).getPropertyValue('--tz').trim(), word: px('.a-word'), sub: px('.a-sub'), width: card.offsetWidth,
    cut: [...card.querySelectorAll('.a-word,.a-sub,.w-label,.w-pct,.c-title')].some(e => e.scrollWidth > e.clientWidth + 1), oneRow: Math.max(...tops) - Math.min(...tops) < 1, pct: parseFloat(getComputedStyle(pill.querySelector('.pct')).fontSize) };
});
(async () => {
  const browser = await chromium.launch();
  try {
    const medium = await open(browser, 1);
    await medium.page.evaluate(() => openAlertLog()); await medium.page.waitForTimeout(1300);
    const m = await measure(medium.page);
    assert.deepEqual([m.tz, m.word, m.sub, m.cut, m.oneRow], ['1', 12.5, 11.5, false, true], 'medium is as it was');

    const small = await open(browser, .8);
    await small.page.evaluate(() => openAlertLog()); await small.page.waitForTimeout(1300);
    const s = await measure(small.page);
    assert.equal(s.tz, '1.25');
    // On screen the log's words are within a few percent of medium's, while the notch's own reading stays small
    assert.ok(Math.abs(s.word * .8 - m.word) / m.word < .05 && Math.abs(s.sub * .8 - m.sub) / m.sub < .05, 'text near medium size on screen: ' + JSON.stringify(s));
    assert.equal(s.pct, m.pct, 'the notch itself keeps small mode');
    assert.ok(s.width > m.width * 1.1 && !s.cut && s.oneRow, 'the card grows to hold it: ' + JSON.stringify({ s, m }));
    await small.page.screenshot({ path: path.join(OUT, 'small-log.png') });
    await small.page.evaluate(() => { hideCard(); holdCard('claude'); }); await small.page.waitForTimeout(1300);
    assert.equal(await small.page.evaluate(() => [...card.querySelectorAll('.w-label,.w-pct,.c-title,.w-reset')].some(e => e.scrollWidth > e.clientWidth + 1)), false, 'usage fits too');
    await small.page.screenshot({ path: path.join(OUT, 'small-usage.png') });

    // While goo is on, its cut-back leaves about a pixel of soft edge (slope at most 2.6x the blur), never the hard 24x step
    await small.page.evaluate(() => { hideCard(); openAlertLog(); }); await small.page.waitForTimeout(1300);
    await small.page.evaluate(() => { window.__goo = []; const t0 = performance.now(); const f = () => {
      const g = card.querySelector('.a-chips .a-drops'), filter = card.querySelector('.a-chips filter');
      if (g?.getAttribute('filter')) __goo.push([+filter.querySelector('feGaussianBlur').getAttribute('stdDeviation'), +filter.querySelector('feColorMatrix').getAttribute('values').trim().split(/\s+/)[18]]);
      if (performance.now() - t0 < 900) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await small.page.locator('#card .a-chip', { hasText: 'Waiting' }).click(); await small.page.waitForTimeout(1100);
    const goo = await small.page.evaluate(() => __goo);
    assert.ok(goo.length > 5 && goo.every(([sigma, k]) => k <= Math.max(1, sigma * 2.6) + .02), 'smooth cut-back: ' + JSON.stringify(goo.slice(0, 5)));
    assert.deepEqual([...medium.errors, ...small.errors], []);
    console.log('Passed: medium unchanged, small keeps card and log text near medium size with a wider card and a small notch, goo edges cut back smoothly.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
