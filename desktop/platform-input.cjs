'use strict';
const { spawn } = require('node:child_process');
const SESSION_SHORTCUT = 'Ctrl+Scrolllock';
const shortcuts = { Scrolllock: [145, 0], 'Shift+F1': [112, 4], 'Ctrl+Shift+Space': [32, 6], F13: [124, 0], F14: [125, 0], F15: [126, 0] };
// Native monitoring is owned by this boundary. An old child cannot reset a replacement.
function createInputMonitor({ executable, owner, launch = spawn, schedule = setTimeout, cancel = clearTimeout,
  onInput, onReset, onChild = () => {}, onProblem = () => {}, diagnose = () => {} }) {
  let child = null, retry = null, startup = null, generation = 0, closed = false, ready = false, key = null, failures = 0;
  function retire() {
    generation++; cancel(retry); cancel(startup); retry = startup = null; ready = false;
    const old = child; child = null; onChild(null); onReset(); old?.kill();
  }
  function start() {
    if (closed || !key) return;
    const revision = ++generation;
    let current;
    const fail = error => {
      if (revision !== generation || closed) return;
      diagnose('sessions helper stopped ' + error.message);
      retire();
      const again = failures++ < 5;
      onProblem(again ? 'Keyboard helper stopped. Reconnecting…' : 'Keyboard helper could not reconnect. Choose the held shortcut again in Settings to retry.');
      if (again) { retry = schedule(() => { retry = null; start(); }, Math.min(16000, 1000 * 2 ** (failures - 1))); retry.unref?.(); }
    };
    try { current = launch(executable, [String(owner), ...key.map(String)], { windowsHide: true, stdio: ['ignore','pipe','pipe'] }); }
    catch (error) { fail(error); return; }
    child = current; onChild(current);
    let status = '', input = '';
    startup = schedule(() => fail(new Error('readiness timed out')), 5000); startup.unref?.();
    current.stderr.on('data', data => {
      if (revision !== generation) return;
      status += data.toString();
      let end;
      while ((end = status.indexOf('\n')) >= 0) {
        const line = status.slice(0,end).trim(); status = status.slice(end+1);
        const registration = /^sessions-ready hotkey=([01]) hook=([01]) thread=\d+$/.exec(line);
        if (registration) {
          cancel(startup); startup = null; ready = registration[1] === '1' || registration[2] === '1';
          diagnose(line);
          onProblem(ready ? '' : 'Sessions shortcut could not register. Use Sessions from the notch menu.');
        } else if (/^sessions-event (hotkey|detected)$/.test(line)) diagnose(line);
      }
      if (status.length > 4096) status = '';
    });
    current.stdout.on('data', data => {
      if (revision !== generation) return;
      input += data.toString(); let end;
      while ((end = input.indexOf('\n')) >= 0) {
        const value = input.slice(0,end).trim(); input = input.slice(end+1);
        if (/^[01]{3}$/.test(value)) onInput(value);
      }
      if (input.length > 4096) input = '';
    });
    current.on('error', fail);
    current.on('exit', (code, signal) => fail(new Error('code=' + code + ' signal=' + signal)));
  }
  return {
    get ready() { return ready; },
    configure(shortcut) {
      if (!shortcuts[shortcut]) throw new Error('Unsupported shortcut');
      retire(); closed = false; failures = 0; key = shortcuts[shortcut]; start();
    },
    close() { closed = true; retire(); }
  };
}
module.exports = { createInputMonitor, shortcuts, SESSION_SHORTCUT };
