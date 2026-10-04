'use strict';
// One shared lobe for finding a chat and unfolding a finished-session stack. The existing detail
// spring draws its black; only the selection and small handoff accents animate on top of it.
const SESSION_ID='__sessions',FINISHED_ID='__finished';
const STAR_MARK='<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m10 2 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.5-4.8 2.5.9-5.4L2.2 7.7l5.4-.8Z"/></svg>';
let sessionPins=new Set(),library=[],libraryLoaded=false,libraryLoading=false,libraryError='',libraryAt=0,libraryGeneration=0;
let switcherPending=false,sessionQuery='',sessionAccount='',sessionIndex=0,sessionMatches=[],sessionRenderFrame=0,sessionListSignature='';
let finishedSessions=[];
let sessionRefreshTimer=0,sessionActivitySignature='';
function scheduleSessionRefresh(delay=30000){
  clearTimeout(sessionRefreshTimer);sessionRefreshTimer=0;
  if(!sessionSwitcherShowing())return;
  sessionRefreshTimer=setTimeout(()=>{sessionRefreshTimer=0;if(sessionSwitcherShowing())loadSessionLibrary(true);},delay);
}
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
  try{const rows=await invoke('get_session_library',{refresh:force});if(generation!==libraryGeneration)return;if(!Array.isArray(rows))throw new Error('Update the collector to load saved sessions.');library=rows;libraryLoaded=true;libraryAt=Date.now();}
  catch(error){if(generation===libraryGeneration)libraryError=error.message||'Saved sessions could not be loaded.';}
  finally{if(generation===libraryGeneration){libraryLoading=false;updateSessionList();scheduleSessionRefresh();}}
}
let sessionFollowClosing=false;
function completeSessionFollow(){if(!sessionFollowClosing)return;sessionFollowClosing=false;invoke('session_follow_ready').catch(()=>{});}
listen('session_follow',()=>{sessionFollowClosing=true;switcherPending=false;hideCard();if(!detailTarget&&detailOpen===0)completeSessionFollow();}).catch(()=>{});
function requestSessionSwitcher(on=true){
  if(!on){switcherPending=false;if(sessionSwitcherShowing())hideCard();return;}
  sessionFollowClosing=false;
  if(sessionSwitcherShowing()){focusSessionSearch();return;}
  switcherPending=true;
  const attempt=()=>{
    if(!switcherPending)return;
    if(!shown||window.agentTracking||document.getElementById('root').classList.contains('placing'))return;
    switcherPending=false;hideCard();sessionListSignature='';
    hoverId=SESSION_ID;cardHeld=true;card.classList.add('held');showCard();setFocusExpanded(true);
    focusSessionSearch();loadSessionLibrary(true);scheduleSessionRefresh();
  };
  attempt();
}
function focusSessionSearch(){
  invoke('session_switcher_focus').then(()=>{if(sessionSwitcherShowing())requestAnimationFrame(()=>card.querySelector('.session-search')?.focus({preventScroll:true}));}).catch(()=>{});
}
listen('session_switcher',e=>requestSessionSwitcher(e.payload!==false)).catch(()=>{});
for(const name of ['appear','layout','release'])listen(name,()=>{if(switcherPending)requestAnimationFrame(()=>requestSessionSwitcher());}).catch(()=>{});
listen('disappear',()=>{switcherPending=false;clearResumeEffects();}).catch(()=>{});
listen('monitor_stow',()=>clearResumeEffects()).catch(()=>{});
function closeSessionTools(){
  if(sessionSwitcherShowing()){setSessionFilterOpen(false);clearTimeout(sessionRefreshTimer);sessionRefreshTimer=0;switcherPending=false;invoke('close_session_switcher').catch(()=>{});}
  scheduleFocusRest();
}
function sessionAgents(){
  const values=new Map(agentAccounts.map(a=>[a.id,a.name]));for(const s of library)if(!values.has(s.account))values.set(s.account,s.accountName);
  return [['','All agents'],...values];
}
function setSessionFilterOpen(on){
  const button=card.querySelector('.session-account'),menu=card.querySelector('.session-agent-menu');if(!button||!menu)return;
  button.setAttribute('aria-expanded',String(on));menu.classList.toggle('open',on);menu.inert=!on;
  if(on)menu.querySelector('[aria-selected="true"]')?.focus({preventScroll:true});
}
function updateSessionAgents(){
  const button=card.querySelector('.session-account'),menu=card.querySelector('.session-agent-menu');if(!button||!menu)return;
  const agents=sessionAgents(),signature=JSON.stringify([agents,sessionAccount]);if(menu.dataset.signature===signature)return;
  menu.dataset.signature=signature;button.querySelector('span').textContent=agents.find(([id])=>id===sessionAccount)?.[1]||'All agents';
  menu.innerHTML=agents.map(([id,name])=>`<button type="button" class="session-agent-option session-tool-action" role="option" aria-selected="${id===sessionAccount}" data-agent="${esc(id)}"><span>${esc(name)}</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3 8 3 3 7-7"/></svg></button>`).join('');
}
function chooseSessionAgent(button){
  sessionAccount=button.dataset.agent;sessionIndex=0;setSessionFilterOpen(false);updateSessionList();card.querySelector('.session-account')?.focus({preventScroll:true});
}
function renderSessionToolsCard(){
  if(!isSessionToolsCard())return false;
  const switched=card.dataset.account!==hoverId;
  card.classList.add('session-card');setExtraContent([],[]);
  if(hoverId===SESSION_ID){
    if(switched||!card.querySelector('.session-search')){
      card.innerHTML=`<div class="session-head"><span>Sessions</span></div>
        <div class="session-search-row"><svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5"/><path d="m12.5 12.5 4.2 4.2"/></svg><input class="session-search" type="search" role="combobox" aria-expanded="true" aria-autocomplete="list" placeholder="Find a chat or workspace" aria-label="Find a chat or workspace" aria-controls="session-results" autocomplete="off" spellcheck="false"></div>
        <div class="session-filter-row"><button type="button" class="session-account session-tool-action" aria-label="Filter sessions by agent" aria-haspopup="listbox" aria-expanded="false" aria-controls="session-agents"><span>All agents</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><div class="session-agent-menu" id="session-agents" role="listbox" aria-label="Agents" inert></div></div>
        <div class="session-results" id="session-results" role="listbox" aria-label="Saved sessions"></div><div class="session-status" role="status" aria-live="polite"></div>`;
      const search=card.querySelector('.session-search');search.value=sessionQuery;
      search.addEventListener('input',()=>{sessionQuery=search.value;sessionIndex=0;queueSessionRender();});
      const filter=card.querySelector('.session-account');
      filter.addEventListener('click',()=>setSessionFilterOpen(filter.getAttribute('aria-expanded')!=='true'));
      card.querySelector('.session-agent-menu').addEventListener('click',e=>{const option=e.target.closest('.session-agent-option');if(option)chooseSessionAgent(option);});
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
  updateSessionAgents();
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
    sessionMatches.length>120?'Showing 120 chats. Search to see more.':!libraryLoaded&&libraryLoading?'Loading sessions…':`${sessionMatches.length} ${sessionMatches.length===1?'chat':'chats'}`);
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
  const open=e.target.closest('.session-open');if(open){resumeSwitcherSession(Number(open.dataset.index));return;}
  const finished=e.target.closest('.finished-session');if(finished){const s=finishedSessions[Number(finished.dataset.index)];if(s)openNotifiedAlert(s,s.account);return;}
});
document.addEventListener('keydown',e=>{
  if(!isSessionToolsCard()||!card.classList.contains('show'))return;
  const menu=card.querySelector('.session-agent-menu'),filter=card.querySelector('.session-account');
  if(menu?.classList.contains('open')){
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();setSessionFilterOpen(false);filter.focus({preventScroll:true});return;}
    if(e.target.closest('.session-agent-menu')&&['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
      e.preventDefault();const options=[...menu.querySelectorAll('.session-agent-option')],index=options.indexOf(e.target.closest('.session-agent-option'));
      options[e.key==='Home'?0:e.key==='End'?options.length-1:Math.max(0,Math.min(options.length-1,index+(e.key==='ArrowDown'?1:-1)))]?.focus({preventScroll:true});return;
    }
    if(e.key==='Tab')setSessionFilterOpen(false);
  }
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();hideCard();return;}
  if(e.target.closest('.session-account')){if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();setSessionFilterOpen(true);}return;}
  if(!sessionSwitcherShowing()||e.target.closest('.session-agent-menu,.session-account,.session-pin,.session-close'))return;
  if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
    e.preventDefault();sessionIndex=e.key==='Home'?0:e.key==='End'?Math.min(119,sessionMatches.length-1):Math.max(0,Math.min(119,sessionMatches.length-1,sessionIndex+(e.key==='ArrowDown'?1:-1)));paintSessionSelection(true);
  }else if(e.key==='Enter'&&e.target.classList.contains('session-search')){e.preventDefault();resumeSwitcherSession(sessionIndex);}
},true);
function openCompletionStack(events){
  if(sessionSwitcherShowing())return;
  finishedSessions=events.slice(0,40);hoverId=FINISHED_ID;cardHeld=true;card.classList.add('held');showCard();setFocusExpanded(true);
}

// Each cell keeps its own position and velocity, so changing the selected group mid-flight
// unfolds new members and takes old ones home without resetting the notch or clipping a gauge.
let focusAccounts=new Set(),focusExpanded=false,focusFrame=0,focusLast=0,focusTimer=0;
const focusCells=new Map(),focusMotion=matchMedia('(prefers-reduced-motion: reduce)');
function focusWantsAll(){return !focusAccounts.size||!window.agentTracking&&(focusExpanded||card.classList.contains('show')||slivering());}
function applyFocusLayout(){
  const cells=[...pill.querySelectorAll('.cell')],vertical=edgeIsVertical(),reversed=['bottom','left'].includes(notchEdge);
  const enabled=cells.some(c=>focusAccounts.has(c.dataset.p)),all=!enabled||focusWantsAll();
  for(const cell of cells){
    let state=focusCells.get(cell.dataset.p);
    if(!state){state={value:1,velocity:0,target:1};focusCells.set(cell.dataset.p,state);}
    state.target=all||focusAccounts.has(cell.dataset.p)?1:0;
    if(focusMotion.matches){state.value=state.target;state.velocity=0;}
  }
  const weights=cells.map(c=>Math.max(0,Math.min(1,focusCells.get(c.dataset.p).value))),gap=vertical?14:38;
  let after=weights.reduce((a,b)=>a+b,0),length=vertical?36:60;
  pill.style.gap='0px';
  for(let i=0;i<cells.length;i++){
    const cell=cells[i],weight=weights[i];after-=weight;
    const spacing=gap*weight*Math.min(1,Math.max(0,after));length+=(vertical?68:44)*weight+spacing;
    cell.style.width=vertical?'':44*weight+'px';cell.style.height=vertical?68*weight+'px':'';
    cell.style.maxWidth='';cell.style.maxHeight='';
    for(const prop of ['marginTop','marginRight','marginBottom','marginLeft'])cell.style[prop]='';
    cell.style[vertical?(reversed?'marginTop':'marginBottom'):(reversed?'marginLeft':'marginRight')]=spacing+'px';
    cell.style.setProperty('--focus-visibility',String(smooth(weight)));
    cell.style.setProperty('--focus-scale',String(.76+.24*smooth(weight)));
    cell.classList.toggle('focus-rest',weight<.999);cell.tabIndex=weight<.15?-1:0;
  }
  pill.style.setProperty('--length',Math.max(104,length)+'px');
  const ids=new Set(cells.map(c=>c.dataset.p));for(const id of focusCells.keys())if(!ids.has(id))focusCells.delete(id);
  if(!focusMotion.matches)startFocusAnimation();
}
function setFocusExpanded(on){
  clearTimeout(focusTimer);focusExpanded=on;applyFocusLayout();
  if(focusMotion.matches){
    cancelAnimationFrame(focusFrame);focusFrame=0;
    for(const state of focusCells.values()){state.value=state.target;state.velocity=0;}
    applyFocusLayout();aim(layout.edge,layout.along,true);return;
  }
  startFocusAnimation();
}
function startFocusAnimation(){
  if(focusFrame||[...focusCells.values()].every(s=>s.value===s.target&&s.velocity===0))return;
  focusLast=performance.now();
  const step=now=>{
    const elapsed=Math.min(.04,(now-focusLast)/1000);focusLast=now;
    const steps=Math.max(1,Math.ceil(elapsed*120)),dt=elapsed/steps,omega=2*Math.PI/.54;
    let settled=true;
    for(const state of focusCells.values()){
      for(let i=0;i<steps;i++){state.velocity+=(-omega*omega*(state.value-state.target)-2*.95*omega*state.velocity)*dt;state.value+=state.velocity*dt;}
      if(Math.abs(state.value-state.target)<.001&&Math.abs(state.velocity)<.015){state.value=state.target;state.velocity=0;}else settled=false;
    }
    applyFocusLayout();aim(layout.edge,layout.along);for(const s of slivers.values())drawSliver(s);
    focusFrame=settled?0:requestAnimationFrame(step);
  };
  focusFrame=requestAnimationFrame(step);
}
function scheduleFocusRest(){clearTimeout(focusTimer);focusTimer=setTimeout(()=>{if(!pointerIn&&!card.classList.contains('show')&&!slivering())setFocusExpanded(false);},700);}
function setFocusAccounts(value){
  focusAccounts=new Set(Array.isArray(value)?value:[]);window.sessionFocusAccounts=[...focusAccounts];
  const all=originalProviders(),index=all.findIndex(a=>focusAccounts.has(a.id)),capacity=Math.max(1,Math.floor((edgeIsVertical()?innerHeight-150:innerWidth-150)/90));
  if(index>=0&&!all.slice(accountOffset,accountOffset+capacity).some(a=>focusAccounts.has(a.id)))accountOffset=index;
  renderRing();setFocusExpanded(pointerIn||card.classList.contains('show'));
}
invoke('get_focus_accounts').then(setFocusAccounts).catch(()=>{});listen('focus_accounts',e=>setFocusAccounts(e.payload)).catch(()=>{});
listen('notch_pointer',e=>{if(e.payload)setFocusExpanded(true);else scheduleFocusRest();}).catch(()=>{});
listen('edge_cursor',()=>setFocusExpanded(false)).catch(()=>{});
listen('move_begin',()=>setFocusExpanded(false)).catch(()=>{});
listen('release',()=>scheduleFocusRest()).catch(()=>{});
listen('activity',()=>{if(focusAccounts.size&&!focusExpanded)scheduleFocusRest();}).catch(()=>{});
listen('activity',e=>{
  const signature=JSON.stringify((Array.isArray(e.payload)?e.payload:[]).map(s=>[s.account,s.id,s.sessionId,s.state]));
  if(signature===sessionActivitySignature)return;sessionActivitySignature=signature;
  if(sessionSwitcherShowing())scheduleSessionRefresh(1000);else libraryAt=0;
}).catch(()=>{});
window.addEventListener('focus',()=>{if(sessionSwitcherShowing())loadSessionLibrary(true);});
pill.addEventListener('mouseenter',()=>setFocusExpanded(true));pill.addEventListener('mouseleave',()=>scheduleFocusRest());
pill.addEventListener('focusin',()=>setFocusExpanded(true));card.addEventListener('mouseenter',()=>setFocusExpanded(true));
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

document.addEventListener('pointerdown',e=>{if(sessionSwitcherShowing()&&!e.target.closest('.session-filter-row'))setSessionFilterOpen(false);},true);
