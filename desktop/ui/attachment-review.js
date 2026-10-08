'use strict';
// Attachments use the same held session lobe and focus lifecycle as the session switcher.
let attachmentSelection=null,attachmentReviewGeneration=0;
function closeAttachmentReview(){
  if(!window.attachmentReviewDraft||window.attachmentReviewBusy)return;
  window.attachmentReviewDraft=null;attachmentSelection=null;attachmentReviewGeneration++;
  card.classList.remove('attachment-card');card.querySelector('.attachment-preview')?.remove();card.querySelector('.attachment-compose')?.remove();
  invoke('close_attachments').catch(()=>{});
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
  const note=card.querySelector('.attachment-target');if(note)note.textContent=window.attachmentReviewDraft.completed?'Sent to the selected session':selected?'To '+(selected.name||selected.workspace):'Select a session below';
  const send=card.querySelector('.attachment-send');if(send)send.hidden=agentAccounts.find(a=>a.id===window.attachmentReviewDraft.account)?.base!=='codex';
}
function renderAttachmentReview(){
  const draft=window.attachmentReviewDraft;
  card.classList.toggle('attachment-card',!!draft);
  if(!draft)return;
  card.querySelector('.session-head>span').textContent='Attach to '+(agentAccounts.find(a=>a.id===draft.account)?.name||'agent');
  card.querySelector('.session-back').hidden=true;
  card.querySelector('.session-filter-row').hidden=true;
  card.querySelector('.session-keyboard-hint').textContent='↑↓ Choose · Enter Select · Esc Close';
  if(card.querySelector('.attachment-preview')?.dataset.token===draft.token){refreshAttachmentSelection();return;}
  card.querySelector('.attachment-preview')?.remove();card.querySelector('.attachment-compose')?.remove();
  const preview=document.createElement('div');preview.className='attachment-preview';preview.dataset.token=draft.token;
  for(const file of draft.files){const item=document.createElement('div');item.className='attachment-file';const visual=document.createElement(file.preview?'img':'span');if(file.preview){visual.src=file.preview;visual.alt=file.name;}else visual.textContent='▤';const name=document.createElement('span');name.textContent=file.name;item.append(visual,name);preview.append(item);}
  card.querySelector('.session-head').after(preview);
  const compose=document.createElement('div');compose.className='attachment-compose';
  compose.innerHTML='<div class="attachment-target">Select a session below</div><textarea class="attachment-message" rows="2" maxlength="8000" aria-label="Attachment message" placeholder="What should the agent look at?"></textarea><div class="attachment-actions"><button type="button" class="attachment-copy session-tool-action" disabled>Copy context &amp; open</button><button type="button" class="attachment-send session-tool-action" disabled>Send to Codex</button><button type="button" class="attachment-close session-tool-action" aria-label="Cancel attachment">×</button></div><div class="attachment-status" role="status" aria-live="polite"></div>';
  card.querySelector('.session-results').after(compose);
  compose.querySelector('.attachment-close').addEventListener('click',()=>hideCard());
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
    status.textContent=result.queued?'Sent to the selected Codex chat.':result.openError?(result.copied?'Context copied. ':'')+result.openError:'Context copied. Paste into the chat composer.';
    if(result.queued){draft.completed=true;card.querySelector('.attachment-send').remove();card.querySelector('.attachment-copy').remove();attachmentSelection=null;}
  }catch(error){status.textContent=error.message||'The attachment could not be sent.';if(queue){card.querySelector('.attachment-send')?.remove();attachmentSelection=null;}}
  finally{window.attachmentReviewBusy=false;refreshAttachmentSelection();placeCard();}
}
listen('attachment_draft',e=>{
  if(window.attachmentReviewBusy)return;
  window.attachmentReviewDraft=e.payload;attachmentSelection=null;attachmentReviewGeneration++;
  window.agentDropCancel?.();sessionAccount=e.payload.account;sessionQuery='';switcherPending=false;
  requestSessionSwitcher(true,e.payload.account);
  renderAttachmentReview();
}).catch(()=>{});
