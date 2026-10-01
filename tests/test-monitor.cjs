'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const main = path.resolve(__dirname, '../desktop/main.cjs');
function setup(t, initialVisible = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-usage-monitor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [], displays = [
    { id: 1, bounds: { x: 0, y: 0, width: 1280, height: 800 } },
    { id: 2, bounds: { x: -1600, y: 0, width: 1600, height: 1000 } },
  ];
  let command, point = { x: -1590, y: 300 };
  const electron = {
    app: { setName() {}, setAppUserModelId() {}, setPath() {}, getPath: () => root, commandLine: { appendSwitch() {} },
      requestSingleInstanceLock: () => true, on() {}, whenReady: () => new Promise(() => {}) },
    ipcMain: { handle: (_name, handler) => { command = handler; } },
    screen: { getAllDisplays: () => displays, getCursorScreenPoint: () => point, getDisplayNearestPoint: p => p.x < 0 ? displays[1] : displays[0] },
  };
  const win = { isDestroyed: () => false, isVisible: () => true, setOpacity: v => calls.push(['opacity', v]),
    setIgnoreMouseEvents: v => calls.push(['ignore', v]), setBounds: r => calls.push(['bounds', r]),
    setAlwaysOnTop() {}, moveTop() {}, webContents: { send: (_name, event, payload) => calls.push([event, structuredClone(payload)]), sendInputEvent: e => calls.push(['input', e]) } };
  const settings = { isDestroyed: () => false, webContents: { send() {} } };
  const localRequire = createRequire(main);
  const context = vm.createContext({ require: id => id === 'electron' ? electron : localRequire(id),
    __dirname: path.dirname(main), process, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync(main, 'utf8') + '\n globalThis.monitorTest = { init(w,s,c,file,d,shown){win=w;settings=s;config=c;configPath=file;monitor=d;visible=shown;}, switchMonitor, reveal, overNotch, controlHit, setHot(r){hot=r;}, phase:()=>phase, physicalPress, physicalRelease, setControls(c){controls=c;} };', context, { filename: main });
  const config = { edge: 'right', along: .5, scale: 1 };
  context.monitorTest.init(win, settings, config, path.join(root, 'settings.json'), displays[0], initialVisible);
  const event = sender => ({ sender, senderFrame: { url: pathToFileURL(path.join(path.dirname(main), 'ui', 'notch.html')).href } });
  return { calls, displays, config, win, root, point: p => { point = p; }, move: context.monitorTest.switchMonitor, reveal: context.monitorTest.reveal, test: context.monitorTest,
    command: (name, args, sender = win.webContents) => command(event(sender), name, args), settings };
}
const stow = async s => {
  const token=s.calls.filter(c=>c[0]==='monitor_stow').at(-1)[1].placement;
  assert.equal(await s.command('monitor_stowed',{placement:token}),true);
  return token;
};
test('monitor change clears the rendered surface before moving and reveals only after destination paint', async t => {
  const s = setup(t);
  await s.command('set_notch_monitor', { id: '2' });
  assert.deepEqual(s.calls.slice(0, 2), [['opacity', 0], ['ignore', true]]);
  assert.equal(s.calls.some(c=>c[0]==='bounds'||c[0]==='layout'),false,'old painted surface stays on the old monitor until cleared');
  const token=s.calls.at(-1)[1].placement;
  assert.equal(await s.command('monitor_placed',{placement:token}),false,'cannot reveal before the clearing step');
  await stow(s);
  assert.deepEqual(s.calls.find(c => c[0] === 'bounds')[1], s.displays[1].bounds);
  const layout = s.calls.find(c => c[0] === 'layout')[1];
  assert.equal(layout.edge, 'right'); assert.equal(layout.width, 1600); assert.equal(layout.height, 1000);
  assert.equal(s.calls.some(c => c[0] === 'appear' || c[0] === 'opacity' && c[1] === 1), false);
  await s.command('monitor_placed', { placement: layout.placement });
  assert.deepEqual(s.calls.at(-1), ['opacity', 1]);
  assert.equal(s.calls.some(c=>c[0]==='appear'),false,'destination is already drawn before native unmasking');
});
test('stale and settings acknowledgments cannot move or unmask a newer monitor transfer', async t => {
  const s = setup(t);
  await s.command('set_notch_monitor', { id: '2' });
  const first=s.calls.at(-1)[1].placement;
  await s.command('set_notch_monitor', { id: '1' });
  const latest=s.calls.at(-1)[1].placement;
  const before=s.calls.length;
  assert.equal(await s.command('monitor_stowed',{placement:first}),false);
  assert.equal(await s.command('monitor_stowed',{placement:latest},s.settings.webContents),false);
  assert.equal(await s.command('monitor_placed',{placement:latest}),false);
  assert.equal(s.calls.length,before);
  await stow(s);
  assert.equal(await s.command('monitor_placed',{placement:first}),false);
  assert.equal(await s.command('monitor_placed',{placement:latest},s.settings.webContents),false);
  assert.equal(await s.command('monitor_placed',{placement:latest}),true);
  assert.equal(await s.command('monitor_placed',{placement:latest}),false);
});
test('pointer transfers use destination coordinates and hidden relocations stay parked', async t => {
  const s = setup(t);
  s.move(s.displays[1], { atPointer: true });await stow(s);
  const layout = s.calls.find(c => c[0] === 'layout')[1];
  assert.equal(layout.edge, 'left'); assert.equal(layout.along, .3);
  await s.command('monitor_placed', { placement: layout.placement });
  s.calls.length = 0;
  s.move(s.displays[0], { show: false });await stow(s);
  assert.ok(s.calls.find(c => c[0] === 'bounds')[1].x < -1600 - 1280);
  const hidden = s.calls.find(c => c[0] === 'layout')[1];
  assert.equal(hidden.visible, false);
  await s.command('monitor_placed', { placement: hidden.placement });
  assert.equal(s.calls.some(c => c[0] === 'appear'), false);
});
test('revealing a hidden notch clears it before emitting any old-edge layout', async t => {
  const s = setup(t, false);
  s.reveal();
  assert.deepEqual(s.calls.slice(0, 2), [['opacity', 0], ['ignore', true]]);
  assert.equal(s.calls.some(c=>c[0]==='bounds'||c[0]==='layout'),false);
  await stow(s);
  const layouts = s.calls.filter(c => c[0] === 'layout');
  assert.equal(layouts.length, 1);
  const layout = layouts[0][1];
  assert.equal(layout.edge, 'left'); assert.equal(layout.along, .3); assert.equal(layout.visible, true);
  assert.deepEqual(s.calls.find(c => c[0] === 'bounds')[1], s.displays[1].bounds);
  assert.equal(s.calls.some(c => c[0] === 'appear' || c[0] === 'opacity' && c[1] === 1), false);
  await s.command('monitor_placed', { placement: layout.placement });
  assert.deepEqual(s.calls.at(-1), ['opacity', 1]);
});
test('an edge changed during resize is prepared again before unmasking', async t => {
  const s = setup(t, false);
  s.reveal();await stow(s);
  const first = s.calls.find(c => c[0] === 'layout')[1].placement;
  s.config.edge = 'top';
  const before = s.calls.length;
  assert.equal(await s.command('monitor_placed', { placement: first }), false);
  assert.equal(s.calls.length, before + 1);
  const retry = s.calls.at(-1);
  assert.equal(retry[0], 'layout'); assert.equal(retry[1].edge, 'top'); assert.notEqual(retry[1].placement, first);
  assert.equal(await s.command('monitor_placed', { placement: first }), false);
  assert.equal(await s.command('monitor_placed', { placement: retry[1].placement }), true);
  assert.deepEqual(s.calls.at(-1), ['opacity', 1]);
});

test('the clearing acknowledgment selects the latest pointer screen and position', async t => {
  const s=setup(t,false);s.reveal();
  s.point({x:1270,y:500});await stow(s);
  const layout=s.calls.filter(c=>c[0]==='layout').at(-1)[1];
  assert.deepEqual(s.calls.find(c=>c[0]==='bounds')[1],s.displays[0].bounds);
  assert.equal(layout.edge,'right');assert.equal(layout.along,.625);
  assert.equal(await s.command('monitor_placed',{placement:layout.placement}),true);
});
test('returning to the other screen during painting keeps the native window masked', async t => {
  const s=setup(t,false);s.reveal();await stow(s);
  const previous=s.calls.filter(c=>c[0]==='layout').at(-1)[1].placement;
  s.point({x:1270,y:400});
  assert.equal(await s.command('monitor_placed',{placement:previous}),false);
  assert.equal(s.calls.some(c=>c[0]==='opacity'&&c[1]===1),false);
  assert.equal(s.calls.at(-1)[0],'monitor_stow');
  await stow(s);
  const latest=s.calls.filter(c=>c[0]==='layout').at(-1)[1];
  assert.notEqual(latest.placement,previous);assert.equal(latest.edge,'right');assert.equal(latest.along,.5);
  assert.equal(await s.command('monitor_placed',{placement:latest.placement}),true);
});
test('a placement that lands off its monitor is placed again before it is shown, and logged', async t => {
  const s = setup(t);
  let landed = { x: 37, y: -12, width: 1600, height: 1000 };
  s.win.getBounds = () => landed;
  await s.command('set_notch_monitor', { id: '2' }); await stow(s);
  const first = s.calls.filter(c => c[0] === 'layout').at(-1)[1].placement;
  const bounds = s.calls.filter(c => c[0] === 'bounds').length;
  assert.equal(await s.command('monitor_placed', { placement: first }), false, 'not shown where it landed');
  assert.equal(s.calls.filter(c => c[0] === 'bounds').length, bounds + 1, 'placed again from the screen it is on');
  assert.equal(s.calls.some(c => c[0] === 'opacity' && c[1] === 1), false);
  const second = s.calls.filter(c => c[0] === 'layout').at(-1)[1].placement;
  assert.ok(second > first, 'the page paints the new placement before it is shown');
  landed = { ...s.displays[1].bounds };
  assert.equal(await s.command('monitor_placed', { placement: second }), true);
  assert.deepEqual(s.calls.at(-1), ['opacity', 1]);
  const log = require('node:fs').readFileSync(require('node:path').join(s.root, 'notch-diagnostics.log'), 'utf8').trim().split('\n');
  assert.equal(log.length, 2); assert.match(log[0], / off$/); assert.doesNotMatch(log[1], / off$/);
});
test('a window that keeps landing off is shown after two retries rather than never', async t => {
  const s = setup(t);
  s.win.getBounds = () => ({ x: 5, y: 5, width: 1600, height: 1000 });
  await s.command('set_notch_monitor', { id: '2' }); await stow(s);
  const results = [];
  for (let i = 0; i < 3; i++) results.push(await s.command('monitor_placed', { placement: s.calls.filter(c => c[0] === 'layout').at(-1)[1].placement }));
  assert.deepEqual(results, [false, false, true]);
});
test('hit testing and controls measure from where the window really is', async t => {
  const s = setup(t);
  s.config.scale = 1.25;
  let landed = { ...s.displays[1].bounds };
  s.win.getBounds = () => landed;
  await s.command('set_notch_monitor', { id: '2' }); await stow(s);
  assert.equal(await s.command('monitor_placed', { placement: s.calls.filter(c => c[0] === 'layout').at(-1)[1].placement }), true);
  assert.equal(s.test.phase(), 'shown');
  // The window ends up 40,20 from its monitor's corner (as a mixed-scale first move left it): page rectangles follow it
  landed = { x: -1600 + 40, y: 20, width: 1600, height: 1000 };
  s.test.setHot([[100, 100, 50, 50]]);
  const inside = { x: -1600 + 40 + 1.25 * 110, y: 20 + 1.25 * 110 }, monitorOnly = { x: -1600 + 1.25 * 110, y: 1.25 * 110 };
  assert.equal(s.test.overNotch(inside), true, 'offset by the real window origin and zoom');
  assert.equal(s.test.overNotch(monitorOnly), false, 'not by the monitor it was asked to cover');
  assert.equal(s.test.controlHit([100, 100, 50, 50], inside), true);
  assert.equal(s.test.controlHit([100, 100, 50, 50], monitorOnly), false);
});
test('a press Windows does not deliver to the page is relayed into it, and one it does deliver is left alone', async t => {
  const s = setup(t);
  s.win.getBounds = () => ({ ...s.displays[1].bounds });
  await s.command('set_notch_monitor', { id: '2' }); await stow(s);
  assert.equal(await s.command('monitor_placed', { placement: s.calls.filter(c => c[0] === 'layout').at(-1)[1].placement }), true);
  s.test.setHot([[1500, 400, 70, 200]]);
  const over = { x: -1600 + 1530, y: 450 }, wait = ms => new Promise(r => setTimeout(r, ms)), RELAY = 200; // past main's RELAY_MS
  const inputs = () => s.calls.filter(c => c[0] === 'input').map(c => JSON.parse(JSON.stringify(c[1]))); // made in main's VM realm
  // Delivered: the page says so, nothing is relayed
  s.test.physicalPress(over); await s.command('page_pressed', {}); await wait(RELAY); s.test.physicalRelease(over);
  assert.deepEqual(inputs(), []);
  // Not delivered: pressed into the page at the same spot, released when the button is
  s.test.physicalPress(over); await wait(RELAY);
  assert.deepEqual(inputs(), [{ type: 'mouseMove', x: 1530, y: 450 }, { type: 'mouseDown', x: 1530, y: 450, button: 'left', clickCount: 1 }]);
  s.test.physicalRelease({ x: over.x + 2, y: over.y });
  assert.deepEqual(inputs().at(-1), { type: 'mouseUp', x: 1532, y: 450, button: 'left', clickCount: 1 });
  // A quick click released before the relay is pressed and let go together
  s.calls.length = 0; s.test.physicalPress(over); await wait(20); s.test.physicalRelease(over); await wait(RELAY);
  assert.deepEqual(inputs().map(e => e.type), ['mouseMove', 'mouseDown', 'mouseUp']);
  // Controls are still main's own, and a press off the notch puts a held card away; neither is relayed
  s.calls.length = 0; s.test.setControls({ pin: [1500, 400, 70, 70] });
  s.test.physicalPress(over); await wait(RELAY);
  s.test.physicalPress({ x: -1600 + 100, y: 100 }); await wait(RELAY);
  assert.deepEqual(inputs(), []);
  assert.ok(s.calls.some(c => c[0] === 'control_pressed' && c[1] === 'pin') && s.calls.some(c => c[0] === 'outside_press'));
});
