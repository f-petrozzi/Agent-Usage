'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {QuotaAlerts, SessionAlerts, alertPreferences, orderedAccounts, trayReadings} = require('../desktop/alerts.cjs');
const prefs = alertPreferences({waiting:true,completion:true});
const account = (used, reset=1000, status='ok', id='codex') => ({id,name:id,snap:{status,windows:[{id:'primary',label:'5-hour',used,resets_at:reset}]}});
const session = (state, id='one', account='codex') => ({id,account,state,name:'Nest',detail:'Input needed'});

test('quota crossings fire once per boundary, persist over restart, and ignore corrections',()=>{
  let alerts=new QuotaAlerts();
  assert.deepEqual(alerts.update([account(.7)],prefs,0),[]);
  assert.equal(alerts.update([account(.8)],prefs,0)[0].kind,'quota');
  assert.deepEqual(alerts.update([account(.85)],prefs,0),[]);
  alerts=new QuotaAlerts(JSON.parse(JSON.stringify(alerts.saved)));
  assert.deepEqual(alerts.update([account(.85)],prefs,0),[]);
  assert.equal(alerts.update([account(1)],prefs,0).length,1);
  assert.deepEqual(alerts.update([account(.3)],prefs,0),[]);
  assert.deepEqual(alerts.update([account(1)],prefs,0),[]);
  assert.deepEqual(alerts.update([account(.2,2000)],prefs,1100),[]);
  assert.equal(alerts.update([account(.8,2000)],prefs,1100).length,1);
});
test('initial high usage, stale readings, muting and disabled alerts do not spam',()=>{
  const alerts=new QuotaAlerts();
  assert.deepEqual(alerts.update([account(.9)],prefs,0),[]);
  assert.deepEqual(alerts.update([account(1,1000,'stale')],prefs,0),[]);
  assert.deepEqual(alerts.update([account(1)],{...prefs,muted:['codex']},0),[]);
  assert.deepEqual(alerts.update([account(1)],prefs,0),[]);
  alerts.update([account(.2,2000)],prefs,1100);
  assert.deepEqual(alerts.update([account(.8,2000)],{...prefs,quota:false},1100),[]);
  assert.deepEqual(alerts.update([account(.8,2000)],prefs,1100),[]);
});
test('an adjusted future reset time does not rearm warnings',()=>{
  const alerts=new QuotaAlerts();alerts.update([account(.7)],prefs,0);alerts.update([account(.9)],prefs,0);
  assert.deepEqual(alerts.update([account(.9,1100)],prefs,100),[]);
});
test('windows and accounts are independent, including windows with duplicate ids',()=>{
  const alerts=new QuotaAlerts();
  const a=account(.7);a.snap.windows.push({...a.snap.windows[0],label:'Weekly',used:.2});
  alerts.update([a,account(.2,1000,'ok','claude')],prefs,0);
  a.snap.windows[1].used=.9;
  const events=alerts.update([a,account(.9,1000,'ok','claude')],prefs,0);
  assert.equal(events.length,2);assert.match(events[0].body,/Weekly/);
});
test('unknown resets never invent a new window and corrupt saved state is ignored',()=>{
  const alerts=new QuotaAlerts({broken:{level:'bad'},null:null});
  alerts.update([account(.1,null)],prefs);alerts.update([account(.9,null)],prefs);
  alerts.update([account(.1,null)],prefs);assert.deepEqual(alerts.update([account(.9,null)],prefs),[]);
});
test('waiting and completion require an observed busy transition, never a vanished session',()=>{
  const alerts=new SessionAlerts();
  assert.deepEqual(alerts.update([session('waiting')],prefs),[]);
  assert.deepEqual(alerts.update([session('idle')],prefs),[]);
  alerts.update([session('busy')],prefs);
  assert.equal(alerts.update([session('waiting')],prefs)[0].kind,'waiting');
  assert.deepEqual(alerts.update([session('waiting')],prefs),[]);
  assert.deepEqual(alerts.update([session('idle')],prefs),[]);
  alerts.update([session('busy')],prefs);
  assert.equal(alerts.update([session('idle')],prefs)[0].kind,'completion');
  alerts.update([session('busy')],prefs);
  assert.deepEqual(alerts.update([],prefs),[]);
  assert.deepEqual(alerts.update([session('idle')],prefs),[]);
});
test('cancel, disconnect, newly discovered sessions and disabled preferences never announce completion',()=>{
  const alerts=new SessionAlerts();alerts.update([session('busy')],prefs);
  assert.deepEqual(alerts.update([session('canceled')],prefs),[]);
  alerts.update([session('busy')],prefs);alerts.reset();
  assert.deepEqual(alerts.update([session('idle')],prefs),[]);
  assert.deepEqual(alerts.update([session('waiting','new')],prefs),[]);
  alerts.update([session('busy')],prefs);
  assert.deepEqual(alerts.update([session('idle')],alertPreferences({completion:false})),[],'turned off, it stays quiet');
});
test('session identity includes its account and missing identities cannot cause alerts',()=>{
  const alerts=new SessionAlerts();alerts.update([session('busy')],prefs);
  assert.deepEqual(alerts.update([session('idle','one','claude'),session('idle','')],prefs),[]);
});
test('ordered tray readings respect visibility, show stale and zero, and do not invent resets',()=>{
  const values=[account(0,null),account(.81,3660000,'stale','claude')];
  assert.deepEqual(orderedAccounts(values,[{provider:'claude'}]).map(a=>a.id),['claude']);
  assert.deepEqual(orderedAccounts(values,[{provider:'missing'}]),values);
  const readings=trayReadings(values,0);
  assert.equal(readings[0].lines[0],'5-hour: 0% used');
  assert.equal(readings[1].lines[0],'5-hour: 81% used · resets in 1h 1m');
  assert.equal(readings[1].status,'stale');
});
test('preferences keep booleans strict and deduplicate muted account ids',()=>{
  const actual=alertPreferences({quota:'yes',waiting:true,muted:['a','a',3]});
  assert.equal(actual.quota,true);assert.equal(actual.waiting,true);assert.deepEqual(actual.muted,['a']);
});

test('The alert log keeps the last 40 or the last week, newest last, and only what the bell shows', () => {
  const { alertLog, logAlerts } = require('../desktop/alerts.cjs');
  const now = Date.now();
  let log = logAlerts([], [{ kind: 'quota', account: 'claude', window: 'session', level: 80, used: .83, title: 'Claude usage warning', body: '5 hours', token: 'secret' }], now);
  assert.equal(log.length, 1); assert.equal(log[0].read, false); assert.equal(log[0].at, now);
  assert.ok(!('token' in log[0]), 'nothing it does not show is kept');
  for (let i = 0; i < 45; i++) log = logAlerts(log, [{ kind: 'waiting', account: 'codex', session: 's' + i }], now + i);
  assert.equal(log.length, 40); assert.equal(log.at(-1).session, 's44');
  const week = alertLog([{ id: 'old', at: now - 8 * 864e5, kind: 'quota' }, { id: 'odd', at: now, kind: 'toast' }, { id: 'ok', at: now - 864e5, kind: 'completion', read: true }], now);
  assert.deepEqual(week.map(e => e.id), ['ok'], 'older than a week and unknown kinds are dropped');
  assert.equal(week[0].read, true);
  assert.deepEqual(alertLog('not a list'), []);
});

test('Finished: a turn that ran at least 30 seconds and ended on its own, with how long it took', () => {
  const { SessionAlerts, COMPLETION_MIN_MS, DEFAULT_ALERTS } = require('../desktop/alerts.cjs');
  assert.equal(DEFAULT_ALERTS.completion, true, 'on unless turned off');
  const prefs = alertPreferences({});
  const s = new SessionAlerts(), t0 = 1_000_000;
  const at = (state, since) => [{ id: 'x', account: 'claude', name: 'homelab', state, since }];
  s.update(at('busy', t0), prefs, t0);
  assert.deepEqual(s.update(at('idle', t0 + 5000), prefs, t0 + 5000), [], 'a quick turn was watched as it happened');
  s.update(at('busy', t0 + 10000), prefs, t0 + 10000);
  const [done] = s.update(at('idle', t0 + 10000 + 12 * 60000), prefs, t0 + 10000 + 12 * 60000);
  assert.equal(done.kind, 'completion'); assert.equal(done.took, 12 * 60000); assert.equal(done.body, 'Worked 12 min.');
  s.update(at('busy', t0), prefs, t0 + 13 * 60000);
  assert.deepEqual(s.update(at('canceled', t0), prefs, t0 + 14 * 60000), [], 'a canceled turn did not finish');
  assert.ok(COMPLETION_MIN_MS >= 30000);
});



test('Claude busy updates preserve elapsed work and link its completion after log reload', () => {
  const { logAlerts, alertLog, sessionUrl } = require('../desktop/alerts.cjs');
  const alerts = new SessionAlerts(), t0 = 1000000;
  const sessionId = '12345678-1234-5678-abcd-123456789012';
  const at = (state, since) => [{ id: sessionId, sessionId, provider: 'claude', account: 'claude', name: 'homelab', state, since }];
  alerts.update(at('busy', t0), prefs, t0);
  alerts.update(at('busy', t0 + 60000), prefs, t0 + 60000);
  alerts.update(at('busy', t0 + 119000), prefs, t0 + 119000);
  const events = alerts.update(at('idle', t0 + 120000), prefs, t0 + 121500);
  assert.equal(events.length, 1);
  assert.equal(events[0].took, 120000, 'measure through the explicit end, not the latest busy rewrite or polling lag');
  assert.deepEqual(alerts.update(at('idle', t0 + 121000), prefs, t0 + 122000), [], 'idle rewrites do not repeat it');
  const [saved] = alertLog(JSON.parse(JSON.stringify(logAlerts([], events, t0 + 121500))), t0 + 121500);
  assert.equal(sessionUrl(saved.target), `vscode://anthropic.claude-code/open?session=${sessionId}`);
  assert.equal(sessionUrl({ provider: 'codex', sessionId }), `vscode://openai.chatgpt/local/${sessionId}`);
  for (const target of [null, { provider: 'shell', sessionId }, { provider: 'claude', sessionId: 'x?prompt=run' }])
    assert.equal(sessionUrl(target), null, 'cannot open arbitrary URLs or prefill commands');
});
