'use strict';
const api=window.agentUsage,$=id=>document.getElementById(id);
let draft,rows=[],busy=false,generation=0;
function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}
function enable(){const selected=rows.find(r=>r.id===$('sessions').value);$('copy').disabled=busy||!selected;$('send').disabled=busy||!selected;$('sessions').disabled=busy||!rows.length;$('paste').disabled=busy;$('close').disabled=busy;$('message').disabled=busy;if(selected)$('target-note').textContent=selected.workspace+' · '+selected.sessionId.slice(0,8);}
async function show(value){
  const gen=++generation;draft=value;rows=[];status('');$('files').replaceChildren();enable();
  for(const file of value.files){const el=document.createElement('div');el.className='file';const visual=document.createElement(file.preview?'img':'div');if(file.preview){visual.src=file.preview;visual.alt=file.name;}else{visual.className='paper';visual.textContent='▤';}const name=document.createElement('p');name.textContent=file.name;el.append(visual,name);$('files').append(el);}
  try{
    const nextRows=(await api.invoke('get_session_library',{refresh:true})).filter(r=>r.account===value.account&&r.canOpen);
    if(gen!==generation)return;
    rows=nextRows;
    $('heading').textContent='Attach to '+(rows[0]?.accountName||'agent');
    $('sessions').replaceChildren();const live=rows.filter(r=>r.live),auto=live.length===1?live[0]:null;
    const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=rows.length?'Choose a chat…':'No chats found';$('sessions').append(placeholder);
    for(const row of rows){const option=document.createElement('option');option.value=row.id;option.textContent=(row.live?'Open · ':'')+(row.name||row.workspace||row.sessionId.slice(0,8));$('sessions').append(option);}
    if(auto)$('sessions').value=auto.id;
    $('target-note').textContent=auto?'Your only open chat is selected. Confirm it before sending.':'Choose a chat. The app does not guess which VS Code chat is active.';
    $('send').hidden=rows[0]?.provider!=='codex';
    if(!rows.length)status('Start a chat in this account, then drop the files again.',true);enable();if(auto)status('Your only open chat is selected. Confirm it before sending.');
  }catch(error){if(gen===generation){rows=[];status(error.message,true);enable();}}
}
async function send(queue){
  if(busy)return;busy=true;enable();status(queue?'Sending attachments…':'Preparing files and opening chat…');
  try{const result=await api.invoke('deliver_attachments',{token:draft.token,id:$('sessions').value,message:$('message').value,queue});status(result.queued?'Sent to Codex. The message is queued in the selected chat.':result.openError?(result.copied?'Context copied. ':'')+result.openError:'Context copied and chat opened. Paste into the composer, then send.',!!result.openError);if(result.queued){$('send').hidden=true;}}
  catch(error){status(error.message,true);}finally{busy=false;enable();}
}
$('sessions').addEventListener('change',enable);$('send').addEventListener('click',()=>send(true));$('copy').addEventListener('click',()=>send(false));$('close').addEventListener('click',()=>api.invoke('close_attachments'));
async function paste(){if(busy||!draft)return;try{await api.invoke('paste_attachment',{account:draft.account});}catch(error){status(error.message,true);}}
$('paste').addEventListener('click',paste);document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!busy)api.invoke('close_attachments');if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v'&&event.target.tagName!=='TEXTAREA'){event.preventDefault();paste();}});
document.addEventListener('paste',event=>{if(Array.from(event.clipboardData?.items||[]).some(item=>item.type.startsWith('image/'))){event.preventDefault();paste();}});
document.addEventListener('dragover',event=>{event.preventDefault();event.dataTransfer.dropEffect=busy?'none':'copy';document.body.classList.toggle('dragging',!busy);});
document.addEventListener('dragleave',event=>{if(!event.relatedTarget)document.body.classList.remove('dragging');});
document.addEventListener('drop',async event=>{event.preventDefault();document.body.classList.remove('dragging');if(busy)return;try{const paths=Array.from(event.dataTransfer.files).map(file=>api.filePath(file));await api.invoke('prepare_attachments',{account:draft.account,paths});}catch(error){status(error.message,true);}});
api.on('attachment_draft',show);api.invoke('get_attachment_draft').then(value=>{if(value)show(value);}).catch(error=>status(error.message,true));
