'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const main = path.resolve(__dirname, '../desktop/main.cjs');
function setup(t, initialVisible = true, dependencies = {}) {
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
    globalShortcut:{register:(key,callback)=>{calls.push(['shortcut',key,callback]);return true;},isRegistered:()=>false,unregister(){}},
  };
  const win = { isDestroyed: () => false, isVisible: () => true, setOpacity: v => calls.push(['opacity', v]),
    setIgnoreMouseEvents: v => calls.push(['ignore', v]), setBounds: r => calls.push(['bounds', r]),
    setFocusable:value=>calls.push(['focusable',value]),setSkipTaskbar:value=>calls.push(['skip-taskbar',value]),focus:()=>calls.push(['focus']),blur:()=>calls.push(['blur']),
    setAlwaysOnTop() {}, moveTop() {}, webContents: { send: (_name, event, payload) => calls.push([event, structuredClone(payload)]), sendInputEvent: e => calls.push(['input', e]) } };
  const settings = { isDestroyed: () => false,isVisible:()=>false, webContents: { send() {} } };
  const localRequire = createRequire(main);
  const context = vm.createContext({ require: id => id === 'electron' ? electron : dependencies[id]?{...localRequire(id),...dependencies[id]}:localRequire(id),
    __dirname: path.dirname(main), process:{...process,platform:dependencies.platform||'linux'}, setTimeout, clearTimeout, setInterval, clearInterval });
  vm.runInContext(fs.readFileSync(main, 'utf8') + '\n globalThis.monitorTest = { init(w,s,c,file,d,shown){win=w;settings=s;config=c;configPath=file;monitor=d;visible=shown;sessionAlerts=new SessionAlerts();}, switchMonitor, reveal, tick, overNotch, controlHit, setHot(r){hot=r;}, phase:()=>phase, physicalPress, physicalRelease, setControls(c){controls=c;}, registerSessionShortcut, inputLine, setInput(value){input=value;}, setAccounts(a){collector={accounts:a};}, clearHistory(){historyCache=null;historyAt=0;historyGeneration++;} };', context, { filename: main });
  const config = { edge: 'right', along: .5, scale: 1,source:'ssh',sshTarget:'homelab',sessionPins:[],slots:[],focusAccounts:[] };
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

test('Ctrl + Scroll Lock opens the switcher, enables keyboard focus only for it, and toggles closed',async t=>{
 const s=setup(t);assert.equal(s.test.registerSessionShortcut(),true);
 const registration=s.calls.find(c=>c[0]==='shortcut');assert.equal(registration[1],'Ctrl+Scrolllock');registration[2]();
 assert.deepEqual(s.calls.at(-1),['session_switcher',true]);
 assert.equal(await s.command('session_switcher_focus',{},s.settings.webContents),false);
 assert.equal(await s.command('session_switcher_focus',{}),true);
 assert.deepEqual(s.calls.slice(-3),[['focusable',true],['skip-taskbar',true],['focus']]);
 registration[2]();assert.deepEqual(s.calls.slice(-4),[['session_switcher',false],['blur'],['focusable',false],['skip-taskbar',true]]);
});
test('Windows leaves session hotkey ownership with the native helper',t=>{
 const s=setup(t,true,{platform:'win32'});s.test.setInput({});
 assert.equal(s.test.registerSessionShortcut(),true);assert.equal(s.calls.some(c=>c[0]==='shortcut'),false);
 s.test.inputLine('010');assert.deepEqual(s.calls.at(-1),['session_switcher',true]);
});
test('switcher pins and resume commands resolve trusted saved metadata, including chats outside recent history',async t=>{
 const {accountId}=require('../desktop/collector.cjs'),account=accountId('codex','a'),opened=[];
 const saved={id:'chat',account,provider:'codex',name:'Agent Usage',since:1700000000000,state:'idle',live:false,
  sessionId:'12345678-1234-5678-abcd-123456789012',cwd:'/srv/agent-usage',agentHome:'/home/me/.codex-a'};
 let history={sessions:[saved]};
 const s=setup(t,true,{'./collector.cjs':{readSessionHistory:async()=>history},'./session-open.cjs':{openSession:async target=>{opened.push(target);return true;}}});
 s.test.setAccounts([{id:account,base:'codex',name:'Codex a'}]);
 assert.equal(await s.command('set_session_pin',{id:'chat',account,on:true,cwd:'/injected',sshTarget:'evil'}),true);
 assert.equal(s.config.sessionPins[0].cwd,saved.cwd);assert.equal(s.config.sessionPins[0].sshTarget,'homelab');
 assert.equal(JSON.parse(fs.readFileSync(path.join(s.root,'settings.json'))).sessionPins[0].account,account);
 history={sessions:[]};s.test.clearHistory();const rows=await s.command('get_session_library');assert.equal(rows.length,1);assert.equal(rows[0].pinned,true);assert.equal(rows[0].agentHome,undefined);
 await s.command('session_switcher_focus',{});assert.equal(await s.command('open_history_session',{id:'chat',account,cwd:'/injected',source:'wsl'}),true);
 assert.equal(opened[0].cwd,saved.cwd);assert.equal(opened[0].agentHome,saved.agentHome);assert.equal(opened[0].source,'ssh');
 assert.deepEqual(s.calls.filter(c=>c[0]==='focusable').at(-1),['focusable',false]);
 await assert.rejects(s.command('open_history_session',{id:'forged',account}),/no longer/);
 s.config.sshTarget='other';s.test.clearHistory();assert.equal((await s.command('get_session_library')).length,0);
 await assert.rejects(s.command('open_history_session',{id:'chat',account}),/no longer/);
});
test('native Ctrl + Scroll Lock opens while hidden, ignores held repeats and coalesces the Electron report',async t=>{
 const s=setup(t,false);s.test.registerSessionShortcut();const callback=s.calls.find(c=>c[0]==='shortcut')[2];
 s.test.inputLine('010');assert.deepEqual(s.calls.at(-1),['session_switcher',true]);
 assert.equal(s.calls.some(c=>c[0]==='focus'),false,'placement paints before keyboard focus');
 assert.equal(await s.command('session_switcher_focus'),false,'an early renderer request must not claim native focus on the still-masked window');
 await stow(s);const layout=s.calls.filter(c=>c[0]==='layout').at(-1)[1];assert.equal(layout.tracking,false);
 await s.command('monitor_placed',{placement:layout.placement});await s.command('session_switcher_focus');
 callback();s.test.inputLine('010');assert.equal(s.calls.filter(c=>c[0]==='session_switcher'&&c[1]===false).length,0);
 s.test.inputLine('000');s.test.inputLine('010');assert.deepEqual(s.calls.slice(-4),[['session_switcher',false],['blur'],['focusable',false],['skip-taskbar',true]]);
 s.test.inputLine('010');assert.equal(s.calls.filter(c=>c[0]==='session_switcher'&&c[1]===false).length,1);
});
test('focus groups persist multiple known accounts, retain visibility and clear independently of old settings',async t=>{
 const s=setup(t);s.test.setAccounts([{id:'codex-a',base:'codex',name:'Codex a'},{id:'claude-b',base:'claude',name:'Claude b'}]);s.config.slots=[{provider:'claude-b'}];
 await assert.rejects(s.command('set_focus_accounts',{accounts:['missing']}),/available/);
 await assert.rejects(s.command('set_focus_accounts',{accounts:'codex-a'}),/available/);
 assert.deepEqual(Array.from(await s.command('set_focus_accounts',{accounts:['codex-a','claude-b','codex-a']})),['codex-a','claude-b']);
 assert.equal(s.config.slots.some(slot=>slot.provider==='codex-a'),true);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.root,'settings.json'))).focusAccounts,['codex-a','claude-b']);
 assert.deepEqual(Array.from(await s.command('get_focus_accounts')),['codex-a','claude-b']);assert.deepEqual(Array.from(await s.command('set_focus_accounts',{accounts:[]})),[]);
});
test('automatic session refresh bypasses the history cache without launching overlapping reads',async t=>{
 let reads=0,rows=[{id:'chat',account:'codex-a',provider:'codex',name:'Before',since:1700000000000,state:'idle',sessionId:'12345678-1234-5678-abcd-123456789012',cwd:'/srv/project'}];
 const s=setup(t,true,{'./collector.cjs':{readSessionHistory:async()=>{reads++;return {sessions:rows};}}});
 assert.equal((await s.command('get_session_library'))[0].name,'Before');
 rows=[{...rows[0],name:'After'}];
 assert.equal((await s.command('get_session_library'))[0].name,'Before');assert.equal(reads,1);
 const [first,second]=await Promise.all([s.command('get_session_library',{refresh:true}),s.command('get_session_library',{refresh:true})]);
 assert.equal(first[0].name,'After');assert.equal(second[0].name,'After');assert.equal(reads,2);
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
test('the blue update dot receives native presses before an overlapping settings handle',async t=>{
  const s=setup(t);s.win.getBounds=()=>({...s.displays[0].bounds});
  await s.command('set_notch_monitor',{id:'1'});await stow(s);
  await s.command('monitor_placed',{placement:s.calls.filter(c=>c[0]==='layout').at(-1)[1].placement});
  await s.command('set_hot',{rects:[[1100,400,100,100]],controls:{settings:[1100,400,100,100],update:[1120,420,24,24]}});
  s.test.physicalPress({x:1130,y:430});
  assert.deepEqual(s.calls.filter(c=>c[0]==='control_pressed'),[['control_pressed','update']]);
  assert.equal(s.calls.some(c=>c[0]==='input'),false,'the dot opens its options without relaying another click');
});

test('Scroll Lock alone closes Sessions smoothly before following and releases keyboard focus',async t=>{
 const s=setup(t);s.point({x:640,y:30});await s.command('open_session_switcher');await s.command('session_switcher_focus');
 s.test.inputLine('100');assert.ok(s.calls.some(c=>c[0]==='session_follow'));
 assert.deepEqual(s.calls.filter(c=>c[0]==='focusable').at(-1),['focusable',false]);
 assert.deepEqual(s.calls.filter(c=>c[0]==='skip-taskbar').at(-1),['skip-taskbar',true]);
 s.test.tick();assert.equal(s.calls.some(c=>c[0]==='edge_cursor'),false,'cursor waits for the closing animation');
 await s.command('session_follow_ready',{},s.settings.webContents);s.test.tick();assert.equal(s.calls.some(c=>c[0]==='edge_cursor'),false,'settings cannot advance overlay motion');
 await s.command('session_follow_ready');s.test.tick();assert.ok(s.calls.some(c=>c[0]==='edge_cursor'),'cursor resumes when the notch ink has closed');
 s.test.inputLine('000');assert.ok(s.calls.some(c=>c[0]==='release'));
});
test('history opening preserves fresh collector terminal IDs without a live alert-feed entry',async t=>{
 const opened=[],saved={id:'chat',account:'codex-a',provider:'codex',name:'Session',since:1700000000000,state:'idle',live:true,
  sessionId:'12345678-1234-5678-abcd-123456789012',cwd:'/srv/project',agentHome:'/home/me/.codex',terminalPids:[90,80]};
 const s=setup(t,true,{'./collector.cjs':{readSessionHistory:async()=>({sessions:[saved]})},'./session-open.cjs':{openSession:async row=>{opened.push(row);return true;}}});
 await s.command('open_history_session',{id:'chat',account:'codex-a'});assert.deepEqual(Array.from(opened[0].terminalPids),[90,80]);
});
