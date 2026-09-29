'use strict';
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Menu, nativeTheme, shell, Tray, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { createUpdates } = require('./updates.cjs');
const { Collector, SessionFeed, validHost } = require('./collector.cjs');

app.setName('Agent Usage');
app.setPath('userData', path.join(app.getPath('appData'), 'Agent Usage'));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (!app.requestSingleInstanceLock()) { app.quit(); } else {
  app.on('second-instance', () => reveal());
  app.whenReady().then(start).catch(error => {
    require('electron').dialog.showErrorBox('Agent Usage could not start', error.message); app.quit();
  });
}
let win, settings, tray, input, collector, feed, config, configPath, timer, updates;
let visible = false, held = false, escape = false, mouseDown = false, carrying = false, dismissed = false;
let pinned = false, menuOpen = false, visibleUntil = 0, monitor, cursor, stage = { x: 0, y: 0 }, hot = [], inside = false;
let controls = {}, lastControl = { name: '', at: 0 }, lastCursor = '';
let phase = 'hidden', transferTimer, pendingMonitor, frameReady = false, hotkeyProblem = '', lastRaise = 0;
const uiRoot = path.join(__dirname, 'ui');
const shortcuts = { 'Ctrl+Shift+Space': [32, 6], F13: [124, 0], F14: [125, 0], F15: [126, 0] };
const absent = () => ({ status: 'absent', windows: [], fetched_at: 0, note: '' });
const placeholder = () => ({ id: 'collector', base: 'claude', name: 'Agent Usage', glyph: '…', snap: { ...absent(), status: 'loading', note: 'Reading your collector…', details: [] } });
const accounts = () => collector?.accounts.length ? collector.accounts : [placeholder()];
const broadcast = (name, payload) => { for (const w of [win, settings]) if (w && !w.isDestroyed()) w.webContents.send('event', name, payload); };
const send = (name, payload) => { if (win && !win.isDestroyed()) win.webContents.send('event', name, payload); };
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
    display: null, move: true, tray: false, lang: 'en', shortcut: 'Ctrl+Shift+Space', autostart: true, ...stored };
  config.buttons = { pin: config.buttons?.pin !== false, refresh: config.buttons?.refresh !== false };
  if (!shortcuts[config.shortcut]) config.shortcut = 'Ctrl+Shift+Space';
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
    focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
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
  screen.on('display-removed', () => { if (!screen.getAllDisplays().some(d => d.id === monitor.id)) useMonitor(screen.getPrimaryDisplay()); });
  screen.on('display-metrics-changed', (_event, display) => { if (display.id === monitor.id) useMonitor(display); });
  timer = setInterval(tick, 16);
  save();
}
function restartCollector() {
  collector?.close();
  collector = new Collector(() => config);
  collector.on('change', value => { broadcast('agent_accounts', value); broadcast('glyphs', glyphs()); broadcast('state', stateSnapshot()); });
  broadcast('agent_accounts', accounts());
  collector.refresh();
  feed?.close();
  feed = new SessionFeed(() => config);
  feed.on('change', value => broadcast('activity', value));
  feed.start();
}
function useMonitor(display) {
  monitor = display; hot = []; controls = {}; lastCursor = ''; inside = false; config.display = String(display.id);
  place();
  sendLayout();
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
  if (!config || !monitor) return;
  send('layout', { width: monitor.bounds.width, height: monitor.bounds.height, scale: config.scale,
    edge: config.edge, along: config.along, visible, tracking: held || carrying, pinned });
}
function reveal() {
  if (!win || !config) return;
  dismissed = false; visibleUntil = Date.now() + 1800;
  if (!visible) {
    cursor = screen.getCursorScreenPoint(); useMonitor(screen.getDisplayNearestPoint(cursor));
    config.edge = nearestEdge(cursor);
    const b = monitor.bounds; config.along = Math.max(0,Math.min(1,['top','bottom'].includes(config.edge)?(cursor.x-b.x)/b.width:(cursor.y-b.y)/b.height));
    visible = true; phase = 'shown'; hot = [];
    place(); raise(); if (!win.isVisible()) win.showInactive();
    sendLayout(); send('appear', { edge: config.edge }); broadcast('ui_flags', flags());
  }
}
function hide() {
  if (!win || !visible) return;
  visible = false; phase = 'hiding'; pinned = false; hot = [];
  win.setIgnoreMouseEvents(true, { forward: true });
  send('disappear'); broadcast('ui_flags', flags());
  // Long enough for the notch to slide back into the edge (agent-usage.css), then parked rather than hidden
  setTimeout(() => { if (!visible) { place(); phase = 'hidden'; } }, 460);
}
function nearestEdge(point) {
  const b = monitor.bounds;
  const d = { top: Math.abs(point.y - b.y), right: Math.abs(b.x + b.width - point.x), bottom: Math.abs(b.y + b.height - point.y), left: Math.abs(point.x - b.x) };
  const next = Object.keys(d).reduce((a, b) => d[a] < d[b] ? a : b);
  return d[config.edge] <= d[next] + 28 ? config.edge : next;
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
    if (display.id !== monitor.id && !transferTimer) {
      pendingMonitor = display; phase = 'transfer'; send('disappear');
      transferTimer = setTimeout(() => {
        const point=screen.getCursorScreenPoint();
        useMonitor(screen.getDisplayNearestPoint(point));
        config.edge=nearestEdge(point);
        const bounds=monitor.bounds; config.along=Math.max(0,Math.min(1,['top','bottom'].includes(config.edge)?(point.x-bounds.x)/bounds.width:(point.y-bounds.y)/bounds.height));
        sendLayout();
        transferTimer = null; pendingMonitor = null; phase = 'shown'; send('appear', { edge: config.edge });
      }, 170);
    }
    const b = monitor.bounds;
    const edge = nearestEdge(cursor);
    config.edge = edge;
    config.along = Math.max(0, Math.min(1, ['top','bottom'].includes(edge) ? (cursor.x - b.x) / b.width : (cursor.y - b.y) / b.height));
    const signature=`${display.id}:${cursor.x}:${cursor.y}:${edge}`;
    if (phase !== 'transfer' && signature !== lastCursor) {
      lastCursor=signature;send('edge_cursor', { x: cursor.x - b.x, y: cursor.y - b.y, edge, tracking: true });
    }
    visibleUntil = Date.now() + 1800;
  }
  const x = cursor.x - monitor.bounds.x - stage.x, y = cursor.y - monitor.bounds.y - stage.y;
  const hit = visible && phase !== 'transfer' && hot.some(r => x >= r[0]*config.scale && x <= (r[0]+r[2])*config.scale && y >= r[1]*config.scale && y <= (r[1]+r[3])*config.scale);
  if (hit !== inside) { inside = hit; send('notch_pointer', hit); win.setIgnoreMouseEvents(!hit, { forward: true }); }
  if (hit || menuOpen || settings?.isVisible()) visibleUntil = Math.max(visibleUntil, Date.now() + 500);
  if (visible && !pinned && !held && !carrying && !menuOpen && Date.now() > visibleUntil) hide();
}
function registerShortcut(value) {
  if (!shortcuts[value]) throw new Error('Unsupported shortcut');
  if (config.shortcut !== value || !globalShortcut.isRegistered(value)) {
    if (!globalShortcut.register(value, reveal)) throw new Error(`${value} is already in use. Choose another shortcut.`);
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
      if (mouseDown && !previousMouse && visible && !held && !carrying) {
        const point=screen.getCursorScreenPoint();
        for(const name of CONTROLS) if(controlHit(controls[name],point)) { activateControl(name); break; }
      }
      if (!mouseDown && previousMouse) endMove();
      if (value[1] === '1' && !escape && visible) { dismissed = true; carrying = false; hide(); }
      escape = value[1] === '1';
    }
  });
  input.on('error', () => { hotkeyProblem = 'Held-key helper could not start. Reinstall this build. Shortcut taps can still reveal the notch.'; broadcast('notice', hotkeyProblem); });
}
function controlHit(rect,point) {
  if(!rect||phase!=='shown')return false;
  const x=(point.x-monitor.bounds.x)/config.scale,y=(point.y-monitor.bounds.y)/config.scale;
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
const CONTROLS = ['settings', 'move', 'pin', 'refresh'];
function activateControl(name) {
  if(!visible||!CONTROLS.includes(name))return;
  const now=Date.now();if(lastControl.name===name&&now-lastControl.at<300)return;
  lastControl={name,at:now};send('control_pressed',name);
  if(name==='settings')openSettings(['available','downloading','ready','error'].includes(updates?.get().status)?'general':'accounts');
  else if(name==='move')beginMove();
  else if(name==='pin')setPinned(!pinned);
  else requestRefresh();
}
function requestRefresh() {
  const started=collector.refresh();if(started)send('refresh_started');return started;
}
function stateSnapshot() { return { sessions: [], agg: 'idle', counts: {}, lang_resolved: config?.lang === 'auto' ? 'en' : (config?.lang || 'en'), clock_24h: false }; }
function glyphs() {
  const out = {};
  for (const provider of ['claude', 'codex']) out[provider] = { kind: 'svg', svg: fs.readFileSync(path.join(uiRoot, 'glyphs', provider + '.svg'), 'utf8') };
  for (const account of accounts()) out[account.id] = out[account.base];
  return out;
}
function openSettings(tab = 'accounts') {
  if (settings && !settings.isDestroyed()) { settings.show(); settings.focus(); settings.webContents.send('event', 'settings_tab', tab); return; }
  settings = new BrowserWindow({ width: 820, height: 680, minWidth: 680, minHeight: 500, show: false, frame: false,
    backgroundColor: '#171719', icon: resource('icon.ico'), title: 'Agent Usage settings',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  secure(settings);
  settings.once('ready-to-show', () => settings.show());
  settings.on('closed', () => { settings = null; visibleUntil = Date.now() + 1800; });
  settings.loadFile(path.join(uiRoot, 'settings.html'), { query: { tab } });
}
function configureTray() {
  tray?.destroy(); tray = null;
  if (!config.tray) return;
  tray = new Tray(resource('icon.ico'));
  tray.setToolTip('Agent Usage'); tray.on('click', reveal);
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Show Agent Usage', click: reveal }, { label: 'Settings', click: () => openSettings() }, { label: 'Quit', click: () => app.quit() }]));
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
    case 'stage_bounds': stage = { x: Number(args.x) || 0, y: Number(args.y) || 0 }; return null;
    case 'set_hot': {
      const validRect=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[2]>=0&&r[3]>=0;
      hot=Array.isArray(args.rects)?args.rects.filter(validRect).slice(0,12):[];
      controls={};for(const name of CONTROLS)if(validRect(args.controls?.[name]))controls[name]=args.controls[name];
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
    case 'get_notch_slots': return config.slots;
    case 'set_notch_slots': config.slots = (Array.isArray(args.slots) ? args.slots : []).filter(s => accounts().some(a => a.id === s.provider)).map(s => ({ provider: s.provider })); save(); broadcast('notch_slots', config.slots); return config.slots;
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
    case 'set_notch_buttons': for (const key of ['pin', 'refresh']) if (typeof args[key] === 'boolean') config.buttons[key] = args[key]; save(); broadcast('notch_buttons', config.buttons); return config.buttons;
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
    case 'set_notch_monitor': { const d = screen.getAllDisplays().find(d => String(d.id) === args.id); if (!d) throw new Error('Display no longer attached'); useMonitor(d); visible = true; place(); raise(); if (!win.isVisible()) win.showInactive(); visibleUntil = Date.now() + 1800; sendLayout(); send('appear', { edge: config.edge }); save(); return null; }
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
    case 'set_collector': enumValue(args.source, ['wsl','ssh']); if (args.source === 'ssh' && !validHost(args.sshTarget)) throw new Error('Use an SSH host or user@host'); config.source = args.source; config.sshTarget = String(args.sshTarget || ''); save(); restartCollector(); return null;
    case 'set_shortcut': registerShortcut(args.shortcut); hotkeyProblem = ''; save(); return config.shortcut;
    case 'open_settings': openSettings(); return null;
    case 'close_settings': settings?.close(); return null;
    case 'refresh_ring': requestRefresh(); return false;
    case 'show_notch_menu': return contextMenu();
    case 'begin_move': case 'drag_begin': beginMove(); return null;
    case 'open_data_dir': await shell.openPath(app.getPath('userData')); return null;
    case 'quit_app': app.quit(); return null;
    case 'report_dpr': case 'log_js': case 'notch_hidden': return null;
    default: throw new Error('This feature is not supplied by the remote collector');
  }
});
app.on('window-all-closed', () => {});
app.on('before-quit', () => { clearInterval(timer); clearTimeout(transferTimer); globalShortcut.unregisterAll(); input?.kill(); collector?.close(); feed?.close(); updates?.close(); });
