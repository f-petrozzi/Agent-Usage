'use strict';
// Native Windows message -> compiled helper -> real main process and notch renderer.
// SendInput additionally checks physical chords when the runner has an interactive desktop.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
if(!process.versions.electron){
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-shortcut-'));
  const result=spawnSync(require('../desktop/node_modules/electron'),[__filename,temporary],{stdio:'inherit',timeout:90000});
  if(result.error)console.error(result.error.message);
  // Chromium keeps its profile files open until Electron exits.
  fs.rmSync(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  process.exit(result.status??1);
}
const electron=require('electron'),{app}=electron,{Module}=require('node:module'),{EventEmitter}=require('node:events');
const temporary=process.argv[2];
app.setPath('appData',temporary);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let injector,main;
async function until(check,label){
  const limit=Date.now()+7000;
  while(Date.now()<limit){if(await check())return;await wait(50);}
  const log=path.join(temporary,'Agent Usage','notch-diagnostics.log');
  if(fs.existsSync(log))console.error(fs.readFileSync(log,'utf8'));
  throw new Error(label);
}
app.whenReady().then(async()=>{
  const collectorPath=path.resolve(__dirname,'../desktop/collector.cjs'),collector=require(collectorPath);
  class Collector extends EventEmitter{constructor(){super();this.accounts=[];}refresh(){}close(){}}
  class SessionFeed extends EventEmitter{constructor(){super();this.sessions=[];}start(){}close(){}}
  const source=path.resolve(__dirname,'../desktop/main.cjs'),subject=new Module(source);
  subject.filename=source;subject.paths=Module._nodeModulePaths(path.dirname(source));
  const original=subject.require.bind(subject);
  const appProxy=new Proxy(app,{get(target,name){if(name==='whenReady')return()=>new Promise(()=>{});const value=target[name];return typeof value==='function'?value.bind(target):value;}});
  subject.require=id=>id==='electron'?{...electron,app:appProxy}:id==='./collector.cjs'?{...collector,Collector,SessionFeed,readSessionHistory:async()=>({sessions:[]})}:original(id);
  subject._compile(fs.readFileSync(source,'utf8')+'\nmodule.exports={start,hide,get window(){return win;},get input(){return input;},get phase(){return phase;}};',source);
  main=subject.exports;await main.start();
  const helperLines=[];main.input.stdout.on('data',data=>helperLines.push(data.toString()));
  let helperStatus='';main.input.stderr.on('data',data=>helperStatus+=data);
  main.input.on('exit',(code,signal)=>console.log('Native helper exit:',code,signal));
  const injectorPath=path.join(temporary,'keys.ps1');
  fs.writeFileSync(injectorPath,`$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShortcutKeys {
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Union { [FieldOffset(0)] public Keyboard keyboard; [FieldOffset(0)] public Mouse mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Union value; }
  [DllImport("user32.dll",SetLastError=true)] public static extern bool SetCursorPos(int x,int y);
  public static void Move(int x,int y) { if(!SetCursorPos(x,y))throw new Exception("SetCursorPos failed"); }
  [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint count,Input[] input,int size);
  [DllImport("user32.dll",SetLastError=true)] public static extern bool PostThreadMessage(uint thread,uint message,UIntPtr word,IntPtr data);
  public static void Hotkey(uint thread) { if(!PostThreadMessage(thread,0x312,new UIntPtr(1),new IntPtr(0x910002)))throw new Exception("PostThreadMessage failed: "+Marshal.GetLastWin32Error()); }
  public static void Send(ushort key,bool up) {
    Input input=new Input();input.type=1;input.value.keyboard.key=key;input.value.keyboard.flags=up?2u:0u;
    if(SendInput(1,new Input[]{input},Marshal.SizeOf(typeof(Input)))!=1)throw new Exception("SendInput failed: "+Marshal.GetLastWin32Error());
  }
}
'@
[Console]::WriteLine('ready')
while ($null -ne ($line = [Console]::ReadLine())) {
  $parts = $line.Split(' ')
  if ($parts[0] -eq 'hotkey') { [ShortcutKeys]::Hotkey([System.UInt32]$parts[1]) }
  elseif ($parts[0] -eq 'move') { [ShortcutKeys]::Move([int]$parts[1], [int]$parts[2]) }
  else { [ShortcutKeys]::Send([System.UInt16]$parts[0], $parts[1] -eq 'up') }
  [Console]::WriteLine('sent ' + $line)
}
`);
  injector=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',injectorPath],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',errors='';injector.stdout.on('data',data=>output+=data);injector.stderr.on('data',data=>{errors+=data;console.error(data.toString());});
  await until(()=>output.includes('ready'),'Windows input injector did not start: '+errors);
  async function key(code,up=false){const token=`${code} ${up?'up':'down'}`,offset=output.length;injector.stdin.write(token+'\n');await until(()=>output.slice(offset).includes('sent '+token),'Input injection failed: '+errors);}
  const showing=()=>main.window.webContents.executeJavaScript('sessionSwitcherShowing() && document.activeElement === card.querySelector(".session-search")');
  const nativeLog=()=>console.log('Native reports:',JSON.stringify(helperLines.join('')));
  await until(()=>/sessions-ready hotkey=1 hook=[01] thread=\d+/.test(helperStatus),'Native Windows hotkey did not register');
  await until(()=>/pointer-ready hook=1/.test(helperStatus),'Native pointer hook did not register');
  const thread=helperStatus.match(/thread=(\d+)/)[1];
  async function hotkey(){const token='hotkey '+thread,offset=output.length;injector.stdin.write(token+'\n');await until(()=>output.slice(offset).includes('sent '+token),'Native message injection failed: '+errors);}
  main.hide();await wait(600);await hotkey();
  try{await until(showing,'Native WM_HOTKEY did not open and focus Sessions from a hidden notch');}catch(error){nativeLog();console.log('Native status:',helperStatus,'Injector errors:',errors);console.log(await main.window.webContents.executeJavaScript('({shown,tracking:window.agentTracking,pending:switcherPending,placing,card:card.className})'));throw error;}
  await wait(500);assert.equal(await showing(),true,'one native hotkey must open exactly once');
  await hotkey();await until(async()=>!await main.window.webContents.executeJavaScript('sessionSwitcherShowing()'),'Second native hotkey did not close Sessions');
  assert.match(helperLines.join(''),/010/,'the compiled helper must report the native session chord');
  console.log('PASS: native Windows registration, message loop, compiled helper pipe, hidden reveal, search focus and toggle close');
  await wait(300);
  await main.window.webContents.executeJavaScript("holdCard(agentAccounts[0].id);pill.querySelector('.cell').focus()");
  await hotkey();await until(showing,'Sessions must replace an open account card on the first chord');
  await wait(250);await hotkey();await until(async()=>!await main.window.webContents.executeJavaScript('sessionSwitcherShowing()'),'Sessions must toggle closed after replacing an account');
  console.log('PASS: native shortcut replaces the focused gauge card on the first press');
  await wait(300);
  await key(0x91);
  await wait(300);
  const interactive=helperLines.join('').includes('100');
  if(interactive){
    const originalPoint=electron.screen.getCursorScreenPoint(),display=electron.screen.getPrimaryDisplay();
    const destination=electron.screen.dipToScreenPoint({x:display.bounds.x+100,y:display.bounds.y+100});
    const token=`move ${destination.x} ${destination.y}`,offset=helperLines.join('').length;injector.stdin.write(token+'\n');
    await until(()=>new RegExp('pointer '+destination.x+' '+destination.y+' \\d+').test(helperLines.join('').slice(offset)),'Compiled helper did not emit timestamped pointer coordinates while held');
    const restore=electron.screen.dipToScreenPoint(originalPoint);injector.stdin.write(`move ${restore.x} ${restore.y}\n`);
    console.log('PASS: compiled pointer hook streams timestamped physical coordinates while held');
  }
  await key(0x91,true);await wait(300);if(interactive)console.log('PASS: Windows runner delivers real Scroll Lock input');
  if(!interactive)console.log('SKIP: physical SendInput checks; the runner has no interactive keyboard desktop (native message-to-renderer checks passed)');
  for(const control of interactive?[0xa2,0xa3]:[]){
    main.hide();await wait(600);
    await key(control);await key(0x91);
    try{await until(showing,'Ctrl + Scroll Lock did not open and focus Sessions from a hidden notch');}catch(error){nativeLog();console.log(await main.window.webContents.executeJavaScript('({shown,tracking:window.agentTracking,pending:switcherPending,placing,card:card.className})'));throw error;}
    await wait(500);assert.equal(await showing(),true,'holding the chord must not close Sessions');
    await key(0x91,true);await key(control,true);await wait(200);
    await key(control);await key(0x91);await key(0x91,true);await key(control,true);
    await until(async()=>!await main.window.webContents.executeJavaScript('sessionSwitcherShowing()'),'Second chord did not close Sessions');
    await wait(250);await hotkey();await until(showing,'Sessions did not reopen for the follow check');await wait(200);
    await key(0x91);await until(async()=>!await main.window.webContents.executeJavaScript('sessionSwitcherShowing()'),'Scroll Lock alone did not close Sessions');
    await until(async()=>await main.window.webContents.executeJavaScript('window.agentTracking && detailOpen===0'),'Scroll Lock did not follow after the fluid close');
    assert.equal(main.window.isFocusable(),false,'carry mode releases keyboard focus');
    await key(0x91,true);await until(async()=>!await main.window.webContents.executeJavaScript('window.agentTracking'),'releasing Scroll Lock did not stop following');
    console.log('PASS: '+(control===0xa2?'left':'right')+' Ctrl + Scroll Lock opens hidden Sessions, focuses search, ignores repeats and closes');
  }
  injector.kill();app.emit('before-quit');app.exit(0);
}).catch(error=>{
  console.error(error);injector?.kill();app.emit('before-quit');app.exit(1);
});
