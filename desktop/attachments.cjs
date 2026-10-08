'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { validHost, validLinuxPath } = require('./collector.cjs');
const LIMIT = 8 * 1024 * 1024, MAX_FILES = 5;
function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (bytes.subarray(0,4).toString() === 'RIFF' && bytes.subarray(8,12).toString() === 'WEBP') return 'webp';
  return '';
}
function attachment(name, bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > LIMIT) throw new Error('Choose nonempty files up to 8 MB each.');
  const clean = path.basename(name).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, '').slice(0,120) || 'attachment';
  return { name: clean, bytes, image: imageType(bytes), size: bytes.length };
}
async function readFiles(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > MAX_FILES) throw new Error('Drop up to five files at a time.');
  const files = [];
  for (const filename of paths) {
    if (typeof filename !== 'string' || !path.isAbsolute(filename)) throw new Error('Drop a file from your computer.');
    const file = await fs.open(filename, constants.O_RDONLY | (constants.O_NONBLOCK || 0));
    try {
      const stat = await file.stat();
      if (!stat.isFile() || !stat.size || stat.size > LIMIT) throw new Error('Choose files up to 8 MB each; folders cannot be attached.');
      // Bounded read even if another process grows a file after stat.
      const bytes = Buffer.alloc(stat.size + 1), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== stat.size) throw new Error('A file changed while being attached. Drop it again.');
      files.push(attachment(filename, bytes.subarray(0, bytesRead)));
    } finally { await file.close(); }
  }
  return files;
}
async function readClipboard(clipboard) {
  const items = await clipboard.read();
  for (const type of ['image/png','image/jpeg','image/webp']) {
    const item = items.find(item => item.types.includes(type));
    if (!item) continue;
    const blob = await item.getType(type);
    if (!blob.size || blob.size > LIMIT) throw new Error('Choose screenshots up to 8 MB.');
    const bytes = Buffer.from(await blob.arrayBuffer()),image = imageType(bytes);
    if (!image) throw new Error('The clipboard image could not be read. Save it as PNG and drop the file.');
    return [attachment('Screenshot.'+image,bytes)];
  }
  throw new Error('Copy a screenshot or image, then paste it here.');
}
function createDraft(account, scope, files) {
  if (!files.length || files.length > MAX_FILES) throw new Error('Attach up to five files.');
  return { token: randomBytes(24).toString('hex'), account, scope, files, at: Date.now(), busy: false, consumed: false };
}
function publicDraft(draft) {
  return { token: draft.token, account: draft.account, files: draft.files.map(f => ({ name:f.name,size:f.size,
    ...(f.image ? { preview:`data:image/${f.image === 'jpg' ? 'jpeg' : f.image};base64,${f.bytes.toString('base64')}` } : {}) })) };
}
// Fixed remote program, JSON on stdin, subprocess argv only. No renderer text enters a shell.
const REMOTE = String.raw`import base64,json,os,pathlib,shutil,subprocess,sys,tempfile
try:
 r=json.load(sys.stdin)
 cwd=pathlib.Path(r['cwd']).resolve(strict=True)
 if not cwd.is_dir(): raise ValueError('The session workspace is unavailable.')
 files=r['files']
 if not 1<=len(files)<=5: raise ValueError('Attach up to five files.')
 env=dict(os.environ)
 env['PATH']=os.path.expanduser('~/.local/bin')+':'+env.get('PATH','')
 cli=shutil.which('codex',path=env['PATH'])
 if r['queue']:
  if not cli: raise ValueError('Codex is unavailable on this host. Use Copy context & open instead.')
  env['CODEX_HOME']=r['home']
  check=subprocess.run([cli,'queue','--help'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
  if check.returncode or b'--thread' not in check.stdout or b'--image' not in check.stdout: raise ValueError('Update Codex to use Send to Codex, or use Copy context & open.')
 decoded=[]
 for i,f in enumerate(files):
  data=base64.b64decode(f['data'],validate=True)
  if not 0<len(data)<=8388608: raise ValueError('Choose files up to 8 MB each.')
  ext=f['image'] if f['image'] in ('png','jpg','webp') else 'file'
  decoded.append((str(i+1)+'.'+ext,data,f))
 folder=pathlib.Path(tempfile.mkdtemp(prefix='.agent-usage-drop-',dir=cwd))
 (folder/'.gitignore').write_text('*\n')
 paths=[]
 for name,data,f in decoded:
  p=folder/name
  p.write_bytes(data)
  p.chmod(0o600)
  paths.append(str(p))
 context=r['message'].strip() or 'Please review these attachments.'
 context+='\n\nAttachments (name and workspace path):\n'+'\n'.join(json.dumps({'name':f['name'],'path':p},ensure_ascii=False) for (_,_,f),p in zip(decoded,paths))
 if r['queue']:
  args=[cli,'queue','--thread',r['session'],'--message',context,'--cd',str(cwd)]
  for (_,_,f),p in zip(decoded,paths):
   if f['image']: args+=['--image',p]
  sent=subprocess.run(args,cwd=cwd,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=60)
  if sent.returncode: raise ValueError('Codex did not confirm delivery. Check the selected chat before trying again. Files are in '+str(folder)+'.')
 print(json.dumps({'context':context,'paths':paths,'queued':bool(r['queue'])}))
except Exception as e:
 print(str(e),file=sys.stderr)
 sys.exit(1)
`;
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
function transport(target, platform = process.platform) {
  if (target.source === 'ssh' && validHost(target.sshTarget)) return [platform === 'win32' ? 'ssh.exe' : 'ssh',
    ['-T','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=accept-new',target.sshTarget,'python3 -c '+quote(REMOTE)]];
  if (target.source === 'wsl' && /^[A-Za-z0-9._-]{1,120}$/.test(target.wslDistro || '')) return ['wsl.exe',
    ['--distribution',target.wslDistro,'--exec','python3','-c',REMOTE]];
  throw new Error('Choose a valid SSH host or WSL distribution.');
}
async function deliver(draft, target, { queue = false, message = '', launch = spawn, platform } = {}) {
  if (!validLinuxPath(target.cwd) || !validLinuxPath(target.agentHome) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(target.sessionId || '')) throw new Error('Reload sessions to recover this chat’s workspace and account.');
  if (queue && target.provider !== 'codex') throw new Error('This agent supports Copy context & open.');
  if (typeof message !== 'string' || message.length > 8000) throw new Error('Keep your message under 8,000 characters.');
  const [exe,args] = transport(target, platform);
  const payload = JSON.stringify({cwd:target.cwd,home:target.agentHome,session:target.sessionId,queue,message,
    files:draft.files.map(f=>({name:f.name,image:f.image,data:f.bytes.toString('base64')}))});
  return new Promise((resolve,reject)=>{
    const child=launch(exe,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let out='',err='',done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('Attachment delivery timed out. Check the selected chat before sending again.'));},90000);
    child.once('error',()=>finish(new Error('The connection could not start. Check SSH or WSL in Settings.')));
    child.stdin.on('error',()=>{});
    child.stdout.on('data',b=>{out+=b;if(out.length>65536){child.kill();finish(new Error('Unexpected attachment response.'));}});
    child.stderr.on('data',b=>{err=(err+b).slice(-4000);});
    child.once('close',code=>{
      if(code!==0)return finish(new Error(err.trim().replace(/[\x00-\x1f\x7f]/g,' ').slice(-600)||'The host did not confirm delivery. Check the selected chat before sending again.'));
      try{const value=JSON.parse(out);if(!Array.isArray(value.paths)||value.paths.length!==draft.files.length||typeof value.context!=='string'||value.queued!==queue)throw new Error();finish(null,value);}
      catch{finish(new Error('The host returned an invalid attachment receipt.'));}
    });
    child.stdin.end(payload);
  });
}
module.exports={LIMIT,MAX_FILES,imageType,attachment,readFiles,readClipboard,createDraft,publicDraft,REMOTE,transport,deliver};
