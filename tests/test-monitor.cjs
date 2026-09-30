'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const main = path.resolve(__dirname, '../desktop/main.cjs');
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-monitor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [], displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 } },
    { id: 2, bounds: { x: -1600, y: 0, width: 1600, height: 1000 } },
  ];
  let command;
  const electron = {
    app: { setName() {}, setAppUserModelId() {}, setPath() {}, getPath: () => root, commandLine: { appendSwitch() {} },
      requestSingleInstanceLock: () => true, on() {}, whenReady: () => new Promise(() => {}) },
    ipcMain: { handle: (_name, handler) => { command = handler; } },
    screen: { getAllDisplays: () => displays, getCursorScreenPoint: () => ({ x: -1590, y: 300 }) },
  };
  const win = { isDestroyed: () => false, setOpacity: v => calls.push(['opacity', v]),
    setIgnoreMouseEvents: v => calls.push(['ignore', v]), setBounds: r => calls.push(['bounds', r]),
    setAlwaysOnTop() {}, moveTop() {}, webContents: { send: (_name, event, payload) => calls.push([event, structuredClone(payload)]) } };
  const settings = { webContents: {} };
  const localRequire = createRequire(main);
  const context = vm.createContext({ require: id => id === 'electron' ? electron : localRequire(id),
    __dirname: path.dirname(main), process, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync(main, 'utf8') + '\n globalThis.monitorTest = { init(w,s,c,file,d){win=w;settings=s;config=c;configPath=file;monitor=d;visible=true;}, switchMonitor };', context, { filename: main });
  const config = { edge: 'right', along: .5, scale: 1 };
  context.monitorTest.init(win, settings, config, path.join(root, 'settings.json'), displays[0]);
  const event = sender => ({ sender, senderFrame: { url: 'file://' + path.dirname(main) + '/ui/notch.html' } });
  return { calls, displays, config, move: context.monitorTest.switchMonitor,
    command: (name, args, sender = win.webContents) => command(event(sender), name, args), settings };
}
test('monitor change masks the native window before moving and reveals only after destination paint', async t => {
  const s = setup(t);
  await s.command('set_notch_monitor', { id: '2' });
  assert.deepEqual(s.calls.slice(0, 2), [['opacity', 0], ['ignore', true]]);
  assert.deepEqual(s.calls.find(c => c[0] === 'bounds')[1], s.displays[1].bounds);
  const layout = s.calls.find(c => c[0] === 'layout')[1];
  assert.equal(layout.edge, 'right'); assert.equal(layout.width, 1600); assert.equal(layout.height, 1000);
  assert.equal(s.calls.some(c => c[0] === 'appear' || c[0] === 'opacity' && c[1] === 1), false);
  await s.command('monitor_placed', { placement: layout.placement });
  assert.deepEqual(s.calls.slice(-2), [['appear', { edge: 'right' }], ['opacity', 1]]);
});
test('stale and settings acknowledgments cannot unmask a newer monitor move', async t => {
  const s = setup(t);
  await s.command('set_notch_monitor', { id: '2' });
  const first = s.calls.find(c => c[0] === 'layout')[1].placement;
  await s.command('set_notch_monitor', { id: '1' });
  const latest = s.calls.filter(c => c[0] === 'layout').at(-1)[1].placement;
  const before = s.calls.length;
  assert.equal(await s.command('monitor_placed', { placement: first }), false);
  assert.equal(await s.command('monitor_placed', { placement: latest }, s.settings.webContents), false);
  assert.equal(s.calls.length, before);
  assert.equal(await s.command('monitor_placed', { placement: latest }), true);
  assert.equal(await s.command('monitor_placed', { placement: latest }), false);
});
test('pointer transfers use destination coordinates and hidden relocations stay parked', async t => {
  const s = setup(t);
  s.move(s.displays[1], { atPointer: true });
  const layout = s.calls.find(c => c[0] === 'layout')[1];
  assert.equal(layout.edge, 'left'); assert.equal(layout.along, .3);
  await s.command('monitor_placed', { placement: layout.placement });
  s.calls.length = 0;
  s.move(s.displays[0], { show: false });
  assert.ok(s.calls.find(c => c[0] === 'bounds')[1].x < -1600 - 1280);
  const hidden = s.calls.find(c => c[0] === 'layout')[1];
  assert.equal(hidden.visible, false);
  await s.command('monitor_placed', { placement: hidden.placement });
  assert.equal(s.calls.some(c => c[0] === 'appear'), false);
});
