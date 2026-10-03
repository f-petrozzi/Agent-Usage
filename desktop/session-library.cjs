'use strict';
const {validHost}=require('./collector.cjs');
const {resumeUrl}=require('./session-open.cjs');
const scopeOf=config=>config.source==='ssh'?'ssh:'+config.sshTarget:'wsl:'+(config.wslDistro||'');
const keyOf=s=>s.account+':'+s.id;
function normalizePins(value){
  if(!Array.isArray(value))return [];
  const result=[],seen=new Set();
  for(const pin of value.slice(0,200)){
    if(!pin||!['ssh','wsl'].includes(pin.source)||pin.source==='ssh'&&!validHost(pin.sshTarget))continue;
    // Pins already contain desktop account ids and millisecond dates. They must never go back
    // through the collector's raw-account hashing and seconds-to-milliseconds conversion.
    if(!/^(claude|codex|gemini)_[0-9a-f]{12}$/.test(pin.account||'')||typeof pin.id!=='string'||!pin.id||pin.id.length>100||/[\x00-\x1f\x7f]/.test(pin.id))continue;
    const target={id:pin.id,account:pin.account,provider:pin.provider,sessionId:pin.sessionId,cwd:pin.cwd,agentHome:pin.agentHome,
      name:typeof pin.name==='string'?pin.name.replace(/[\x00-\x1f\x7f]/g,'').slice(0,80):'Saved chat',since:Number.isFinite(pin.since)&&pin.since>=0&&pin.since<8640000000000000?pin.since:0,
      live:false,state:'idle',source:pin.source,sshTarget:pin.source==='ssh'?pin.sshTarget:'',wslDistro:typeof pin.wslDistro==='string'?pin.wslDistro:undefined,resume:true,terminalPids:[]};
    const key=scopeOf(target)+':'+keyOf(target);
    if(!resumeUrl(target)||seen.has(key))continue;
    seen.add(key);result.push(target);if(result.length===60)break;
  }
  return result;
}
function libraryRows(history,pins,config){
  const current=normalizePins(pins).filter(s=>scopeOf(s)===scopeOf({...config,wslDistro:history.wslDistro})),saved=new Map(current.map(s=>[keyOf(s),s]));
  for(const s of history.sessions)saved.set(keyOf(s),{...s,source:config.source,sshTarget:config.sshTarget,wslDistro:history.wslDistro,resume:true});
  const pinned=new Set(current.map(keyOf));
  return [...saved.values()].map(s=>({...s,pinned:pinned.has(keyOf(s))})).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.since-a.since||keyOf(a).localeCompare(keyOf(b)));
}
function changePin(pins,target,on){
  const clean=normalizePins(pins),scope=scopeOf(target),key=keyOf(target);
  const next=clean.filter(s=>scopeOf(s)!==scope||keyOf(s)!==key);
  if(!on)return next;
  if(next.filter(s=>scopeOf(s)===scope&&s.account===target.account).length>=6)throw new Error('You can pin six chats per account. Unpin one to make room.');
  if(next.length>=60)throw new Error('Your pinned chats are full. Unpin a chat to make room.');
  const validated=normalizePins([target]);if(!validated.length)throw new Error('This session cannot be pinned without valid resume metadata.');
  return [...next,...validated];
}
function publicRow(s,account){
  return {id:s.id,account:s.account,provider:s.provider,accountName:account?.name||s.account,name:s.name,since:s.since,state:s.state,live:s.live,
    sessionId:s.sessionId,pinned:s.pinned===true,workspace:s.cwd||'',canOpen:!!resumeUrl(s)};
}
function alertResumeRow(entry,rows){
  if(!entry||!['waiting','completion'].includes(entry.kind))return null;
  const matches=rows.filter(s=>s.account===entry.account&&resumeUrl(s)&&(entry.target?.sessionId?s.sessionId===entry.target.sessionId:
    entry.kind==='completion'&&entry.session&&s.name===entry.session&&s.state==='idle'&&Number.isFinite(entry.at)&&s.since>0&&Math.abs(s.since-entry.at)<=15000));
  const unique=new Map(matches.map(s=>[s.provider+':'+s.sessionId,s]));return unique.size===1?[...unique.values()][0]:null;
}
module.exports={scopeOf,keyOf,normalizePins,libraryRows,changePin,publicRow,alertResumeRow};
