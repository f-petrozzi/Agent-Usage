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
