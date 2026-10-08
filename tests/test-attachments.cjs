'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {attachment,readFiles,readClipboard,createDraft,publicDraft,transport,deliver,REMOTE}=require('../desktop/attachments.cjs');
const uuid='12345678-1234-1234-1234-123456789abc';
test('modern asynchronous clipboard images are bounded and validated before staging',async()=>{
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,1]);
 const clipboard={read:async()=>[{types:['image/png'],getType:async()=>new Blob([bytes],{type:'image/png'})}]};
 const files=await readClipboard(clipboard);assert.equal(files[0].name,'Screenshot.png');assert.equal(files[0].image,'png');assert.deepEqual(files[0].bytes,bytes);
 await assert.rejects(readClipboard({read:async()=>[]}),/Copy a screenshot/);
 await assert.rejects(readClipboard({read:async()=>[{types:['image/png'],getType:async()=>({size:8388609})}]}),/8 MB/);
 await assert.rejects(readClipboard({read:async()=>[{types:['image/png'],getType:async()=>new Blob(['invalid'])}]}),/Save it as PNG/);
});
test('file staging is bounded and copies bytes before the source changes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'agent-drop-'));
  try{
    const name=path.join(root,'design.png');await fs.writeFile(name,Buffer.from([137,80,78,71,13,10,26,10,1]));
    const files=await readFiles([name]);await fs.writeFile(name,'changed');
    assert.equal(files[0].image,'png');assert.equal(files[0].bytes.length,9);
    const draft=createDraft('codex-a','ssh:home',files),view=publicDraft(draft);
    assert.equal(view.files[0].name,'design.png');assert.match(view.files[0].preview,/^data:image\/png;base64,/);assert.equal(view.bytes,undefined);
    await assert.rejects(readFiles([root]),/folders/);
    await assert.rejects(readFiles(Array(6).fill(name)),/five/);
    await assert.rejects(readFiles(['relative.txt']),/computer/);
    assert.throws(()=>attachment('x',Buffer.alloc(8388609)),/8 MB/);
    assert.throws(()=>attachment('x',Buffer.alloc(0)),/nonempty/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('SSH and WSL transport keep file contents and session metadata out of shell arguments',()=>{
  const ssh=transport({source:'ssh',sshTarget:'fab@host'},'win32');assert.equal(ssh[0],'ssh.exe');assert.equal(ssh[1].at(-2),'fab@host');assert.match(ssh[1].at(-1),/^python3 -c '/);
  const wsl=transport({source:'wsl',wslDistro:'Ubuntu-24.04'});assert.deepEqual(wsl[1].slice(0,5),['--distribution','Ubuntu-24.04','--exec','python3','-c']);
  assert.throws(()=>transport({source:'ssh',sshTarget:'host; touch /tmp/x'}),/valid/);
});
test('native Codex queue receives exact account, session, message, and image paths without shell injection',async()=>{
  if(process.platform==='win32')return; // Python transport is exercised on Linux CI; Windows tests validate argv above.
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'agent-drop-queue-'));
  try{
    const cwd=path.join(root,"workspace ' & spaces"),home=path.join(root,'account-b'),bin=path.join(root,'.local/bin');
    await fs.mkdir(cwd);await fs.mkdir(home);await fs.mkdir(bin,{recursive:true});
    await fs.writeFile(path.join(bin,'codex'),`#!/usr/bin/python3\nimport json,os,sys\nif '--help' in sys.argv:\n print('--thread --image')\nelse:\n open(os.path.join(os.environ['HOME'],'receipt.json'),'w').write(json.dumps({'args':sys.argv[1:],'home':os.environ.get('CODEX_HOME'),'cwd':os.getcwd()}))\n`,{mode:0o700});
    const launch=(_exe,_args,options)=>spawn('python3',['-c',REMOTE],{...options,env:{...process.env,HOME:root,PATH:'/usr/bin:/bin'}});
    const target={source:'ssh',sshTarget:'home',provider:'codex',sessionId:uuid,cwd,agentHome:home};
    const draft=createDraft('codex-b','ssh:home',[attachment('$(touch hacked).png',Buffer.from([137,80,78,71,13,10,26,10,1])),attachment('context.txt',Buffer.from('file context'))]);
    const result=await deliver(draft,target,{queue:true,message:'Review `literal` $text',launch});
    const receipt=JSON.parse(await fs.readFile(path.join(root,'receipt.json'),'utf8'));
    assert.equal(receipt.home,home);assert.equal(receipt.cwd,cwd);assert.equal(receipt.args[receipt.args.indexOf('--thread')+1],uuid);
    assert.match(receipt.args[receipt.args.indexOf('--message')+1],/^Review `literal` \$text/);
    assert.deepEqual(receipt.args.slice(-2),['--image',result.paths[0]]);assert.equal(result.queued,true);
    assert.equal(await fs.readFile(result.paths[1],'utf8'),'file context');
    assert.equal((await fs.stat(result.paths[0])).mode&0o777,0o600);assert.ok(result.paths.every(p=>p.startsWith(cwd+path.sep)));
    await fs.rm(path.join(root,'receipt.json'));
    const copied=await deliver(draft,{...target,provider:'claude'},{launch});assert.equal(copied.queued,false);await assert.rejects(fs.stat(path.join(root,'receipt.json')),/ENOENT/);
    await assert.rejects(deliver(draft,{...target,provider:'claude'},{queue:true,launch}),/Copy context/);
    await assert.rejects(deliver(draft,{...target,cwd:'relative'},{launch}),/Reload/);
    await fs.writeFile(path.join(bin,'codex'),'#!/usr/bin/python3\nprint("old cli")\n',{mode:0o700});
    const before=await fs.readdir(cwd);await assert.rejects(deliver(draft,target,{queue:true,launch}),/Update Codex/);assert.deepEqual(await fs.readdir(cwd),before,'unsupported queue does not transfer files');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
