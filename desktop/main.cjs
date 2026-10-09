'use strict';
const { app, BrowserWindow, ipcMain, screen, globalShortcut, Menu, nativeTheme, shell, Tray, session, contentTracing, dialog, clipboard } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const { createInputMonitor, shortcuts, SESSION_SHORTCUT } = require('./platform-input.cjs');
const { openSession, resumeUrl, prepareHelper } = require('./session-open.cjs');
const { createPerformanceCapture } = require('./performance-capture.cjs');
const { createUpdates } = require('./updates.cjs');
const windowPolicy = require('./platform-window.cjs');
const { canInstallUpdates } = require('./platform-runtime.cjs');
const { resolveSession, sessionScope } = require('./session-routing.cjs');
const attachments = require('./attachments.cjs');
const { pointerPlacement } = require('./perimeter.cjs');
const {normalizePins,libraryRows,changePin,publicRow,alertResumeRow}=require('./session-library.cjs');
const { Collector, SessionFeed, validHost, enrollAntigravity, readSessionLinks, readSessionHistory } = require('./collector.cjs');
const { alertPreferences, QuotaAlerts, SessionAlerts, orderedAccounts, trayReadings, alertLog, logAlerts } = require('./alerts.cjs');

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
let trayTimer, nativeInput, performanceCapture;
let liveSnapshot = [], liveSnapshotAt = 0, liveSnapshotScope = '';
let historyCache = null, historyPending = null, historyAt = 0, historyGeneration = 0;
let attachmentDraft, attachmentPreparation = 0, attachmentHoverUntil = 0;
let attachmentAgents = {}, pasteRegistered = false;
function pasteTarget(point) {
  if(!visible || carrying || menuOpen || switcherFocused || switcherRequested || phase !== 'shown')return null;
  return Object.keys(attachmentAgents).find(id=>controlHit(attachmentAgents[id],point)) || null;
}
function releasePasteShortcut(){if(pasteRegistered){globalShortcut.unregister('CommandOrControl+V');pasteRegistered=false;}}
function updatePasteShortcut(point){
  const account=pasteTarget(point);
  if(!account){releasePasteShortcut();return;}
  if(!pasteRegistered)pasteRegistered=globalShortcut.register('CommandOrControl+V',()=>{
    const current=pasteTarget(screen.getCursorScreenPoint());if(!current)return;
    prepareAttachments({account:current},true).catch(error=>broadcast('notice',error.message));
  });
}
async function prepareAttachments(args, paste = false) {
  if (!accounts().some(a => a.id === args.account && ['codex','claude','gemini'].includes(a.base))) throw new Error('Choose an agent logo to attach files.');
  if (attachmentDraft?.busy) throw new Error('Wait for the current attachment transfer.');
  const preparation = ++attachmentPreparation;
  // Resolve the default distro once before binding a draft to its connection.
  // Otherwise opening the first picker would change "wsl:" into "wsl:Ubuntu"
  // and immediately invalidate a screenshot the user just attached.
  if(config.source==='wsl'&&!config.lastWslDistro){
    await sessionLibrary(true);
    if(config.source!=='wsl'||!config.lastWslDistro)throw new Error('The WSL connection could not be identified. Check the connection in Settings and drop the files again.');
  }
  const scope = sessionScope(config);
  const files = paste ? await attachments.readClipboard(clipboard,{native:process.platform==='win32'?()=>attachments.readWindowsClipboard(resource('InputMonitor.exe')):null}) : await attachments.readDrop(args);
  if (preparation !== attachmentPreparation) return false;
  if (attachmentDraft?.busy) throw new Error('Wait for the current attachment transfer.');
  if (scope !== sessionScope(config)) throw new Error('The connection changed. Drop the files again.');
  attachmentDraft = attachments.createDraft(args.account, scope, files);
  reveal(false);
  sessionFollowUntil=Date.now()+1500;send('release');
  visibleUntil = Math.max(visibleUntil, Date.now()+3000);
  send('attachment_draft',attachments.publicDraft(attachmentDraft));
  return true;
}
async function deliverAttachments(args) {
  const draft = attachmentDraft;
  if (!draft || draft.token !== args.token || draft.scope !== sessionScope(config) || Date.now()-draft.at>15*60*1000) throw new Error('Drop the files again to refresh this attachment.');
  const queue = args.queue === true;
  if (draft.busy || queue && draft.consumed) throw new Error('Check the selected chat before sending again.');
  draft.busy=true;
  try {
    const rows=await sessionLibrary(true);
    if (draft !== attachmentDraft || draft.scope !== sessionScope(config)) throw new Error('The connection changed. Drop the files again.');
    const target=resolveSession({rows,config,account:draft.account,id:args.id});
    // A native queued turn is explicit. Never type arbitrary text into a terminal.
    if(queue)draft.consumed=true;
    const result=await attachments.deliver(draft,target,{queue,message:args.message});
    if(queue)return {queued:true};
    if(draft.scope!==sessionScope(config))return {queued:false,openError:'The connection changed. Files were prepared on the original host; choose that connection before opening the session.'};
    await clipboard.writeText(result.context);
    if(draft.scope!==sessionScope(config))return {queued:false,copied:true,openError:'The connection changed. Context is copied; choose the original host before opening this chat.'};
    try { await openResolvedSession({account:draft.account,id:args.id}); return {queued:false,copied:true}; }
    catch(error){return {queued:false,copied:true,openError:error.message};}
  } finally { draft.busy=false; }
}
async function recentHistory(refresh = false) {
  if (!refresh && historyCache && Date.now() - historyAt < 60000) return historyCache;
  if (historyPending) return historyPending;
  const generation = historyGeneration;
  const pending = readSessionHistory({ ...config }).then(value => {
    if (generation !== historyGeneration) throw new Error('Collector changed. Open history again.');
    historyCache = value; historyAt = Date.now(); return value;
  }).finally(() => { if (historyPending === pending) historyPending = null; });
  historyPending = pending; return pending;
}
let visible = false, held = false, mouseDown = false, carrying = false, dismissed = false;
// alerting: the page is showing an alert, which decides for itself how long it stays (notify.js); expanded: a card
// is open, and the notch never goes before it has closed
let expanded = false, alerting = false, pinned = false, menuOpen = false, visibleUntil = 0, monitor, cursor, stage = { x: 0, y: 0 }, hot = [], inside = false;
let nativePointerAt = 0;
let controls = {}, lastControl = { name: '', at: 0 }, lastCursor = '';
let notificationTestAccount = null;
let switcherRequested=false,switcherFocused=false,sessionKeyHeld=false,sessionShortcutAt=0,sessionShortcutSource='',sessionFollowUntil=0;
function registerSessionShortcut(){
  // Windows owns this chord in InputMonitor's native message loop. Registering it twice
  // makes the helper lose WM_HOTKEY ownership and depend entirely on sampled key state.
  if(process.platform==='win32')return nativeInput?.ready === true;
  return globalShortcut.register(SESSION_SHORTCUT,()=>triggerSessionShortcut('electron'));
}
function triggerSessionShortcut(source){
  const now=Date.now();
  // The native monitor also catches this key when Windows refuses Electron's registration.
  // Coalesce those two reports and ignore the OS's repeat while the physical key stays down.
  if(source==='electron'&&sessionKeyHeld||source!==sessionShortcutSource&&now-sessionShortcutAt<150)return;
  sessionShortcutAt=now;sessionShortcutSource=source;
  diagnose('sessions shortcut '+source+' '+(switcherFocused||switcherRequested?'close':'open'));
  if(switcherFocused||switcherRequested){switcherRequested=false;send('session_switcher',false);releaseSwitcherFocus();return;}
  openSessionSwitcher();
}
function focusSwitcher(){
  if(!win||win.isDestroyed())return;
  // Electron makes a focusable Windows window a taskbar tab. Restore the overlay policy before focusing.
  switcherFocused=true;windowPolicy.focus(win);
}
function releaseSwitcherFocus(){
  if(!switcherFocused)return;
  switcherFocused=false;if(win&&!win.isDestroyed())windowPolicy.releaseFocus(win);
}
function openSessionSwitcher(){
  sessionFollowUntil=0;switcherRequested=true;reveal(false);visibleUntil=Math.max(visibleUntil,Date.now()+3000);
  send('session_switcher',true);
}
async function sessionLibrary(refresh=false){
  let history;
  try{history=await recentHistory(refresh);if(config.source==='wsl'&&history.wslDistro!==config.lastWslDistro){config.lastWslDistro=history.wslDistro;save();broadcast('session_pins',currentSessionPins());}}
  catch(error){
    history=historyCache||{sessions:[],wslDistro:config.lastWslDistro};
    if(!libraryRows(history,config.sessionPins,config).length)throw error;
  }
  return libraryRows(history,config.sessionPins,config);
}
async function openResolvedSession(identity, alert = null) {
  const scope = sessionScope(config);
  const matches = s => s.account === identity.account && (identity.sessionId ? s.sessionId === identity.sessionId : s.id === identity.id);
  // A heartbeat is fresh for one 15 s feed period plus transport allowance. Only
  // collector-verified writer ancestry permits bypassing history; focusOnly cannot spawn.
  const age=Date.now()-liveSnapshotAt;
  const fresh=liveSnapshotScope===scope&&age>=0&&age<20000;
  const live=fresh&&liveSnapshot.find(s=>matches(s)&&s.terminalPids?.some(pid=>Number.isInteger(pid)&&pid>1));
  if(live&&accounts().some(a=>a.id===identity.account)){
    const target=resolveSession({rows:[],active:[live],config,...identity});
    target.focusOnly=true;
    releaseSwitcherFocus();return openSession(target,shell,{validateTarget:()=>{if(scope!==sessionScope(config))throw new Error('Collector changed. Open Sessions and try again.');}});
  }
  let active = [...(sessionAlerts.previous?.values() || []), ...(feed?.sessions || [])], rows;
  try { rows = await sessionLibrary(true); }
  catch (error) { if (!active.some(matches)) throw error; rows = []; }
  if (scope !== sessionScope(config)) throw new Error('Collector changed. Open Sessions and try again.');
  if (alert) {
    const saved = alertResumeRow(alert, rows);
    if (saved) identity = {account:saved.account,id:saved.id};
    else if (!identity.sessionId) throw new Error('This notification’s session is no longer available. Open Sessions to find the chat.');
  }
  if (!rows.some(matches) && (alert?.target?.sessionId || active.some(matches))) {
    active = await readSessionLinks({...config});
    if (scope !== sessionScope(config)) throw new Error('Collector changed. Open Sessions and try again.');
  }
  const target = resolveSession({rows,active,config,...identity});
  releaseSwitcherFocus();return openSession(target,shell,{validateTarget:()=>{if(scope!==sessionScope(config))throw new Error('Collector changed. Open Sessions and try again.');}});
}
function currentSessionPins(){
  return normalizePins(config.sessionPins).filter(s=>s.source===config.source&&(s.source==='ssh'?s.sshTarget===config.sshTarget:s.wslDistro===config.lastWslDistro)).map(s=>({id:s.id,account:s.account}));
}
/** Native visibility and transfer phase; panel and input state remain independent.
 * @type {'hidden'|'hiding'|'shown'|'transfer'} */
let phase = 'hidden', frameReady = false, hotkeyProblem = '', lastRaise = 0, replacements = 0, pageViewport = null, lastPlacedAt = 0;
let placementTimer = null, placementFailures = 0;
let placementSerial = 0, pendingPlacement = null, pendingPlacementEdge = null, pendingPlacementStage = null, pendingPlacementAtPointer = false;
const uiRoot = path.join(__dirname, 'ui');
const absent = () => ({ status: 'absent', windows: [], fetched_at: 0, note: '' });
const placeholder = () => ({ id: 'collector', base: 'claude', name: 'Agent Usage', glyph: '…', snap: { ...absent(), status: 'loading', note: 'Reading your collector…', details: [] } });
const accounts = () => {
  const values = collector?.accounts.length ? collector.accounts : [placeholder()];
  const order = config?.accountOrder || [];
  const rank = id => order.includes(id) ? order.indexOf(id) : order.length;
  return [...values].sort((a, b) => rank(a.id) - rank(b.id)).map(a=>({...a,originalName:a.name,alias:config?.accountAliases?.[a.id]||'',name:config?.accountAliases?.[a.id]||a.name}));
};
const broadcast = (name, payload) => { for (const w of [win, settings]) if (w && !w.isDestroyed()) w.webContents.send('event', name, payload); };
const send = (name, payload) => { if (win && !win.isDestroyed()) win.webContents.send('event', name, payload); };
// One line per placement (and per press that missed every control), so a placement that lands somewhere else can be read
// back from a real Windows session. Capped; holds only geometry and shortcut actions.
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
  config.sessionPins=normalizePins(config.sessionPins);
  config.appearance=appearancePreferences(config.appearance);
  config.accountAliases=accountAliases(config.accountAliases);
  config.focusAccounts=normalizeFocusAccounts(config.focusAccounts??(config.focusAccount?[config.focusAccount]:[]));
  delete config.focusAccount;
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
  win = new BrowserWindow({ ...windowPolicy.overlayOptions(monitor.bounds, resource('icon.ico')),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true,
      nodeIntegration: false, backgroundThrottling: false, spellcheck: false,
      // The alert chime is synthesised in the page, and an overlay nobody clicks never has a gesture to start audio
      autoplayPolicy: 'no-user-gesture-required' } });
  secure(win); win.setIgnoreMouseEvents(true, { forward: true });
  windowPolicy.initialize(win);
  win.webContents.setZoomFactor(config.scale);
  // Install the bundled UI helper before the app appears, so reloading an already-open Code window after
  // updating the app loads the new helper even before the first history click. Clicks still retry failures.
  if(process.platform==='win32'&&app.isPackaged)await prepareHelper().catch(()=>{});
  await win.loadFile(path.join(uiRoot, 'notch.html'));
  place(); win.showInactive(); // its one show happens parked, off every screen
  updates = createUpdates({ app, updater: require('electron-updater').autoUpdater,
    installed: canInstallUpdates({packaged: app.isPackaged, exists: fs.existsSync, resource}),
    onChange: state => {
      if(['available','ready','error'].includes(state.status)){
        reveal(false);visibleUntil=Math.max(visibleUntil,Date.now()+6500);
      }
      broadcast('update_state',state);
    },
    beforeInstall: () => { save(); }
  });
  updates.start();
  performanceCapture=createPerformanceCapture({tracing:contentTracing,onChange:value=>broadcast('performance_capture',value)});
  restartCollector();
  try { registerShortcut(config.shortcut); } catch (error) { hotkeyProblem = error.message; }
  if(!registerSessionShortcut()&&process.platform!=='win32')broadcast('notice','Ctrl + Scroll Lock is already in use. Open Sessions from the notch menu.');
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
  historyCache = null; historyPending = null; historyAt = 0; historyGeneration++;
  liveSnapshot=[];liveSnapshotAt=0;liveSnapshotScope='';
  broadcast('session_history_reset', null);
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
  feed.on('snapshot', value => {
    liveSnapshot=value;liveSnapshotAt=Date.now();liveSnapshotScope=sessionScope(config);
    showAlerts(sessionAlerts.update(value, config.alerts));
  });
  feed.on('disconnected', () => {liveSnapshot=[];liveSnapshotAt=0;sessionAlerts.reset();});
  feed.start();
}
function useMonitor(display) {
  monitor = display; hot = []; controls = {}; lastCursor = ''; inside = false; config.display = String(display.id);
  place();
  sendLayout();
}
function armPlacementTimeout() {
  clearTimeout(placementTimer);
  const token = pendingPlacement;
  placementTimer = setTimeout(() => recoverPlacement(token), 4000);placementTimer.unref?.();
}
function recoverPlacement(token) {
  if (pendingPlacement !== token || token === null || !win || win.isDestroyed()) return;
  diagnose('placement timeout token=' + token + ' stage=' + pendingPlacementStage);
  if (++placementFailures <= 2) {
    pendingPlacement = ++placementSerial;pendingPlacementStage='stow';
    send('monitor_stow',{placement:pendingPlacement});armPlacementTimeout();return;
  }
  clearTimeout(placementTimer);placementTimer=null;
  pendingPlacement=null;pendingPlacementStage=null;pendingPlacementEdge=null;pendingPlacementAtPointer=false;
  visible=false;phase='hidden';dismissed=true;hot=[];controls={};alerting=false;expanded=false;switcherRequested=false;releaseSwitcherFocus();endMove();
  send('disappear');place();sendLayout();win.setOpacity(1);broadcast('ui_flags',flags());
  broadcast('notice','Display placement could not finish. Reveal the notch again to retry.');
}
function switchMonitor(display, { show = visible, atPointer = false } = {}) {
  // Clear Chromium's last painted surface before moving a settled notch to another screen.
  win.setOpacity(0); win.setIgnoreMouseEvents(true, { forward: true });
  hot = []; controls = {}; lastCursor = ''; inside = false;
  placementFailures=0;
  pendingPlacement = ++placementSerial; visible = show; phase = 'transfer'; replacements = 0;
  pendingPlacementStage = 'stow'; pendingPlacementAtPointer = atPointer;
  monitor = display; config.display = String(display.id);
  if (atPointer) {
    const at = cursorPlacement(screen.getCursorScreenPoint()); config.edge = at.edge; config.along = at.along;
  }
  pendingPlacementEdge = config.edge;
  send('monitor_stow', { placement: pendingPlacement });armPlacementTimeout();
  if (show) visibleUntil = Math.max(visibleUntil, Date.now() + 1800);
}
// Closed, the window is parked just past the leftmost screen, still shown: nothing of it is composited over
// other apps, and opening moves it back, as moving it between screens always has, with no show animation.
function parkedBounds() { return windowPolicy.parkedBounds(screen.getAllDisplays(), monitor); }
function place() { if (win && !win.isDestroyed()) windowPolicy.place(win, visible ? monitor.bounds : parkedBounds()); }
// Above the taskbar, which is also topmost and wins whenever it was raised more recently
function raise() { windowPolicy.raise(win); }
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
  releasePasteShortcut();attachmentHoverUntil=0;
  visible = false; phase = 'hiding'; pinned = false; hot = []; alerting = false; expanded = false;
  switcherRequested=false;releaseSwitcherFocus();
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
  if (!visible && !(held || carrying)) {releasePasteShortcut();return;}
  // Windows lets a topmost window sink behind the taskbar and other topmost windows; keep reasserting it
  if (visible && Date.now() - lastRaise > 2000) { lastRaise = Date.now(); raise(); }
  cursor = screen.getCursorScreenPoint();
  updatePasteShortcut(cursor);
  if(Date.now()-nativePointerAt>32)followPointer(cursor);
  const hit = visible && phase !== 'transfer' && overNotch(cursor);
  if (hit !== inside) { inside = hit; send('notch_pointer', hit); win.setIgnoreMouseEvents(!hit, { forward: true }); }
  if (hit || Date.now()<attachmentHoverUntil || alerting || expanded || menuOpen || settings?.isVisible()) visibleUntil = Math.max(visibleUntil, Date.now() + 500);
  if (visible && !pinned && !held && !carrying && !menuOpen && Date.now() > visibleUntil) hide();
}
// Fast input updates only the target; click-through, topmost and hiding stay on tick().
function followPointer(point,timestamp=null){
  if(!win||win.isDestroyed())return;
  if(Date.now()<attachmentHoverUntil)return;
  if ((held || carrying) && !switcherFocused && Date.now()>=sessionFollowUntil && !dismissed && !menuOpen) {
    reveal();
    const display = screen.getDisplayNearestPoint(point);
    if (display.id !== monitor.id && pendingPlacement === null) switchMonitor(display, { atPointer: true });
    const b = monitor.bounds;
    const at=cursorPlacement(point),edge=at.edge;
    config.edge = edge;config.along=at.along;
    const signature=`${display.id}:${point.x}:${point.y}:${edge}`;
    if (phase !== 'transfer' && signature !== lastCursor) {
      const trackingStarted=lastCursor==='';lastCursor=signature;send('edge_cursor', { x: point.x - b.x, y: point.y - b.y, edge, perimeter:at.position, tracking: true, trackingStarted, timestamp });
    }
    visibleUntil = Date.now() + 1800;
  }
}
function nativePointer(record){
  if(process.platform!=='win32'||!(held||carrying)||!win||win.isDestroyed())return;
  const point=screen.screenToDipPoint({x:record.x,y:record.y});
  if(!Number.isFinite(point.x)||!Number.isFinite(point.y))return;
  nativePointerAt=Date.now();cursor=point;followPointer(point,record.timestamp);
}
// The one test of whether a screen point is over the notch, its card or its controls, from the page's hot rectangles
function overNotch(point) {
  const origin = windowOrigin(), x = point.x - origin.x - stage.x, y = point.y - origin.y - stage.y;
  return hot.some(r => x >= r[0]*config.scale && x <= (r[0]+r[2])*config.scale && y >= r[1]*config.scale && y <= (r[1]+r[3])*config.scale);
}
function registerShortcut(value) {
  if (!shortcuts[value]) throw new Error('Unsupported shortcut');
  if (config.shortcut !== value || !globalShortcut.isRegistered(value)) {
    if (!globalShortcut.register(value, () => reveal())&&process.platform!=='win32') throw new Error(`${value} is already in use. Choose another shortcut.`);
    if (config.shortcut !== value) globalShortcut.unregister(config.shortcut);
  }
  config.shortcut = value;
  if (process.platform !== 'win32') return; // preview callback; native Mac monitoring is a separate implementation
  if (!nativeInput) nativeInput = createInputMonitor({
    executable: resource('InputMonitor.exe'), owner: process.pid, launch: spawn,
    onInput: inputLine, onPointer: nativePointer, onChild: child => { input = child; }, diagnose,
    onReset: () => { nativePointerAt=0;inputLine('000'); endMove(); },
    onProblem: problem => { hotkeyProblem = problem; if(problem)broadcast('notice',problem); }
  });
  nativeInput.configure(value);
}

function inputLine(value){
  if(!/^[01]{3}$/.test(value))return;
  const previous=held,previousMouse=mouseDown,previousSession=sessionKeyHeld;
  sessionKeyHeld=value[1]==='1';
  if(sessionKeyHeld&&!previousSession)triggerSessionShortcut('native');
  held=value[0]==='1'&&!sessionKeyHeld;mouseDown=value[2]==='1';
  if(held&&!previous&&(switcherFocused||switcherRequested)){
    switcherRequested=false;sessionFollowUntil=Date.now()+1200;send('session_follow');releaseSwitcherFocus();
  }
  if(!held)sessionFollowUntil=0;
  if(held&&!previous){dismissed=false;lastCursor='';reveal();}
  if(!held&&previous){visibleUntil=Date.now()+1800;send('release');broadcast('ui_flags',flags());save();}
  if(mouseDown&&!previousMouse&&visible&&!held&&!carrying)physicalPress(screen.getCursorScreenPoint());
  if(!mouseDown&&previousMouse)physicalRelease(screen.getCursorScreenPoint());
}
function appearancePreferences(value){return {aliases:value?.aliases===true,compactSessions:value?.compactSessions===true};}
function accountAliases(value){
  const result={};if(!value||typeof value!=='object'||Array.isArray(value))return result;
  for(const [key,text] of Object.entries(value).slice(0,40))if(key.length<=120&&typeof text==='string'&&text.trim()&&text.length<=40&&!/[\x00-\x1f\x7f]/.test(text))Object.defineProperty(result,key,{value:text.trim(),enumerable:true,writable:true,configurable:true});
  return result;
}
function normalizeFocusAccounts(value){return Array.isArray(value)?[...new Set(value.filter(id=>typeof id==='string'&&id.length<=120))].slice(0,40):[];}
function setFocusAccounts(value){
  if(!Array.isArray(value)||value.length>40||value.some(id=>!accounts().some(a=>a.id!=='collector'&&a.id===id)))throw new Error('Choose available agent accounts to focus.');
  const selected=normalizeFocusAccounts(value);
  if(config.slots?.length){for(const id of selected)if(!config.slots.some(s=>s.provider===id))config.slots.push({provider:id});broadcast('notch_slots',config.slots);}
  config.focusAccounts=selected;save();broadcast('focus_accounts',selected);return selected;
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
const CONTROLS = ['update', 'settings', 'pin', 'refresh', 'alerts'];
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
  config.alertLog = logAlerts(config.alertLog, events.map(e=>({...e,scope:sessionScope(config)}))); save(); broadcast('alert_log', config.alertLog);
  const logged = config.alertLog.slice(-events.length); // their log entries, so the page can mark the ones it showed as seen
  reveal(false);
  visibleUntil = Math.max(visibleUntil, Date.now() + 2500); // until the page has it open and says so
  send('alert', { events: events.slice(0, 8).map((e, i) => ({ id: logged[i]?.id || null, kind: e.kind, account: e.account || null, window: e.window || null,
    level: e.level || null, used: Number.isFinite(e.used) ? e.used : null, session: e.session || null, target: logged[i]?.target || null, took: Number.isFinite(e.took) ? e.took : null,
    title: e.title, body: e.body })), sound: !!config.alerts.sound, hold: ALERT_MS });
}
function contextMenu(provider) {
  menuOpen = true;
  return new Promise(resolve => Menu.buildFromTemplate([
    ...(accounts().some(a=>a.id===provider&&['codex','claude','gemini'].includes(a.base)) ? [{label:'Paste screenshot into '+accounts().find(a=>a.id===provider).name,
      click:()=>prepareAttachments({account:provider},true).catch(error=>{menuOpen=false;broadcast('notice',error.message);})},{type:'separator'}] : []),
    { label: 'Pin here', type: 'checkbox', checked: pinned, click: item => setPinned(item.checked) },
    { label: 'Sessions…   Ctrl + Scroll Lock', click:openSessionSwitcher },
    {label:'Focus accounts…',click:()=>openSettings('accounts')},
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
    case 'attachment_drag': if(event.sender===win?.webContents)attachmentHoverUntil=args.on===true?Date.now()+1200:0;return null;
    case 'prepare_attachments': return prepareAttachments(args);
    case 'paste_attachment': return prepareAttachments(args,true);
    case 'get_attachment_draft': if(event.sender!==win?.webContents)throw new Error('Open attachments first.');return attachmentDraft?attachments.publicDraft(attachmentDraft):null;
    case 'deliver_attachments': if(event.sender!==win?.webContents)throw new Error('Open attachments first.');return deliverAttachments(args);
    case 'close_attachments': if(event.sender!==win?.webContents)throw new Error('Open attachments first.');if(!attachmentDraft?.busy&&attachmentDraft?.token===args.token)attachmentDraft=null;return null;
    case 'ready': frameReady = true; sendLayout(); return null;
    case 'monitor_stowed': {
      if (event.sender !== win?.webContents || args.placement !== pendingPlacement || pendingPlacementStage !== 'stow') return false;
      // The pointer may have moved while the previous screen's surface was being cleared.
      if (pendingPlacementAtPointer) {
        const point = screen.getCursorScreenPoint(); monitor = screen.getDisplayNearestPoint(point);
        const at = cursorPlacement(point); config.edge = at.edge; config.along = at.along;
      }
      pendingPlacementEdge = config.edge; pendingPlacementStage = 'paint';
      useMonitor(monitor);armPlacementTimeout();if (visible) raise(); return true;
    }
    case 'monitor_placed': {
      if (event.sender !== win?.webContents || !Number.isInteger(args.placement) || args.placement !== pendingPlacement || pendingPlacementStage !== 'paint') return false;
      if (pendingPlacementAtPointer && visible) {
        const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        if (display.id !== monitor.id) { switchMonitor(display, { atPointer: true }); return false; }
      }
      // The shortcut may have crossed to another edge while the masked renderer was resizing.
      if (visible && pendingPlacementEdge !== config.edge) {
        pendingPlacement = ++placementSerial; pendingPlacementEdge = config.edge; sendLayout();armPlacementTimeout();return false;
      }
      // Asked to cover the monitor, the window can land elsewhere on its first move from the parked position (sized for
      // the leftmost screen) to a screen at another scale; clicks then miss everything drawn. Placed again from the screen
      // it is now on, it lands exactly, as moving it to another screen and back did by hand.
      const actual = typeof win.getBounds === 'function' ? win.getBounds() : null;
      const off = !!actual && ['x', 'y', 'width', 'height'].some(k => Math.abs(actual[k] - monitor.bounds[k]) > 1);
      diagnose(`placed display=${monitor.id} scale=${monitor.scaleFactor} monitor=${JSON.stringify(monitor.bounds)} window=${JSON.stringify(actual)} page=${JSON.stringify(pageViewport)} zoom=${config.scale}${off ? ' off' : ''}`);
      if (visible && off && replacements < 2) {
        replacements++; place(); pendingPlacement = ++placementSerial; sendLayout();armPlacementTimeout();return false;
      }
      clearTimeout(placementTimer);placementTimer=null;placementFailures=0;
      replacements = 0; lastPlacedAt = Date.now();
      pendingPlacement = null; pendingPlacementEdge = null; pendingPlacementStage = null; pendingPlacementAtPointer = false;
      phase = visible ? 'shown' : 'hidden';
      win.setOpacity(1);if(switcherRequested)send('session_switcher',true);else if(switcherFocused)win.focus();return true;
    }
    case 'stage_bounds': stage = { x: Number(args.x) || 0, y: Number(args.y) || 0 }; return null;
    case 'set_hot': {
      const validRect=r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[2]>=0&&r[3]>=0;
      hot=Array.isArray(args.rects)?args.rects.filter(validRect).slice(0,12):[];
      controls={};for(const name of CONTROLS)if(validRect(args.controls?.[name]))controls[name]=args.controls[name];
      attachmentAgents={};for(const a of accounts())if(['codex','claude','gemini'].includes(a.base)&&validRect(args.agents?.[a.id]))attachmentAgents[a.id]=args.agents[a.id];
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
    case 'get_session_history': {
      const rows=await sessionLibrary();
      return rows.filter(s=>s.account===args.account).map(s=>publicRow(s,accounts().find(a=>a.id===s.account)));
    }
    case 'get_session_library':return (await sessionLibrary(args.refresh===true)).map(s=>publicRow(s,accounts().find(a=>a.id===s.account)));
    case 'get_session_pins':return currentSessionPins();
    case 'set_session_pin':{
      if(typeof args.on!=='boolean')throw new Error('Choose whether to pin this chat.');
      const rows=await sessionLibrary(),saved=rows.find(s=>s.account===args.account&&s.id===args.id);
      if(!saved)throw new Error('This session is no longer available. Reload sessions.');
      config.sessionPins=changePin(config.sessionPins,saved,args.on);save();broadcast('session_pins',currentSessionPins());return args.on;
    }
    case 'open_session_switcher':openSessionSwitcher();return null;
    case 'session_switcher_focus':if(event.sender!==win?.webContents||!visible||pendingPlacement!==null)return false;switcherRequested=false;focusSwitcher();return true;
    case 'close_session_switcher':switcherRequested=false;releaseSwitcherFocus();return null;
    case 'session_follow_ready':if(event.sender===win?.webContents&&held){sessionFollowUntil=0;lastCursor='';}return null;
    case 'get_focus_accounts':return config.focusAccounts||[];
    case 'set_focus_accounts':return setFocusAccounts(args.accounts);
    case 'open_history_session': return openResolvedSession({account:args.account,id:args.id});
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
      const entry = alertLog(config.alertLog).find(e => e.id === args.id);
      if (!entry || !['waiting','completion'].includes(entry.kind)) return false;
      if (entry.scope && entry.scope !== sessionScope(config)) throw new Error('Choose the SSH host or WSL distribution that produced this notification, then try again.');
      return openResolvedSession({account:entry.account,sessionId:entry.target?.sessionId},entry);
    }
    case 'open_working_session': return openResolvedSession({account:args.account,id:args.id});
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
    case 'get_appearance': return appearancePreferences(config.appearance);
    case 'set_appearance': config.appearance=appearancePreferences({...config.appearance,...args});save();broadcast('appearance',config.appearance);return config.appearance;
    case 'set_account_alias': {
      if(!accounts().some(a=>a.id===args.account&&a.id!=='collector')||typeof args.alias!=='string'||args.alias.length>40||/[\x00-\x1f\x7f]/.test(args.alias))throw new Error('Use an account alias of up to 40 characters.');
      config.accountAliases=accountAliases({...config.accountAliases,[args.account]:args.alias});save();broadcast('agent_accounts',accounts());return accounts();
    }
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
    case 'get_performance_capture': return performanceCapture?.get()||{status:'idle'};
    case 'start_performance_capture': {
      if(event.sender!==settings?.webContents)throw new Error('Start performance recording from Settings.');
      if(['starting','recording','saving'].includes(performanceCapture?.get().status))return performanceCapture.get();
      const choice=await dialog.showSaveDialog(settings,{title:'Save 10-second performance recording',defaultPath:path.join(app.getPath('downloads'),'AgentUsage-Performance-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'),filters:[{name:'Performance trace',extensions:['json']}]});
      if(choice.canceled)return performanceCapture.get();
      return performanceCapture.start(choice.filePath);
    }
    case 'show_performance_capture': {
      if(event.sender!==settings?.webContents)throw new Error('Open the recording from Settings.');
      const state=performanceCapture?.get();if(state?.status==='saved')shell.showItemInFolder(state.file);return null;
    }
    case 'get_version': return app.getVersion();
    case 'get_collector': return { source: config.source, sshTarget: config.sshTarget, shortcut: config.shortcut, error: hotkeyProblem };
    case 'set_collector': {
      enumValue(args.source, ['wsl','ssh']);
      if (args.source === 'ssh' && !validHost(args.sshTarget)) throw new Error('Use an SSH host or user@host');
      const target = String(args.sshTarget || '');
      if (config.source !== args.source || config.sshTarget !== target) { quotaAlerts = new QuotaAlerts(); config.quotaWarnings = {}; }
      config.source = args.source; config.sshTarget = target; save(); restartCollector(); return null;
    }
    case 'set_shortcut': hotkeyProblem = ''; registerShortcut(args.shortcut); save(); return config.shortcut;
    case 'open_settings': openSettings(); return null;
    case 'close_settings': settings?.close(); return null;
    case 'refresh_ring': requestRefresh(); return false;
    case 'show_notch_menu': return contextMenu(args.provider);
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
app.on('before-quit', () => { clearInterval(timer); clearInterval(trayTimer);clearTimeout(placementTimer); globalShortcut.unregisterAll(); nativeInput?.close(); performanceCapture?.close(); collector?.close(); feed?.close(); updates?.close(); });
