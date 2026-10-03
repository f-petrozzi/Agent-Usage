'use strict';
// One shared lobe for finding a chat and unfolding a finished-session stack. The existing detail
// spring draws its black; only the selection and small handoff accents animate on top of it.
const SESSION_ID='__sessions',FINISHED_ID='__finished';
const STAR_MARK='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L2.2 7.7l5.4-.8Z"/></svg>';
const FOCUS_MARK='<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><circle cx="10" cy="10" r="2"/></svg>';
let sessionPins=new Set(),library=[],libraryLoaded=false,libraryLoading=false,libraryError='',libraryAt=0,libraryGeneration=0;
let switcherPending=false,sessionQuery='',sessionAccount='',sessionIndex=0,sessionMatches=[],sessionRenderFrame=0,sessionListSignature='';
let finishedSessions=[];
const sessionKey=(account,id)=>account+':'+id;
const isSessionPinned=(account,id)=>sessionPins.has(sessionKey(account,id));
const sessionSwitcherShowing=()=>card.classList.contains('show')&&hoverId===SESSION_ID;
const isSessionToolsCard=()=>[SESSION_ID,FINISHED_ID].includes(hoverId);
function sessionPinButton(s){
  const pinned=isSessionPinned(s.account,s.id)||s.pinned===true;
  return `<button type="button" class="session-pin${pinned?' pinned':''}" data-session="${esc(s.id)}" data-account="${esc(s.account)}" aria-pressed="${pinned}" aria-label="${pinned?'Unpin':'Pin'} ${esc(s.name||'chat')}" title="${pinned?'Unpin chat':'Pin chat'}">${STAR_MARK}</button>`;
}
function updateSessionPins(rows){
  sessionPins=new Set((Array.isArray(rows)?rows:[]).map(s=>sessionKey(s.account,s.id)));
  for(const record of histories.values())if(record.rows)record.rows=record.rows.map(s=>({...s,pinned:isSessionPinned(s.account||'',s.id)}));
  for(const [account,record] of histories)if(record.rows)record.rows.sort((a,b)=>Number(isSessionPinned(account,b.id))-Number(isSessionPinned(account,a.id))||b.since-a.since);
  library=library.map(s=>({...s,pinned:isSessionPinned(s.account,s.id)}));
  if(card.classList.contains('show'))renderCard();
}
invoke('get_session_pins').then(updateSessionPins).catch(()=>{});
listen('session_pins',e=>updateSessionPins(e.payload)).catch(()=>{});
listen('session_history_reset',()=>{libraryGeneration++;library=[];libraryAt=0;libraryLoaded=false;libraryLoading=false;libraryError='';sessionPins.clear();invoke('get_session_pins').then(updateSessionPins).catch(()=>{});if(sessionSwitcherShowing())loadSessionLibrary(true);}).catch(()=>{});
async function loadSessionLibrary(force=false){
  if(libraryLoading||!force&&libraryLoaded&&Date.now()-libraryAt<60000)return;
  const generation=libraryGeneration;libraryLoading=true;libraryError='';updateSessionList();
  try{const rows=await invoke('get_session_library');if(generation!==libraryGeneration)return;if(!Array.isArray(rows))throw new Error('Update the collector to load saved sessions.');library=rows;libraryLoaded=true;libraryAt=Date.now();}
  catch(error){if(generation===libraryGeneration)libraryError=error.message||'Saved sessions could not be loaded.';}
  finally{if(generation===libraryGeneration){libraryLoading=false;updateSessionList();}}
}
function requestSessionSwitcher(on=true){
  if(!on){switcherPending=false;if(sessionSwitcherShowing())hideCard();return;}
  if(sessionSwitcherShowing()){card.querySelector('.session-search')?.focus();return;}
  switcherPending=true;
  const attempt=()=>{
    if(!switcherPending)return;
    if(!shown||window.agentTracking||document.getElementById('root').classList.contains('placing'))return;
    switcherPending=false;hideCard();sessionQuery='';sessionAccount='';sessionIndex=0;sessionListSignature='';
    hoverId=SESSION_ID;cardHeld=true;card.classList.add('held');showCard();setFocusExpanded(true);
    invoke('session_switcher_focus').catch(()=>{});loadSessionLibrary();
    requestAnimationFrame(()=>card.querySelector('.session-search')?.focus({preventScroll:true}));
  };
  attempt();
}
listen('session_switcher',e=>requestSessionSwitcher(e.payload!==false)).catch(()=>{});
for(const name of ['appear','layout'])listen(name,()=>{if(switcherPending)requestAnimationFrame(()=>requestSessionSwitcher());}).catch(()=>{});
listen('disappear',()=>{switcherPending=false;clearResumeEffects();}).catch(()=>{});
listen('monitor_stow',()=>clearResumeEffects()).catch(()=>{});
function closeSessionTools(){
  if(sessionSwitcherShowing()){switcherPending=false;invoke('close_session_switcher').catch(()=>{});}
  scheduleFocusRest();
}
function sessionOptions(){
  const values=new Map(agentAccounts.map(a=>[a.id,a.name]));for(const s of library)if(!values.has(s.account))values.set(s.account,s.accountName);
  return '<option value="">All agents</option>'+[...values].map(([id,name])=>`<option value="${esc(id)}">${esc(name)}</option>`).join('');
}
function renderSessionToolsCard(){
  if(!isSessionToolsCard())return false;
  const switched=card.dataset.account!==hoverId;
  card.classList.add('session-card');setExtraContent([],[]);
  if(hoverId===SESSION_ID){
    if(switched||!card.querySelector('.session-search')){
      card.innerHTML=`<div class="session-head"><span>Sessions</span><kbd>Ctrl + ScrLk</kbd><button type="button" class="session-close session-tool-action" aria-label="Close sessions">×</button></div>
        <div class="session-search-row"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.5 12.5 4.2 4.2"/></svg><input class="session-search" type="search" role="combobox" aria-expanded="true" aria-autocomplete="list" placeholder="Find a chat or workspace" aria-label="Find a chat or workspace" aria-controls="session-results" autocomplete="off" spellcheck="false"></div>
        <div class="session-filter-row"><select class="session-account" aria-label="Filter sessions by agent">${sessionOptions()}</select><button type="button" class="session-reload session-tool-action" aria-label="Reload saved sessions">Reload</button></div>
        <div class="session-results" id="session-results" role="listbox" aria-label="Saved sessions"></div><div class="session-status" role="status" aria-live="polite"></div>`;
      const search=card.querySelector('.session-search');search.value=sessionQuery;
      search.addEventListener('input',()=>{sessionQuery=search.value;sessionIndex=0;queueSessionRender();});
      const filter=card.querySelector('.session-account');filter.value=sessionAccount;
      filter.addEventListener('change',()=>{sessionAccount=filter.value;sessionIndex=0;updateSessionList();});
      sessionListSignature='';
    }
    card.dataset.account=SESSION_ID;updateSessionList();
  }else{
    card.innerHTML=`<div class="session-head"><span>${finishedSessions.length} finished</span><button type="button" class="session-close session-tool-action" aria-label="Close finished sessions">×</button></div><div class="finished-results">${finishedSessions.map((s,i)=>{
      const account=agentAccounts.find(a=>a.id===s.account),linked=!!s.id;
      return `<button type="button" class="finished-session session-tool-action" data-index="${i}" ${linked?'':'aria-label="Show '+esc(account?.name||'agent')+' usage"'}><span class="session-mark">${account?glyphHtml(account):''}</span><span class="session-row-copy"><span class="session-name">${esc(s.session||s.title||'Finished session')}</span><span class="session-meta">${esc(account?.name||s.account||'Agent')}${s.took!=null?' · '+esc(tookText(s.took)):''}</span></span></button>`;
    }).join('')}</div>`;
    card.dataset.account=FINISHED_ID;
  }
  placeCard();syncAccountFocus(false);if(switched)changeDetailAccount();return true;
}
function queueSessionRender(){if(!sessionRenderFrame)sessionRenderFrame=requestAnimationFrame(()=>{sessionRenderFrame=0;updateSessionList();});}
function updateSessionList(){
  if(!sessionSwitcherShowing())return;
  const selected=sessionMatches[sessionIndex],words=sessionQuery.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  sessionMatches=library.filter(s=>(!sessionAccount||s.account===sessionAccount)&&words.every(word=>[s.name,s.accountName,s.workspace,s.sessionId].join(' ').toLocaleLowerCase().includes(word)))
    .sort((a,b)=>Number(isSessionPinned(b.account,b.id)||b.pinned)-Number(isSessionPinned(a.account,a.id)||a.pinned)||b.since-a.since);
  if(selected){const found=sessionMatches.findIndex(s=>s.account===selected.account&&s.id===selected.id);if(found>=0)sessionIndex=found;}
  sessionIndex=Math.max(0,Math.min(119,sessionIndex,sessionMatches.length-1));
  const rows=sessionMatches.slice(0,120),list=card.querySelector('.session-results'),status=card.querySelector('.session-status');
  const signature=JSON.stringify(rows.map(s=>[s.id,s.account,s.name,s.workspace,s.live,s.state,isSessionPinned(s.account,s.id)||s.pinned,s.canOpen]));
  if(signature!==sessionListSignature){
    sessionListSignature=signature;const scroll=list.scrollTop;
    let previousPinned=null;
      list.innerHTML='<div class="session-selection" aria-hidden="true"></div>'+rows.map((s,i)=>{
      const pinned=isSessionPinned(s.account,s.id)||s.pinned,section=pinned!==previousPinned?`<div class="session-section">${pinned?'Pinned chats':'Recent chats'}</div>`:'';previousPinned=pinned;
      const account=agentAccounts.find(a=>a.id===s.account),state=s.live?(s.state==='busy'?'Working':s.state==='waiting'?'Waiting':'Open'):'';
      const workspace=s.workspace?.split('/').filter(Boolean).slice(-2).join('/')||'Saved chat';
      return `${section}<div class="session-result" data-index="${i}"><button type="button" class="session-open session-tool-action" role="option" id="session-option-${i}" data-index="${i}" aria-selected="false" ${s.canOpen?'':'disabled'}><span class="session-mark">${account?glyphHtml(account):esc((s.accountName||'A').slice(0,1))}</span><span class="session-row-copy"><span class="session-name">${esc(s.name)}</span><span class="session-meta">${esc(s.accountName||s.account)}${state?' · '+esc(state):''}</span><span class="session-workspace">${esc(workspace)}</span></span></button>${s.canOpen?sessionPinButton(s):''}</div>`;
    }).join('');list.scrollTop=scroll;
  }
  status.textContent=libraryError||(!rows.length?(libraryLoading?'Loading saved sessions…':sessionQuery?'No matching chats.':'No saved chats yet.'):
    sessionMatches.length>120?'Showing 120 chats. Search or choose an agent to narrow the list.':libraryLoading?'Refreshing sessions…':`${sessionMatches.length} ${sessionMatches.length===1?'chat':'chats'} · ↑ ↓ to choose · Enter to resume`);
  status.classList.toggle('error',!!libraryError);paintSessionSelection();placeCard();
}
function paintSessionSelection(scroll=false){
  const ink=card.querySelector('.session-selection');
  for(const row of card.querySelectorAll('.session-result')){
    const on=Number(row.dataset.index)===sessionIndex;row.classList.toggle('active',on);row.querySelector('.session-open').setAttribute('aria-selected',String(on));
    if(on&&ink){ink.style.transform=`translateY(${row.offsetTop}px)`;ink.style.height=row.offsetHeight+'px';}
    if(on&&scroll)row.scrollIntoView({block:'nearest'});
  }
  const search=card.querySelector('.session-search');if(search){if(sessionMatches.length)search.setAttribute('aria-activedescendant','session-option-'+sessionIndex);else search.removeAttribute('aria-activedescendant');}
}
async function resumeSwitcherSession(index){
  const s=sessionMatches[index];if(!s?.canOpen)return;
  const status=card.querySelector('.session-status');status.textContent='Opening in VS Code…';
  try{if(!await invoke('open_history_session',{id:s.id,account:s.account}))throw new Error('VS Code could not resume this chat.');hideCard();}
  catch(error){if(sessionSwitcherShowing()){status.textContent=error.message||'VS Code could not be opened.';status.classList.add('error');invoke('session_switcher_focus').catch(()=>{});}}
}
const pinPending=new Set();
card.addEventListener('click',async e=>{
  const pin=e.target.closest('.session-pin');
  if(pin){
    e.stopPropagation();const {session:id,account}=pin.dataset,key=sessionKey(account,id);if(pinPending.has(key))return;pinPending.add(key);pin.disabled=true;
    try{await invoke('set_session_pin',{id,account,on:pin.getAttribute('aria-pressed')!=='true'});}
    catch(error){if(sessionSwitcherShowing()){card.querySelector('.session-status').textContent=error.message||'This chat could not be pinned.';}else notice(error.message||'This chat could not be pinned.');}
    finally{pinPending.delete(key);pin.disabled=false;}return;
  }
  if(e.target.closest('.session-close')){hideCard();return;}
  if(e.target.closest('.session-reload')){loadSessionLibrary(true);return;}
  const open=e.target.closest('.session-open');if(open){resumeSwitcherSession(Number(open.dataset.index));return;}
  const finished=e.target.closest('.finished-session');if(finished){const s=finishedSessions[Number(finished.dataset.index)];if(s)openNotifiedAlert(s,s.account);return;}
  const focus=e.target.closest('.focus-agent');if(focus){invoke('set_focus_account',{account:focusAccount===focus.dataset.account?null:focus.dataset.account}).catch(error=>notice(error.message));}
});
document.addEventListener('keydown',e=>{
  if(!isSessionToolsCard()||!card.classList.contains('show'))return;
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();hideCard();return;}
  if(!sessionSwitcherShowing()||e.target.matches('select,.session-pin,.session-close,.session-reload'))return;
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();sessionIndex=e.key==='Home'?0:e.key==='End'?Math.min(119,sessionMatches.length-1):Math.max(0,Math.min(119,sessionMatches.length-1,sessionIndex+(e.key==='ArrowDown'?1:-1)));paintSessionSelection(true);
  }else if(e.key==='Enter'&&e.target.classList.contains('session-search')){e.preventDefault();resumeSwitcherSession(sessionIndex);}
},true);
function openCompletionStack(events){
  if(sessionSwitcherShowing())return;
  finishedSessions=events.slice(0,40);hoverId=FINISHED_ID;cardHeld=true;card.classList.add('held');showCard();setFocusExpanded(true);
}

// Focus contracts the actual layout and SVG outline together. It keeps the same cell nodes, and
// runs one spring only while moving; live quota and activity readings continue behind the clipping.
let focusAccount=null,focusExpanded=false,focusOpen=1,focusTarget=1,focusVelocity=0,focusFrame=0,focusLast=0,focusTimer=0;
const focusMotion=matchMedia('(prefers-reduced-motion: reduce)');
function focusButton(account){return `<button type="button" class="focus-agent" data-account="${esc(account)}" aria-pressed="${focusAccount===account}" aria-label="${focusAccount===account?'Exit focus mode':'Focus on this agent'}" title="${focusAccount===account?'Exit focus mode':'Focus on this agent'}">${FOCUS_MARK}</button>`;}
function applyFocusLayout(){
  const cells=[...pill.querySelectorAll('.cell')],enabled=!!focusAccount&&cells.some(c=>c.dataset.p===focusAccount),vertical=edgeIsVertical(),p=enabled?Math.max(0,Math.min(1,focusOpen)):1;
  if(!enabled){pill.style.removeProperty('gap');for(const cell of cells){cell.style.removeProperty('max-width');cell.style.removeProperty('max-height');cell.style.removeProperty('--focus-visibility');cell.classList.remove('focus-rest');cell.tabIndex=0;}return;}
  pill.style.setProperty('--length',`${104+Math.max(0,cells.length-1)*82*p}px`);pill.style.gap=(vertical?14:38)*p+'px';
  for(const cell of cells){
    const other=cell.dataset.p!==focusAccount;cell.classList.toggle('focus-rest',other);
    cell.style.maxWidth=other&&!vertical?44*p+'px':'';cell.style.maxHeight=other&&vertical?68*p+'px':'';
    cell.style.setProperty('--focus-visibility',other?String(smooth(p)):'1');cell.tabIndex=other&&p<.15?-1:0;
  }
}
function setFocusExpanded(on){
  clearTimeout(focusTimer);focusExpanded=on;
  const next=!focusAccount||on||window.agentTracking||card.classList.contains('show')||slivering()?1:0;
  if(next===focusTarget&&focusOpen===next)return;focusTarget=next;
  if(focusMotion.matches){cancelAnimationFrame(focusFrame);focusFrame=0;focusVelocity=0;focusOpen=next;applyFocusLayout();aim(layout.edge,layout.along,true);return;}
  if(focusFrame)return;focusLast=performance.now();
  const step=now=>{
    const dt=Math.min(.025,(now-focusLast)/1000);focusLast=now;const omega=2*Math.PI/.48;
    focusVelocity+=(-omega*omega*(focusOpen-focusTarget)-2*.88*omega*focusVelocity)*dt;focusOpen+=focusVelocity*dt;
    const settled=Math.abs(focusOpen-focusTarget)<.002&&Math.abs(focusVelocity)<.02;if(settled){focusOpen=focusTarget;focusVelocity=0;}
    applyFocusLayout();aim(layout.edge,layout.along,!window.agentTracking);for(const s of slivers.values())drawSliver(s);
    focusFrame=settled?0:requestAnimationFrame(step);
  };
  focusFrame=requestAnimationFrame(step);
}
function scheduleFocusRest(){clearTimeout(focusTimer);focusTimer=setTimeout(()=>{if(!pointerIn&&!card.classList.contains('show')&&!slivering())setFocusExpanded(false);},700);}
function setFocusAccount(value){
  focusAccount=typeof value==='string'?value:null;window.sessionFocusAccount=focusAccount;
  const all=originalProviders(),index=all.findIndex(a=>a.id===focusAccount),capacity=Math.max(1,Math.floor((edgeIsVertical()?innerHeight-150:innerWidth-150)/90));
  if(index>=0&&(index<accountOffset||index>=accountOffset+capacity))accountOffset=index;
  renderRing();setFocusExpanded(pointerIn||card.classList.contains('show'));if(card.classList.contains('show'))renderCard();
}
invoke('get_focus_account').then(setFocusAccount).catch(()=>{});listen('focus_account',e=>setFocusAccount(e.payload)).catch(()=>{});
listen('notch_pointer',e=>{if(e.payload)setFocusExpanded(true);else scheduleFocusRest();}).catch(()=>{});
listen('edge_cursor',()=>setFocusExpanded(true)).catch(()=>{});
listen('release',()=>scheduleFocusRest()).catch(()=>{});
listen('activity',()=>{if(focusAccount&&!focusExpanded)scheduleFocusRest();}).catch(()=>{});
pill.addEventListener('mouseenter',()=>setFocusExpanded(true));pill.addEventListener('mouseleave',()=>scheduleFocusRest());
pill.addEventListener('focusin',()=>setFocusExpanded(true));
card.addEventListener('mouseenter',()=>setFocusExpanded(true));
focusMotion.addEventListener('change',()=>setFocusExpanded(focusExpanded));

// All session entry points share the same acknowledgement-based effect, including alert-log links.
const resumeEffects=new Set(),resumeRequests=new Map(),originalInvoke=window.agentUsage.invoke;
function clearResumeEffects(){for(const effect of resumeEffects){for(const animation of effect.el.getAnimations({subtree:true}))animation.cancel();clearTimeout(effect.timer);effect.el.remove();}resumeEffects.clear();}
function beginResumeEffect(account){
  const cell=pill.querySelector(`.cell[data-p="${CSS.escape(account||'')}"]`),ring=cell?.querySelector('.ringwrap'),anchor=ring?.getBoundingClientRect(),o=document.getElementById('root').getBoundingClientRect(),p=pill.getBoundingClientRect();
  const x=anchor?.width?anchor.x+anchor.width/2:p.x+p.width/2,y=anchor?.height?anchor.y+anchor.height/2:p.y+p.height/2;
  const el=document.createElement('div');el.className='session-handoff';el.setAttribute('aria-hidden','true');
  el.innerHTML='<svg viewBox="0 0 64 64"><circle class="handoff-ring" cx="32" cy="32" r="23"/><circle class="handoff-wave" cx="32" cy="32" r="23"/><path class="handoff-check" d="m24 32 5 5 11-11"/></svg>';
  if(ring&&anchor.width&&anchor.height){ring.append(el);Object.assign(el.style,{left:'50%',top:'50%'});}
  else{Object.assign(el.style,{left:x-o.left+'px',top:y-o.top+'px'});document.getElementById('root').append(el);}
  if(!focusMotion.matches)el.querySelector('.handoff-wave').animate([{opacity:.8,transform:'scale(.65)'},{opacity:0,transform:'scale(1.4)'}],{duration:540,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});
  const effect={el,timer:0};resumeEffects.add(effect);return effect;
}
function finishResumeEffect(effect,success){
  if(!effect.el.isConnected){resumeEffects.delete(effect);return;}
  effect.el.dataset.status=success?'opened':'failed';
  if(success&&!focusMotion.matches)effect.el.querySelector('.handoff-check').animate([{strokeDashoffset:28,opacity:0},{strokeDashoffset:0,opacity:1}],{duration:280,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});
  effect.timer=setTimeout(()=>{effect.el.remove();resumeEffects.delete(effect);},success?900:200);
}
window.agentUsage.invoke=(command,args={})=>{
  if(!['open_history_session','open_working_session','open_alert_session'].includes(command))return originalInvoke(command,args);
  const key=command+':'+sessionKey(args.account||'',args.id||'');if(resumeRequests.has(key))return resumeRequests.get(key);
  const account=args.account||(typeof alertLogData!=='undefined'?alertLogData.find(s=>s.id===args.id)?.account:null),effect=beginResumeEffect(account);
  const request=Promise.resolve().then(()=>originalInvoke(command,args)).then(value=>{finishResumeEffect(effect,value===true);return value;},error=>{finishResumeEffect(effect,false);throw error;}).finally(()=>resumeRequests.delete(key));
  resumeRequests.set(key,request);return request;
};
