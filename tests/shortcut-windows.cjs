'use strict';
// Real Windows input -> shipped helper/Electron shortcut -> real notch renderer.
// Only collector data is stubbed; no simulated shortcut callbacks or renderer events.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');
if(!process.versions.electron){
  const result=spawnSync(require('../desktop/node_modules/electron'),[__filename],{stdio:'inherit',timeout:90000});
  if(result.error)console.error(result.error.message);
  process.exit(result.status??1);
}
const electron=require('electron'),{app}=electron,{Module}=require('node:module'),{EventEmitter}=require('node:events');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'agent-usage-shortcut-'));
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
  main.input.on('exit',(code,signal)=>console.log('Native helper exit:',code,signal));
  const injectorPath=path.join(temporary,'keys.ps1');
  fs.writeFileSync(injectorPath,`Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ShortcutKeys {
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort key,scan; public uint flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x,y; public uint data,flags,time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct Union { [FieldOffset(0)] public Keyboard keyboard; [FieldOffset(0)] public Mouse mouse; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Union value; }
  [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint count,Input[] input,int size);
  public static void Send(ushort key,bool up) {
    Input input=new Input();input.type=1;input.value.keyboard.key=key;input.value.keyboard.flags=up?2u:0u;
    if(SendInput(1,new Input[]{input},Marshal.SizeOf(typeof(Input)))!=1)throw new Exception("SendInput failed: "+Marshal.GetLastWin32Error());
  }
}
'@
[Console]::WriteLine('ready')
while ($null -ne ($line = [Console]::ReadLine())) {
  $parts = $line.Split(' ')
  [ShortcutKeys]::Send([ushort]$parts[0], $parts[1] -eq 'up')
  [Console]::WriteLine('sent ' + $line)
}
`);
  injector=spawn('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',injectorPath],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',errors='';injector.stdout.on('data',data=>output+=data);injector.stderr.on('data',data=>errors+=data);
  await until(()=>output.includes('ready'),'Windows input injector did not start: '+errors);
  async function key(code,up=false){const token=`${code} ${up?'up':'down'}`,offset=output.length;injector.stdin.write(token+'\n');await until(()=>output.slice(offset).includes('sent '+token),'Input injection failed: '+errors);}
  const showing=()=>main.window.webContents.executeJavaScript('sessionSwitcherShowing() && document.activeElement === card.querySelector(".session-search")');
  const nativeLog=()=>console.log('Native reports:',JSON.stringify(helperLines.join('')));
  await wait(300);
  await key(0x91);
  try{await until(()=>helperLines.join('').includes('100'),'Windows runner did not deliver a plain Scroll Lock press to the helper');}catch(error){nativeLog();throw error;}
  await key(0x91,true);await wait(300);console.log('PASS: Windows runner delivers real Scroll Lock input');
  for(const control of [0xa2,0xa3]){
    main.hide();await wait(600);
    await key(control);await key(0x91);
    try{await until(showing,'Ctrl + Scroll Lock did not open and focus Sessions from a hidden notch');}catch(error){nativeLog();console.log(await main.window.webContents.executeJavaScript('({shown,tracking:window.agentTracking,pending:switcherPending,placing,card:card.className})'));throw error;}
    await wait(500);assert.equal(await showing(),true,'holding the chord must not close Sessions');
    await key(0x91,true);await key(control,true);await wait(200);
    await key(control);await key(0x91);await key(0x91,true);await key(control,true);
    await until(async()=>!await main.window.webContents.executeJavaScript('sessionSwitcherShowing()'),'Second chord did not close Sessions');
    console.log('PASS: '+(control===0xa2?'left':'right')+' Ctrl + Scroll Lock opens hidden Sessions, focuses search, ignores repeats and closes');
  }
  assert.match(helperLines.join(''),/010/,'the compiled native helper must report the session chord');
  console.log('PASS: real compiled Windows input helper reports Ctrl + Scroll Lock');
  injector.kill();app.emit('before-quit');fs.rmSync(temporary,{recursive:true,force:true});app.exit(0);
}).catch(error=>{
  console.error(error);injector?.kill();app.emit('before-quit');app.exit(1);
});
