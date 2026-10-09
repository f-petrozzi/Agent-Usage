'use strict';
// Attachments use the same held session lobe and focus lifecycle as the session switcher.
let attachmentSelection=null;
// These are format illustrations, not invented document contents. Images use
// the actual bounded bytes supplied by main; document tiles never execute files.
function attachmentFileView(file){
  const extension=file.name.lastIndexOf('.')>0?file.name.split('.').pop().toLowerCase():'';
  const formats={sheet:['xlsx','xls','xlsm','ods','csv','tsv'],document:['docx','doc','odt','rtf'],pdf:['pdf'],slides:['pptx','ppt','odp'],archive:['zip','7z','rar','tar','gz'],code:['js','ts','jsx','tsx','py','json','html','css','sh','yaml','yml'],text:['txt','md','log'],audio:['mp3','wav','flac','m4a'],video:['mp4','mov','webm','mkv'],image:['png','jpg','jpeg','webp','gif','bmp','svg','heic']};
  const kind=file.preview?'image':Object.keys(formats).find(k=>formats[k].includes(extension))||'file';
  const labels={sheet:'Spreadsheet',document:'Document',pdf:'PDF',slides:'Presentation',archive:'Archive',code:'Code',text:'Text',audio:'Audio',video:'Video',image:'Image',file:'File'};
  const drawings={sheet:'<path d="M5 10h22M5 16h22M5 22h22M12 10v18M20 10v18"/>',document:'<path d="M9 12h14M9 17h14M9 22h10"/>',pdf:'<path d="M9 12h14M9 17h9M9 22h14"/>',slides:'<path d="M9 22V12h14v10zM13 26h6M16 22v4"/>',archive:'<path d="M16 6v16M14 10h4M14 14h4M14 18h4M14 22h4v4h-4z"/>',code:'<path d="m12 12-4 5 4 5m8-10 4 5-4 5m-3-12-2 14"/>',text:'<path d="M9 12h14M9 17h14M9 22h14M9 27h8"/>',audio:'<path d="M18 10v13a3 3 0 1 1-3-3h3m0-10 5-1v4l-5 1"/>',video:'<path d="m12 11 11 7-11 7z"/>',image:'<path d="m7 24 6-8 5 6 3-4 4 6M10 11h.1"/>',file:'<path d="M9 15h14M9 21h9"/>'};
  const item=document.createElement('div');item.className='attachment-file';item.dataset.kind=kind;
  const visual=document.createElement('div');visual.className='attachment-file-visual';visual.setAttribute('aria-hidden','true');
  if(file.preview){const image=document.createElement('img');image.src=file.preview;image.alt='';visual.append(image);}
  else visual.innerHTML='<svg viewBox="0 0 32 36" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path class="file-page" d="M5 3h15l7 7v22H5zM20 3v7h7"/>'+drawings[kind]+'</svg>';
  const badge=document.createElement('span');badge.className='attachment-file-badge';badge.textContent=/^[a-z0-9]{1,6}$/.test(extension)?extension:labels[kind];visual.append(badge);
  const name=document.createElement('span');name.className='attachment-file-name';name.textContent=file.name;
  const meta=document.createElement('span');meta.className='attachment-file-meta';meta.textContent=labels[kind]+' · '+(file.size>=1024*1024?(file.size/1024/1024).toFixed(1)+' MB':file.size>=1024?Math.ceil(file.size/1024)+' KB':file.size+' B');
  item.append(visual,name,meta);return item;
}
function closeAttachmentReview(){
  if(!window.attachmentReviewDraft||window.attachmentReviewBusy)return;
  const token=window.attachmentReviewDraft.token;window.attachmentReviewDraft=null;attachmentSelection=null;
  card.classList.remove('attachment-card');card.querySelector('.attachment-preview')?.remove();card.querySelector('.attachment-compose')?.remove();
  card.querySelector('.session-filter-row')?.removeAttribute('hidden');
  const heading=card.querySelector('.session-head>span');if(heading)heading.textContent='Sessions';
  const hint=card.querySelector('.session-keyboard-hint');if(hint)hint.textContent='↑↓ Choose · Enter Open · Tab Actions';
  invoke('close_attachments',{token}).catch(()=>{});
}
function chooseAttachmentSession(row){
  if(window.attachmentReviewBusy)return;
  attachmentSelection=row;refreshAttachmentSelection();
  card.querySelector('.attachment-message')?.focus({preventScroll:true});
}
function refreshAttachmentSelection(){
  if(!window.attachmentReviewDraft)return;
  if(attachmentSelection&&!sessionMatches.some(s=>s.id===attachmentSelection.id&&s.account===attachmentSelection.account&&s.canOpen))attachmentSelection=null;
  const selected=attachmentSelection;
  for(const row of card.querySelectorAll('.session-result'))row.classList.toggle('attachment-selected',!!selected&&sessionMatches[Number(row.dataset.index)]?.id===selected.id);
  for(const button of card.querySelectorAll('.attachment-send,.attachment-copy'))button.disabled=window.attachmentReviewBusy||!selected;
  const note=card.querySelector('.attachment-target');if(note)note.textContent=window.attachmentReviewDraft.completed?'Queued in the selected session':selected?'To '+(selected.name||selected.workspace):'Choose a session to continue';
  const send=card.querySelector('.attachment-send');if(send)send.hidden=agentAccounts.find(a=>a.id===window.attachmentReviewDraft.account)?.base!=='codex';
}
function renderAttachmentReview(){
  const draft=window.attachmentReviewDraft;
  card.classList.toggle('attachment-card',!!draft);
  if(!draft||!sessionSwitcherShowing())return;
  card.querySelector('.session-head>span').textContent='Attach to '+(agentAccounts.find(a=>a.id===draft.account)?.name||'agent');
  card.querySelector('.session-back').hidden=true;
  card.querySelector('.session-filter-row').hidden=true;
  card.querySelector('.session-keyboard-hint').textContent='↑↓ Choose · Enter Select · Esc Close';
  if(card.querySelector('.attachment-preview')?.dataset.token===draft.token){refreshAttachmentSelection();return;}
  card.querySelector('.attachment-preview')?.remove();card.querySelector('.attachment-compose')?.remove();
  const preview=document.createElement('div');preview.className='attachment-preview';preview.dataset.token=draft.token;
  for(const file of draft.files)preview.append(attachmentFileView(file));
  card.querySelector('.session-head').after(preview);
  const compose=document.createElement('div');compose.className='attachment-compose';
  compose.innerHTML='<div class="attachment-target">Choose a session to continue</div><textarea class="attachment-message" rows="2" maxlength="8000" aria-label="Attachment message" placeholder="What should the agent look at?"></textarea><div class="attachment-actions"><button type="button" class="attachment-copy session-tool-action" aria-describedby="attachment-handoff-help" disabled>Open chat &amp; copy prompt</button><button type="button" class="attachment-send session-tool-action" disabled>Send to Codex</button></div><p class="attachment-help" id="attachment-handoff-help">Open chat &amp; copy prompt places files in the chat’s workspace. Paste the copied prompt into the chat and send.</p><div class="attachment-status" role="status" aria-live="polite"></div>';
  card.querySelector('.session-results').after(compose);
  compose.querySelector('.attachment-copy').addEventListener('click',()=>sendAttachmentReview(false));
  compose.querySelector('.attachment-send').addEventListener('click',()=>sendAttachmentReview(true));
  refreshAttachmentSelection();placeCard();
}
async function sendAttachmentReview(queue){
  const draft=window.attachmentReviewDraft,selected=attachmentSelection;if(!draft||!selected||window.attachmentReviewBusy)return;
  window.attachmentReviewBusy=true;refreshAttachmentSelection();
  const status=card.querySelector('.attachment-status');status.textContent=queue?'Sending attachments…':'Preparing files…';
  try{
    const result=await invoke('deliver_attachments',{token:draft.token,id:selected.id,message:card.querySelector('.attachment-message').value,queue});
    status.textContent=result.queued?'Queued in the selected Codex chat.':result.openError?(result.copied?'Prompt copied. ':'')+result.openError:'Chat opened. Paste the copied prompt into the chat and send.';
    if(result.queued){draft.completed=true;card.querySelector('.attachment-send').remove();card.querySelector('.attachment-copy').remove();attachmentSelection=null;}
  }catch(error){status.textContent=error.message||'The attachment could not be sent.';if(queue){card.querySelector('.attachment-send')?.remove();attachmentSelection=null;}}
  finally{window.attachmentReviewBusy=false;refreshAttachmentSelection();placeCard();}
}
listen('attachment_draft',e=>{
  if(window.attachmentReviewBusy)return;
  window.attachmentReviewDraft=e.payload;attachmentSelection=null;
  window.agentDropCancel?.();sessionAccount=e.payload.account;sessionQuery='';switcherPending=false;
  requestSessionSwitcher(true,e.payload.account);
  renderAttachmentReview();
}).catch(()=>{});
