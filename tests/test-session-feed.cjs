'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { SessionFeed, parseSessions, accountId } = require('../desktop/collector.cjs');

const line = sessions => JSON.stringify({ schema: 1, sessions });
const fake = script => () => [process.execPath, ['-e', script]];

test('feed lines become per-account activity with the usage snapshot ids', () => {
  const got = parseSessions(line([
    { provider: 'claude', account: 'claude', id: 's1', name: 'homelab-b7', state: 'busy', waitingFor: null, since: 1790711656 },
    { provider: 'codex', account: 'codex:b', id: 'r1', name: 'Nest', state: 'waiting', waitingFor: 'input needed', since: null },
    { provider: 'claude', account: 'claude', id: 's2', name: 'idle one', state: 'idle' },
    { provider: 'cursor', account: 'x', state: 'busy' }, null, 'junk',
  ]));
  assert.deepEqual(got, [
    { provider: 'claude', account: accountId('claude', 'claude'), state: 'busy', name: 'homelab-b7', detail: 'Working', since: 1790711656000 },
    { provider: 'codex', account: accountId('codex', 'codex:b'), state: 'waiting', name: 'Nest', detail: 'Input needed', since: 0 },
  ]);
  assert.throws(() => parseSessions('{"schema":2,"sessions":[]}'));
});

test('a stream updates on change, and its end clears the arcs and schedules a reconnect', async () => {
  const busy = line([{ provider: 'claude', account: 'claude', id: 's', name: 'n', state: 'busy', since: 1 }]);
  const feed = new SessionFeed(() => ({}), fake(`console.log(${JSON.stringify(busy)});console.log(${JSON.stringify(busy)});`));
  const changes = [];
  feed.on('change', value => changes.push(value.length));
  feed.start();
  await once(feed, 'change');
  await once(feed, 'change');
  assert.deepEqual(changes, [1, 0]); // the repeated line is not a change; the exit empties the list
  assert.ok(feed.timer, 'a reconnect is scheduled');
  feed.close();
});

test('a collector without --watch-sessions is retried rarely', async () => {
  const feed = new SessionFeed(() => ({}), fake(`process.stderr.write('agent-usage: error: unrecognized arguments: --watch-sessions');process.exit(2);`));
  let delay;
  feed.retry = value => { delay = value; };
  feed.start();
  await once(feed.child, 'close');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delay, 600000);
  feed.close();
});

test('Antigravity activity maps to its Gemini usage account', () => {
  const activity = parseSessions(line([{provider:'antigravity',account:'antigravity',state:'busy',name:'AGY',since:1},
    {provider:'antigravity',account:'antigravity',state:'waiting',waitingFor:'input needed'}]));
  assert.equal(activity[0].account,accountId('gemini','antigravity'));
  assert.equal(activity[0].detail,'Working');
  assert.equal(activity[1].detail,'Input needed');
});

test('Codex questions notify while the turn runs and answers restore working without completion', () => {
  const { SessionAlerts, alertPreferences } = require('../desktop/alerts.cjs');
  const alerts = new SessionAlerts(), prefs = alertPreferences({ waiting: true });
  const session = { provider: 'codex', account: 'codex:a', id: 'rollout-question',
    sessionId: '12345678-1234-5678-abcd-123456789012', name: 'Project', since: 1000 };
  const snapshot = state => parseSessions(line([{ ...session, state, waitingFor: state === 'waiting' ? 'input needed' : null }]), true);
  alerts.update(snapshot('busy'), prefs, 1000000);
  const events = alerts.update(snapshot('waiting'), prefs, 1060000);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'waiting');
  assert.equal(events[0].body, 'Input needed');
  assert.equal(events[0].account, accountId('codex', 'codex:a'));
  assert.equal(events[0].target.sessionId, session.sessionId);
  assert.deepEqual(alerts.update(snapshot('waiting'), prefs, 1061000), []);
  assert.deepEqual(alerts.update(snapshot('busy'), prefs, 1062000), []);
  const finished = parseSessions(line([{ ...session, state: 'idle', since: 1100 }]), true);
  assert.equal(alerts.update(finished, prefs, 1100000)[0].kind, 'completion');
});

test('terminal snapshots preserve identity for alerts and leave activity arcs off', () => {
  const feed = new SessionFeed(() => ({}));
  const snapshots=[];
  feed.on('snapshot',value=>snapshots.push(value));
  feed.line(line([{provider:'codex',account:'codex:b',id:'r1',sessionId:'12345678-1234-5678-abcd-123456789012',terminalPids:[90,80],cwd:'/srv/project',state:'busy'}]));
  assert.equal(feed.sessions.length,1);
  assert.equal(feed.sessions[0].id,'r1');
  assert.equal(feed.sessions[0].sessionId,'12345678-1234-5678-abcd-123456789012');
  assert.deepEqual(feed.sessions[0].terminalPids,[90,80]);
  feed.line(line([{provider:'codex',account:'codex:b',id:'r1',sessionId:'12345678-1234-5678-abcd-123456789012',state:'idle'}]));
  assert.equal(feed.sessions.length,0);
  assert.equal(snapshots[1][0].id,'r1');
  assert.equal(snapshots[1][0].state,'idle');
  assert.equal(snapshots[1][0].sessionId,'12345678-1234-5678-abcd-123456789012');
  feed.close();
});
test('malformed stream data resets alert continuity', () => {
  const feed = new SessionFeed(() => ({}));
  let disconnected=0;feed.on('disconnected',()=>disconnected++);
  feed.line('not json');assert.equal(disconnected,1);feed.close();
});
