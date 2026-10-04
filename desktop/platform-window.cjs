'use strict';
// Preserve the Windows overlay policy while keeping it out of shared interaction state.
// Mac panel/Spaces/camera-notch placement will be implemented and tested in this boundary.
function overlayOptions(bounds, icon) {
  return { ...bounds, show: false, transparent: true, frame: false, resizable: false,
    icon, focusable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, backgroundColor: '#00000000' };
}
function parkedBounds(displays, monitor) {
  const left = Math.min(...displays.map(d => d.bounds.x));
  return { x: left - monitor.bounds.width - 400, y: monitor.bounds.y, width: monitor.bounds.width, height: monitor.bounds.height };
}
function initialize(win) { win.setAlwaysOnTop(true, 'screen-saver'); }
function place(win, bounds) { win.setBounds(bounds, false); }
function raise(win) { initialize(win); win.moveTop(); }
function focus(win) { win.setFocusable(true); win.setSkipTaskbar(true); win.focus(); }
function releaseFocus(win) { win.blur(); win.setFocusable(false); win.setSkipTaskbar(true); }
module.exports = { overlayOptions, parkedBounds, initialize, place, raise, focus, releaseFocus };
