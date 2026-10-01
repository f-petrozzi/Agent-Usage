'use strict';
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Menu, nativeTheme, shell, Tray, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { openSession } = require('./session-open.cjs');
const { createUpdates } = require('./updates.cjs');
const { pointerPlacement } = require('./perimeter.cjs');
const { Collector, SessionFeed, validHost, enrollAntigravity, readSessionLinks } = require('./collector.cjs');
const { alertPreferences, QuotaAlerts, SessionAlerts, orderedAccounts, trayReadings, alertLog, logAlerts, sessionUrl, historicalTarget, sessionTarget } = require('./alerts.cjs');

app.setName('Agent Usage');
app.setAppUserModelId('ink.petro.agent-usage');
app.setPath('userData', path.join(app.getPath('appData'), 'Agent Usage'));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => reveal());
  app.whenReady().then(start).catch(error => {
    require('electron').dialog.showErrorBox('Agent Usage could not start', error.message); app.quit();
  });
}
let win, settings, tray, input, collector, feed, config, configPath, timer, updates, quotaAlerts, sessionAlerts;
let trayTimer;
let visible = false, held = false, mouseDown = false, carrying = false, dismissed = false;
// alerting: the page is showing an alert, which decides for itself how long it stays (notify.js); expanded: a card
// is open, and the notch never goes before it has closed
let expanded = false, alerting = false, pinned = false, menuOpen = false, visibleUntil = 0, monitor, cursor, stage = { x: 0, y: 0 }, hot = [], inside = false;
let controls = {}, lastControl = { name: '', at: 0 }, lastCursor = '';
let notificationTestAccount = null;
let phase = 'hidden', frameReady = false, hotkeyProblem = '', lastRaise = 0, replacements = 0, pageViewport = null, lastPlacedAt = 0;
let placementSerial = 0, pendingPlacement = null, pendingPlacementEdge = null, pendingPlacementStage = null, pendingPlacementAtPointer = false;
const uiRoot = path.join(__dirname, 'ui');
const shortcuts = { Scrolllock: [145, 0], 'Shift+F1': [112, 4], 'Ctrl+Shift+Space': [32, 6], F13: [124, 0], F14: [125, 0], F15: [126, 0] };
const absent = () => ({ status: 'absent', windows: [], fetched_at: 0, note: '' });
const placeholder = () => ({ id: 'collector', base: 'claude', name: 'Agent Usage', glyph: '…', snap: { ...absent(), status: 'loading', note: 'Reading your collector…', details: [] } });
const accounts = () => {
  const values = collector?.accounts.length ? collector.accounts : [placeholder()];
  const order = config?.accountOrder || [];
  const rank = id => order.includes(id) ? order.indexOf(id) : order.length;
  return [...values].sort((a, b) => rank(a.id) - rank(b.id));
};
const broadcast = (name, payload) => { for (const w of [win, settings]) if (w && !w.isDestroyed()) w.webContents.send('event', name, payload); };
const send = (name, payload) => { if (win && !win.isDestroyed()) win.webContents.send('event', name, payload); };
// One line per placement (and per press that missed every control), so a placement that lands somewhere else can be read
// back from a real Windows session. Capped; never holds anything but geometry.
function diagnose(line) {
  try {
    const file = path.join(path.dirname(configPath), 'notch-diagnostics.log');
    if (fs.existsSync(file) && fs.statSync(file).size > 65536) fs.renameSync(file, file + '.old');
    fs.appendFileSync(file, new Date().toISOString() + ' ' + line + '\n');
  } catch {}
}
// Where the window really is. Page coordinates are measured from it, not from the monitor it was asked to cover.
function windowOrigin() {
  const b = typeof win?.getBounds === 'function' ? win.getBounds() : null;
  return b && Number.isFinite(b.x) && Number.isFinite(b.y) ? b : monitor.bounds;
}
function save() { fs.writeFileSync(configPath + '.tmp', JSON.stringify(config, null, 2)); fs.renameSync(configPath + '.tmp', configPath); }
function theme() { return config.theme === 'system' ? nativeTheme.shouldUseDarkColors ? 'dark' : 'light' : config.theme; }
function flags() { return { notch_visible: visible, notch_on_hover: !pinned, tray_visible: !!config.tray }; }
function resource(file) { return path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources'), file); }
function secure(w) {
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', e => e.preventDefault());
  w.webContents.on('will-frame-navigate', (event, url) => {
    if (!String(url || event.url || '').startsWith(pathToFileURL(uiRoot + path.sep).href)) event.preventDefault();
  });
}
async function start() {
  const dir = app.getPath('userData'); fs.mkdirSync(dir, { recursive: true }); configPath = path.join(dir, 'settings.json');
  let legacy = {}, stored = {};
  try { legacy = JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA || '', 'AgentUsageFrame', 'state.json'), 'utf8').replace(/^\uFEFF/, '')); } catch {}
  try { stored = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); } catch {}
  config = { source: legacy.Source === 'ssh' ? 'ssh' : 'wsl', sshTarget: legacy.SshTarget || '',
    scale: 1, theme: 'dark', weekly: 'outside', transition: 'ramp', slots: [], edge: 'right', along: 0.5,
    display: null, move: true, tray: false, lang: 'en', shortcut: 'Scrolllock', autostart: true, ...stored };
  // Move the previous default once; later explicit shortcut choices remain intact.
  if ((stored.shortcutRevision || 0) < 2 && ['Ctrl+Shift+Space', 'Shift+F1'].includes(config.shortcut)) config.shortcut = 'Scrolllock';
  config.shortcutRevision = 2;
  config.alerts = alertPreferences(config.alerts);
  // 3.2.0 turns on the finished-working alert once; after that it stays as chosen
  if ((stored.alertsRevision || 0) < 1) config.alerts.completion = true;
  config.alertsRevision = 1;
  config.accountOrder = Array.isArray(config.accountOrder) ? [...new Set(config.accountOrder.filter(id => typeof id === 'string'))].slice(0, 40) : [];
  quotaAlerts = new QuotaAlerts(config.quotaWarnings); sessionAlerts = new SessionAlerts();
  config.buttons = { pin: config.buttons?.pin !== false, refresh: config.buttons?.refresh !== false, alerts: config.buttons?.alerts !== false };
  config.alertLog = alertLog(config.alertLog);
  if (!shortcuts[config.shortcut]) config.shortcut = 'Scrolllock';
  if (!['left','right','top','bottom'].includes(config.edge)) config.edge = 'right';
  config.scale = [0.8, 1, 1.25].includes(config.scale) ? config.scale : 1;
  config.along = Math.max(0, Math.min(1, Number(config.along) || 0.5));
  if (!Array.isArray(config.slots)) config.slots = [];
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  // The UI is entirely local. Collector traffic is owned by ssh.exe/wsl.exe, not the renderer.
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_request, callback) => callback({ cancel: true }));
  monitor = screen.getAllDisplays().find(d => String(d.id) === config.display) || screen.getPrimaryDisplay();
  // Shown once and then only moved (see place): Windows zooms a window in from its middle each time
  // it is shown, and on this screen-sized overlay that made the notch float in to the edge
  win = new BrowserWindow({ ...monitor.bounds, show: false, transparent: true, frame: false, resizable: false,
    icon: resource('icon.ico'), focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, backgroundThrottling: false, spellcheck: false,
      // The alert chime is synthesised in the page, and an overlay nobody clicks never has a gesture to start audio
      autoplayPolicy: 'no-user-gesture-required' } });
  secure(win); win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.setZoomFactor(config.scale);
  await win.loadFile(path.join(uiRoot, 'notch.html'));
  place(); win.showInactive(); // its one show happens parked, off every screen
  updates = createUpdates({ app, updater: require('electron-updater').autoUpdater,
    installed: process.platform === 'win32' && app.isPackaged && fs.existsSync(resource('installer-managed')),
    onChange: state => broadcast('update_state', state),
    beforeInstall: () => { save(); }
  });
  updates.start();
  restartCollector();
  try { registerShortcut(config.shortcut); } catch (error) { hotkeyProblem = error.message; }
  configureTray();
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!config.autostart, path: process.execPath });
  nativeTheme.on('updated', () => broadcast('theme_resolved', theme()));
  screen.on('display-added', () => place()); // Windows can pull an off-screen window onto a new display
  screen.on('display-removed', () => { if (!screen.getAllDisplays().some(d => d.id === monitor.id)) switchMonitor(screen.getPrimaryDisplay()); });
  screen.on('display-metrics-changed', (_event, display) => { if (display.id === monitor.id) switchMonitor(display); });
  timer = setInterval(tick, 16);
  // Reset countdowns in an open tray menu are refreshed on the next opening.
  trayTimer = setInterval(updateTray, 60000);
  save();
}
function restartCollector() {
  sessionAlerts.reset();
  collector?.close();
  collector = new Collector(() => config);
  collector.on('change', value => {
    if (enrollAntigravity(config, value)) { save(); broadcast('notch_slots', config.slots); }
    const ordered = accounts();
    const before = JSON.stringify(quotaAlerts.saved);
    showAlerts(quotaAlerts.update(value, config.alerts));
    if (JSON.stringify(quotaAlerts.saved) !== before) { config.quotaWarnings = quotaAlerts.saved; save(); }
    broadcast('agent_accounts', ordered); broadcast('glyphs', glyphs()); broadcast('state', stateSnapshot()); updateTray(); });
  broadcast('agent_accounts', accounts());
  collector.refresh();
  if (feed) { feed.removeAllListeners(); feed.close(); }
  broadcast('activity', []);
  feed = new SessionFeed(() => config);
  feed.on('change', value => broadcast('activity', value));
  feed.on('snapshot', value => showAlerts(sessionAlerts.update(value, config.alerts)));
  feed.on('disconnected', () => sessionAlerts.reset());
  feed.start();
}
function useMonitor(display) {
  monitor = display; hot = []; controls = {}; lastCursor = ''; inside = false; config.display = String(display.id);
  place();
  sendLayout();
}
function switchMonitor(display, { show = visible, atPointer = false } = {}) {
  // Clear Chromium's last painted surface before moving a settled notch to another screen.
  win.setOpacity(0); win.setIgnoreMouseEvents(true, { forward: true });
  hot = []; controls = {}; lastCursor = ''; inside = false;
  pendingPlacement = ++placementSerial; visible = show; phase = 'transfer'; replacements = 0;
  pendingPlacementStage = 'stow'; pendingPlacementAtPointer = atPointer;
  monitor = display; config.display = String(display.id);
  if (atPointer) {
    const at = cursorPlacement(screen.getCursorScreenPoint()); config.edge = at.edge; config.along = at.along;
  }
  pendingPlacementEdge = config.edge;
  send('monitor_stow', { placement: pendingPlacement });
  if (show) visibleUntil = Math.max(visibleUntil, Date.now() + 1800);
}
// Closed, the window is parked just past the leftmost screen, still shown: nothing of it is composited over
// other apps, and opening moves it back, as moving it between screens always has, with no show animation.
function parkedBounds() {
  const left = Math.min(...screen.getAllDisplays().map(d => d.bounds.x));
  return { x: left - monitor.bounds.width - 400, y: monitor.bounds.y, width: monitor.bounds.width, height: monitor.bounds.height };
}
function place() { if (win && !win.isDestroyed()) win.setBounds(visible ? monitor.bounds : parkedBounds(), false); }
// Above the taskbar, which is also topmost and wins whenever it was raised more recently
function raise() { win.setAlwaysOnTop(true, 'screen-saver'); win.moveTop(); }
function sendLayout() {
  if (!config || !monitor || pendingPlacementStage === 'stow') return;
  send('layout', { width: monitor.bounds.width, height: monitor.bounds.height, scale: config.scale,
    edge: config.edge, along: config.along, visible, tracking: held || carrying, pinned, placement: pendingPlacement });
}
// The shortcut brings the notch to the pointer; an alert brings it out where it last rested
function reveal(atPointer = true) {
  if (!win || !config) return;
  dismissed = false; visibleUntil = Math.max(visibleUntil, Date.now() + 1800);
  if (!visible) {
    const display = atPointer ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()) : monitor;
    // A hidden spawn also crosses monitors: select its pointer edge before any bounds/layout become visible.
    switchMonitor(display, { show: true, atPointer });
    if (!win.isVisible()) win.showInactive();
    broadcast('ui_flags', flags());
  }
}
function hide() {
  if (!win || !visible) return;
  visible = false; phase = 'hiding'; pinned = false; hot = []; alerting = false; expanded = false;
  win.setIgnoreMouseEvents(true, { forward: true });
  send('disappear'); if (pendingPlacement) sendLayout(); broadcast('ui_flags', flags());
  // Long enough for the notch to slide back into the edge (agent-usage.css), then parked rather than hidden
  setTimeout(() => { if (!visible) { place(); phase = 'hidden'; } }, 460);
}
function cursorPlacement(point) {
  const b = monitor.bounds;
  return pointerPlacement(point.x-b.x,point.y-b.y,b.width,b.height);
}
function setPinned(value) {
  pinned = value; dismissed = false;
  if (value) reveal(); else visibleUntil = Date.now() + 1800;
  broadcast('ui_flags', flags()); sendLayout();
}
function tick() {
  if (!win || win.isDestroyed()) return;
  if (!visible && !(held || carrying)) return;
  // Windows lets a topmost window sink behind the taskbar and other topmost windows; keep reasserting it
  if (visible && Date.now() - lastRaise > 2000) { lastRaise = Date.now(); raise(); }
  cursor = screen.getCursorScreenPoint();
  if ((held || carrying) && !dismissed && !menuOpen) {
    reveal();
    const display = screen.getDisplayNearestPoint(cursor);
    if (display.id !== monitor.id && pendingPlacement === null) switchMonitor(display, { atPointer: true });
    const b = monitor.bounds;
    const at=cursorPlacement(cursor),edge=at.edge;
    config.edge = edge;config.along=at.along;
    const signature=`${display.id}:${cursor.x}:${cursor.y}:${edge}`;
    if (phase !== 'transfer' && signature !== lastCursor) {
      lastCursor=signature;send('edge_cursor', { x: cursor.x - b.x, y: cursor.y - b.y, edge, perimeter:at.position, tracking: true });
    }
    visibleUntil = Date.now() + 1800;
  }
  const hit = visible && phase !== 'transfer' && overNotch(cursor);
  if (hit !== inside) { inside = hit; send('notch_pointer', hit); win.setIgnoreMouseEvents(!hit, { forward: true }); }
  if (hit || alerting || expanded || menuOpen || settings?.isVisible()) visibleUntil = Math.max(visibleUntil, Date.now() + 500);
  if (visible && !pinned && !held && !carrying && !menuOpen && Date.now() > visibleUntil) hide();
}
// The one test of whether a screen point is over the notch, its card or its controls, from the page's hot rectangles
function overNotch(point) {
  const origin = windowOrigin(), x = point.x - origin.x - stage.x, y = point.y - origin.y - stage.y;
  return hot.some(r => x >= r[0]*config.scale && x <= (r[0]+r[2])*config.scale && y >= r[1]*config.scale && y <= (r[1]+r[3])*config.scale);
}
function registerShortcut(value) {
  if (!shortcuts[value]) throw new Error('Unsupported shortcut');
  if (config.shortcut !== value || !globalShortcut.isRegistered(value)) {
    if (!globalShortcut.register(value, () => reveal())) throw new Error(`${value} is already in use. Choose another shortcut.`);
    if (config.shortcut !== value) globalShortcut.unregister(config.shortcut);
  }
  config.shortcut = value;
  input?.kill();
  if (process.platform !== 'win32') return; // development preview only
  const [key, mods] = shortcuts[value];
  input = spawn(resource('InputMonitor.exe'), [String(process.pid), String(key), String(mods)], { windowsHide: true, stdio: ['ignore','pipe','ignore'] });
  let buffer = '';
  input.stdout.on('data', data => {
    buffer += data.toString();
    let at;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const value = buffer.slice(0, at).trim(); buffer = buffer.slice(at + 1);
      if (!/^[01]{3}$/.test(value)) continue;
      const previous = held, previousMouse = mouseDown;
      held = value[0] === '1'; mouseDown = value[2] === '1';
      if (held && !previous) { dismissed = false; lastCursor=''; reveal(); }
      if (!held && previous) { visibleUntil = Date.now() + 1800; send('release'); broadcast('ui_flags', flags()); save(); }
      if (mouseDown && !previousMouse && visible && !held && !carrying) physicalPress(screen.getCursorScreenPoint());
      if (!mouseDown && previousMouse) physicalRelease(screen.getCursorScreenPoint());
    }
  });
  input.on('error', () => { hotkeyProblem = 'Held-key helper could not start. Reinstall this build. Shortcut taps can still reveal the notch.'; broadcast('notice', hotkeyProblem); });
}
// The helper sees every physical left press. On a control it is that control's. Elsewhere on the notch the page should
// get the click itself, but on some first opens Windows never delivers it (hover still arrives as forwarded moves, so
// the notch looks alive while every switch, row and ring ignores presses). If the page has not reported a press shortly
// after, main presses it into the page at the same spot, and lets go when the button does.
const RELAY_MS = 140, PAGE_PRESS_WINDOW = 150;
let pagePressedAt = 0, relayed = null;
function physicalPress(point) {
  const control = CONTROLS.find(name => controlHit(controls[name], point));
  const recent = Date.now() - lastPlacedAt < 60000, origin = windowOrigin();
  if (control) { activateControl(control); return; }
  if (!overNotch(point)) {
    send('outside_press'); // puts a held card away
    if (recent) diagnose(`press-outside cursor=${point.x},${point.y} window=${JSON.stringify(origin)} hot=${JSON.stringify(hot)}`);
    return;
  }
  const at = Date.now(), x = Math.round(point.x - origin.x), y = Math.round(point.y - origin.y);
  relayed = { at, x, y, down: false, up: false };
  const press = relayed;
  setTimeout(() => {
    if (relayed !== press) return;
    const delivered = Math.abs(pagePressedAt - at) <= PAGE_PRESS_WINDOW;
    if (delivered) pagePressedAt = 0; // spent on this press, so it cannot vouch for the next one
    if (recent) diagnose(`press x=${x} y=${y} inside=${inside} page=${delivered ? 'got it' : 'missed it, relayed'}`);
    if (delivered || !visible || phase !== 'shown' || !win || win.isDestroyed()) { relayed = null; return; }
    win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    press.down = true;
    if (press.up) releaseRelayed(press);
  }, RELAY_MS);
}
function physicalRelease(point) {
  endMove();
  const press = relayed;
  if (!press) return;
  const origin = windowOrigin();
  press.up = true; press.upX = Math.round(point.x - origin.x); press.upY = Math.round(point.y - origin.y);
  if (press.down) releaseRelayed(press); // otherwise the relay lets go as soon as it has pressed
}
function releaseRelayed(press) {
  if (relayed === press) relayed = null;
  if (!win || win.isDestroyed()) return;
  win.webContents.sendInputEvent({ type: 'mouseUp', x: press.upX ?? press.x, y: press.upY ?? press.y, button: 'left', clickCount: 1 });
}
function controlHit(rect,point) {
  if(!rect||phase!=='shown')return false;
  const origin=windowOrigin(),x=(point.x-origin.x)/config.scale,y=(point.y-origin.y)/config.scale;
  return x>=rect[0]&&x<=rect[0]+rect[2]&&y>=rect[1]&&y<=rect[1]+rect[3];
}
function beginMove() {
  carrying=true;dismissed=false;lastCursor='';send('move_begin');broadcast('ui_flags',flags());
}
function endMove() {
  if(!carrying)return;
  carrying=false;send('release');send('move_end');send('drag_end');
  broadcast('ui_flags',flags());visibleUntil=Date.now()+1800;save();
}
const CONTROLS = ['settings', 'pin', 'refresh', 'alerts'];
function activateControl(name) {
  if(!visible||!CONTROLS.includes(name))return;
  const now=Date.now();if(lastControl.name===name&&now-lastControl.at<300)return;
  lastControl={name,at:now};send('control_pressed',name);
  if(name==='settings')openSettings(['available','downloading','ready','error'].includes(updates?.get().status)?'general':'accounts');
  else if(name==='pin')setPinned(!pinned);
  else if(name==='refresh')requestRefresh(); // 'alerts' opens the log in the page, which control_pressed tells it
}
function requestRefresh() {
  const started=collector.refresh();if(started)send('refresh_started');return started;
}
function stateSnapshot() { return { sessions: [], agg: 'idle', counts: {}, lang_resolved: config?.lang === 'auto' ? 'en' : (config?.lang || 'en'), clock_24h: false }; }
function glyphs() {
  const out = {};
  for (const provider of ['claude', 'codex', 'gemini']) out[provider] = { kind: 'svg', svg: fs.readFileSync(path.join(uiRoot, 'glyphs', provider + '.svg'), 'utf8') };
  for (const account of accounts()) out[account.id] = out[account.base];
  return out;
}
function openSettings(tab = 'accounts') {
  if (settings && !settings.isDestroyed()) { settings.show(); settings.focus(); settings.webContents.send('event', 'settings_tab', tab); return; }
  settings = new BrowserWindow({ width: 820, height: 680, minWidth: 680, minHeight: 500, show: false, frame: false,
    backgroundColor: '#1d1d20', icon: resource('icon.ico'), title: 'Agent Usage settings',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  secure(settings);
  settings.once('ready-to-show', () => settings.show());
  settings.on('closed', () => { settings = null; notificationTestAccount = null; broadcast('notification_test', null); visibleUntil = Date.now() + 1800; });
  settings.loadFile(path.join(uiRoot, 'settings.html'), { query: { tab } });
}
function configureTray() {
  tray?.destroy(); tray = null;
  if (!config.tray) return;
  tray = new Tray(resource('icon.ico'));
  tray.on('click', reveal); tray.on('right-click', updateTray);
  updateTray();
}
function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  const readings = trayReadings(orderedAccounts(accounts(), config.slots));
  const rows = readings.map(a => ({ label: a.name + (a.lines[0] ? ` · ${a.lines[0]}` : '') + (a.status === 'ok' ? '' : ` (${a.status})`),
    submenu: a.lines.length ? a.lines.map(label => ({ label, enabled: false })) : [{ label: 'Usage unavailable', enabled: false }] }));
  tray.setToolTip(['Agent Usage', ...readings.map(a => `${a.name}: ${a.lines[0] || 'unavailable'}${a.status === 'stale' ? ' (stale)' : ''}`)].join('\n').slice(0, 127));
  tray.setContextMenu(Menu.buildFromTemplate([...rows, { type: 'separator' },
    { label: 'Refresh usage', click: requestRefresh }, { label: 'Show Agent Usage', click: reveal },
    { label: 'Settings', click: () => openSettings() }, { label: 'Quit', click: () => app.quit() }]));
}
// Alerts open out of the notch rather than as Windows toasts. It comes out where it last rested, opens the
// alert from the account's own ring, and goes back once it has been read (longer while under the pointer).
// The page says while one is showing (set_hot), so the notch stays exactly as long as the alert does.
const ALERT_MS = 6500;
function showAlerts(events) {
  if (!events.length || !win || win.isDestroyed()) return;
  config.alertLog = logAlerts(config.alertLog, events); save(); broadcast('alert_log', config.alertLog);
  const logged = config.alertLog.slice(-events.length); // their log entries, so the page can mark the ones it showed as seen
  reveal(false);
  visibleUntil = Math.max(visibleUntil, Date.now() + 2500); // until the page has it open and says so
  send('alert', { events: events.slice(0, 8).map((e, i) => ({ id: logged[i]?.id || null, kind: e.kind, account: e.account || null, window: e.window || null,
    level: e.level || null, used: Number.isFinite(e.used) ? e.used : null, session: e.session || null, target: logged[i]?.target || null, took: Number.isFinite(e.took) ? e.took : null,
    title: e.title, body: e.body })), sound: !!config.alerts.sound, hold: ALERT_MS });
}
function contextMenu() {
  menuOpen = true;
  return new Promise(resolve => Menu.buildFromTemplate([
    { label: 'Pin here', type: 'checkbox', checked: pinned, click: item => setPinned(item.checked) },
    { label: 'Refresh usage', click: requestRefresh },
    { label: 'Settings…', click: () => openSettings() },
    { label: updates?.get().status === 'ready' ? 'Restart to update' : updates?.get().status === 'available' ? 'Update available' : 'Check for updates', click: () => { openSettings('general'); if(updates?.get().status==='ready')updates.install();else if(updates?.get().status==='available')void updates.download();else void updates?.check(); } }, { type: 'separator' },
    { label: 'Hide', click: () => { dismissed = true; hide(); } },
    { label: 'Quit Agent Usage', click: () => app.quit() }
  ]).popup({ window: win, callback: () => { menuOpen = false; visibleUntil = Date.now() + 700; resolve(null); } }));
}
const enumValue = (value, choices) => { if (!choices.includes(value)) throw new Error('Invalid setting'); return value; };
ipcMain.handle('command', async (event, command, args = {}) => {
  if (![win?.webContents, settings?.webContents].includes(event.sender) || !event.senderFrame.url.startsWith(pathToFileURL(uiRoot + path.sep).href)) throw new Error('Untrusted UI');
  if (typeof command !== 'string' || !args || typeof args !== 'object') throw new Error('Invalid command');
  switch (command) {
    case 'ready': frameReady = true; sendLayout(); return null;
    case 'monitor_stowed': {
      if (event.sender !== win?.webContents || args.placement !== pendingPlacement || pendingPlacementStage !== 'stow') return false;
      // The pointer may have moved while the previous screen's surface was being cleared.
      if (pendingPlacementAtPointer) {
        const point = screen.getCursorScreenPoint(); monitor = screen.getDisplayNearestPoint(point);
        const at = cursorPlacement(point); config.edge = at.edge; config.along = at.along;
      }
      pendingPlacementEdge = config.edge; pendingPlacementStage = 'paint';
      useMonitor(monitor); if (visible) raise(); return true;
    }
    case 'monitor_placed': {
      if (event.sender !== win?.webContents || !Number.isInteger(args.placement) || args.placement !== pendingPlacement || pendingPlacementStage !== 'paint') return false;
      if (pendingPlacementAtPointer && visible) {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        if (display.id !== monitor.id) { switchMonitor(display, { atPointer: true }); return false; }
      }
      // The shortcut may have crossed to another edge while the masked renderer was resizing.
      if (visible && pendingPlacementEdge !== config.edge) {
        pendingPlacement = ++placementSerial; pendingPlacementEdge = config.edge; sendLayout(); return false;
      }
      // Asked to cover the monitor, the window can land elsewhere on its first move from the parked position (sized for
      // the leftmost screen) to a screen at another scale; clicks then miss everything drawn. Placed again from the screen
      // it is now on, it lands exactly, as moving it to another screen and back did by hand.
      const actual = typeof win.getBounds === 'function' ? win.getBounds() : null;
      const off = !!actual && ['x', 'y', 'width', 'height'].some(k => Math.abs(actual[k] - monitor.bounds[k]) > 1);
      diagnose(`placed display=${monitor.id} scale=${monitor.scaleFactor} monitor=${JSON.stringify(monitor.bounds)} window=${JSON.stringify(actual)} page=${JSON.stringify(pageViewport)} zoom=${config.scale}${off ? ' off' : ''}`);
      if (visible && off && replacements < 2) {
        replacements++; place(); pendingPlacement = ++placementSerial; sendLayout(); return false;
      }
      replacements = 0; lastPlacedAt = Date.now();
      pendingPlacement = null; pendingPlacementEdge = null; pendingPlacementStage = null; pendingPlacementAtPointer = false;
      phase = visible ? 'shown' : 'hidden';
      win.setOpacity(1); return true;
    }
    case 'stage_bounds': stage = { x: Number(args.x) || 0, y: Number(args.y) || 0 }; return null;
    case 'set_hot': {
      const validRect=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[2]>=0&&r[3]>=0;
      hot=Array.isArray(args.rects)?args.rects.filter(validRect).slice(0,12):[];
      controls={};for(const name of CONTROLS)if(validRect(args.controls?.[name]))controls[name]=args.controls[name];
      alerting=args.alerting===true;expanded=args.expanded===true;
      return null;
    }
    case 'activate_control': activateControl(args.control); return null;
    case 'end_move': endMove(); return null;
    case 'get_agent_accounts': return accounts();
    case 'get_state': return stateSnapshot();
    case 'get_usage': return accounts().find(a => a.base === 'claude')?.snap || absent();
    case 'get_codex': return accounts().find(a => a.base === 'codex')?.snap || absent();
    case 'get_cursor': case 'get_grok': case 'get_glm': case 'get_opencode': case 'get_antigravity': return absent();
    case 'get_activity': return feed?.sessions || [];
    case 'get_claude_auth': return { available: false, busy: false, can_sign_in: false };
    case 'get_glyphs': return glyphs();
    case 'get_tray_options': return accounts().map(a => ({ id: a.id, label: a.name, status: a.snap.status, used: a.snap.windows[0]?.used }));
    case 'get_alert_preferences': return config.alerts;
    case 'get_notification_test': return notificationTestAccount;
    case 'set_notification_test': {
      if (event.sender !== settings?.webContents) throw new Error('Open Settings to test a notification.');
      const account = accounts().find(a => a.id === args.account);
      if (!account) throw new Error('This account is no longer available.');
      notificationTestAccount = args.on === true ? account.id : null;
      if (notificationTestAccount) { reveal(false); visibleUntil = Math.max(visibleUntil, Date.now() + 2500); }
      broadcast('notification_test', notificationTestAccount); return notificationTestAccount;
    }
    case 'open_alert_session': {
      // Resolve a stored alert, never accept a URL or command from the renderer.
      const entry = alertLog(config.alertLog).find(e => e.id === args.id);
      if (entry?.target && !entry.target.terminalPids?.length) {
        const current = [...(sessionAlerts.previous?.values() || [])].find(s => s.account === entry.account && s.sessionId === entry.target.sessionId);
        const target = sessionTarget(current);
        if (target?.terminalPids?.length) entry.target = target;
      }
      if (entry && !entry.target && entry.kind === 'completion') {
        entry.target = historicalTarget(entry, await readSessionLinks(config));
        if (entry.target) {
          config.alertLog = alertLog(config.alertLog).map(e => e.id === entry.id ? { ...e, target: entry.target } : e);
          save(); broadcast('alert_log', config.alertLog);
        }
      }
      const url = sessionUrl(entry?.target);
      if (!url) return false;
      return openSession(entry.target, shell, { protocolName: url => app.getApplicationNameForProtocol(url) });
    }
    case 'open_working_session': {
      const active = feed?.sessions.find(s => s.account === args.account && s.id === args.id)
        || sessionAlerts.previous?.get(args.account + ':' + args.id);
      const url = sessionUrl(active);
      if (!url) return false;
      return openSession(active, shell, { protocolName: url => app.getApplicationNameForProtocol(url) });
    }
    case 'get_alert_log': return config.alertLog = alertLog(config.alertLog);
    case 'mark_alerts_read': { // all of them (the log was opened), or just the ones an alert showed and was pointed at
      const ids = Array.isArray(args.ids) ? new Set(args.ids.filter(id => typeof id === 'string').slice(0, 40)) : null;
      config.alertLog = alertLog(config.alertLog).map(e => (!ids || ids.has(e.id) ? { ...e, read: true } : e)); save(); broadcast('alert_log', config.alertLog); return config.alertLog;
    }
    case 'clear_alert_log': config.alertLog = []; save(); broadcast('alert_log', config.alertLog); return config.alertLog;
    case 'set_alert_preferences': {
      config.alerts = alertPreferences({ ...config.alerts, ...args }); save(); broadcast('alert_preferences', config.alerts); return config.alerts;
    }
    case 'set_account_order': {
      if (!Array.isArray(args.ids)) throw new Error('Invalid account order');
      config.accountOrder = [...new Set(args.ids.filter(id => accounts().some(a => a.id === id)))].slice(0, 40);
      // Visibility is independent of order. An explicit selection follows the new order.
      if (config.slots.length) config.slots.sort((a, b) => config.accountOrder.indexOf(a.provider) - config.accountOrder.indexOf(b.provider));
      save(); broadcast('agent_accounts', accounts()); broadcast('notch_slots', config.slots); updateTray(); return accounts();
    }
    case 'get_notch_slots': return config.slots;
    case 'set_notch_slots': {
      const values = accounts();
      config.slots = (Array.isArray(args.slots) ? args.slots : []).filter(s => s && values.some(a => a.id === s.provider)).map(s => ({ provider: s.provider }));
      config.slots = [...new Map(config.slots.map(s => [s.provider, s])).values()];
      config.slots.sort((a, b) => values.findIndex(x => x.id === a.provider) - values.findIndex(x => x.id === b.provider));
      save(); updateTray(); broadcast('notch_slots', config.slots); return config.slots;
    }
    case 'get_theme_resolved': return theme();
    case 'get_theme': return config.theme;
    case 'set_theme': config.theme = enumValue(args.theme, ['system','light','dark']); save(); broadcast('theme_resolved', theme()); return config.theme;
    case 'get_scale': return config.scale;
    case 'set_scale': config.scale = enumValue(args.scale, [0.8,1,1.25]); win.webContents.setZoomFactor(config.scale); save(); sendLayout(); return config.scale;
    case 'get_weekly_ring': return config.weekly;
    case 'set_weekly_ring': config.weekly = enumValue(args.placement, ['off','inside','outside']); save(); broadcast('weekly_ring', config.weekly); return config.weekly;
    case 'get_color_transition': return config.transition;
    case 'set_color_transition': config.transition = enumValue(args.style, ['hard_step','ramp']); save(); broadcast('color_transition', config.transition); return config.transition;
    case 'get_move_handle': return config.move;
    case 'set_move_handle': config.move = args.on === true; save(); broadcast('move_handle', config.move); return config.move;
    case 'get_notch_buttons': return config.buttons;
    case 'set_notch_buttons': for (const key of ['pin', 'refresh', 'alerts']) if (typeof args[key] === 'boolean') config.buttons[key] = args[key]; save(); broadcast('notch_buttons', config.buttons); return config.buttons;
    case 'set_pinned': setPinned(args.on === true); return pinned;
    case 'get_ui_flags': return flags();
    case 'set_ui_flags': {
      const raw = args.flags || args;
      const f = { tray_visible: raw.tray_visible ?? raw.trayVisible, notch_visible: raw.notch_visible ?? raw.notchVisible, notch_on_hover: raw.notch_on_hover ?? raw.notchOnHover };
      if (typeof f.tray_visible === 'boolean') { config.tray = f.tray_visible; configureTray(); }
      if (f.notch_visible === false) hide();
      else if (typeof f.notch_on_hover === 'boolean') { setPinned(!f.notch_on_hover); if(f.notch_visible === true) reveal(); }
      save(); broadcast('ui_flags', flags()); return flags();
    }
    case 'get_notch_edge': return config.edge;
    case 'set_notch_edge': config.edge = enumValue(args.edge, ['left','right','top','bottom']); config.along = 0.5; save(); reveal(); sendLayout(); broadcast('notch_edge', config.edge); return config.edge;
    case 'get_notch_insets': return [0,0,0,0];
    case 'get_monitors': return screen.getAllDisplays().map((d,i) => ({ id: String(d.id), label: d.label || `Display ${i + 1} (${d.size.width} × ${d.size.height})`, current: d.id === monitor.id, primary: d.id === screen.getPrimaryDisplay().id }));
    case 'set_notch_monitor': { const d = screen.getAllDisplays().find(d => String(d.id) === args.id); if (!d) throw new Error('Display no longer attached'); switchMonitor(d, { show: true }); save(); return null; }
    case 'reset_notch_position': config.along = 0.5; save(); reveal(); sendLayout(); return null;
    case 'get_lang': return config.lang;
    case 'get_lang_resolved': return config.lang === 'auto' ? 'en' : config.lang;
    case 'set_lang': config.lang = enumValue(args.lang, ['auto','en','ru','zh','zh-Hant','ja','ko','pt-BR','uk']); save(); broadcast('state', stateSnapshot()); broadcast('lang', config.lang); return config.lang;
    case 'get_system_look': return { theme: theme(), accent: '#8888ff' };
    case 'get_autostart': return config.autostart;
    case 'set_autostart': config.autostart = args.on === true; if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.autostart, path: process.execPath }); save(); return config.autostart;
    case 'get_hooks_installed': case 'get_adaptive_pill': return false;
    case 'get_antigravity_prefs': return { limit: 'automatic', model: 'gemini' };
    case 'get_update_state': return updates?.get() || { status: 'idle', currentVersion: app.getVersion() };
    case 'check_for_update': void updates?.check(); return null;
    case 'download_update': void updates?.download(); return null;
    case 'install_update': updates?.install(); return null;
    case 'get_version': return app.getVersion();
    case 'get_collector': return { source: config.source, sshTarget: config.sshTarget, shortcut: config.shortcut, error: hotkeyProblem };
    case 'set_collector': {
      enumValue(args.source, ['wsl','ssh']);
      if (args.source === 'ssh' && !validHost(args.sshTarget)) throw new Error('Use an SSH host or user@host');
      const target = String(args.sshTarget || '');
      if (config.source !== args.source || config.sshTarget !== target) { quotaAlerts = new QuotaAlerts(); config.quotaWarnings = {}; }
      config.source = args.source; config.sshTarget = target; save(); restartCollector(); return null;
    }
    case 'set_shortcut': registerShortcut(args.shortcut); hotkeyProblem = ''; save(); return config.shortcut;
    case 'open_settings': openSettings(); return null;
    case 'close_settings': settings?.close(); return null;
    case 'refresh_ring': requestRefresh(); return false;
    case 'show_notch_menu': return contextMenu();
    case 'begin_move': case 'drag_begin': beginMove(); return null;
    case 'open_data_dir': await shell.openPath(app.getPath('userData')); return null;
    case 'quit_app': app.quit(); return null;
    case 'report_dpr': pageViewport = { dpr: Number(args.dpr) || null, w: Number(args.w) || null, h: Number(args.h) || null }; return null;
    case 'page_pressed': pagePressedAt = Date.now(); return null;
    case 'log_js': case 'notch_hidden': return null;
    default: throw new Error('This feature is not supplied by the remote collector');
  }
});
app.on('window-all-closed', () => {});
app.on('before-quit', () => { clearInterval(timer); clearInterval(trayTimer); globalShortcut.unregisterAll(); input?.kill(); collector?.close(); feed?.close(); updates?.close(); });
