'use strict';
const api=window.agentUsage, $=id=>document.getElementById(id);
let flags={},slots=[],accounts=[],glyphs={},alertPrefs={muted:[]},colorTransition='hard_step',activeTab='';
let notificationTestAccount=null;
let focusAccounts=[],focusPending=0,focusRevision=0,focusSave=Promise.resolve();
api.invoke('get_focus_accounts').then(value=>{if(focusRevision)return;focusAccounts=Array.isArray(value)?value:[];renderAccounts();}).catch(()=>{});
api.on('focus_accounts',value=>{if(focusPending)return;focusAccounts=Array.isArray(value)?value:[];renderAccounts();});
function changeFocusSelection(next){
  const before=focusAccounts;focusAccounts=next;focusPending++;focusRevision++;renderAccounts();
  // Paint immediately, then save in click order. A late response cannot undo a newer group.
  const task=focusSave.catch(()=>{}).then(()=>call('set_focus_accounts',{accounts:next}));focusSave=task;
  return task.then(async value=>{
    if(--focusPending)return;
    focusAccounts=value;slots=await call('get_notch_slots');renderAccounts();
  },async failure=>{
    if(!--focusPending){focusAccounts=await api.invoke('get_focus_accounts').catch(()=>before);renderAccounts();}
    throw failure;
  });
}
function error(e){$('strip').hidden=false;$('strip').textContent=String(e.message||e);}
async function call(cmd,args){try{return await api.invoke(cmd,args);}catch(e){error(e);throw e;}}
function action(fn){return ()=>Promise.resolve().then(fn).catch(()=>{});}
function selected(id,value){for(const b of $(id).querySelectorAll('button')){b.classList.toggle('on',b.dataset.v===String(value));b.setAttribute('aria-pressed',b.dataset.v===String(value));}placeSeg($(id));}
// The pill under a segmented control is measured from the chosen button. A control in a hidden tab measures
// nothing, so each tab places its own when shown, without the slide; after that, choices slide.
function placeSeg(seg){
  const on=seg.querySelector('button.on');
  if(!on||!on.offsetWidth){seg.classList.remove('placed');return;}
  seg.style.setProperty('--seg-x',on.offsetLeft-2+'px');seg.style.setProperty('--seg-w',on.offsetWidth+'px');
  if(!seg.classList.contains('placed'))requestAnimationFrame(()=>requestAnimationFrame(()=>seg.classList.add('placed')));
}
addEventListener('resize',()=>{for(const seg of document.querySelectorAll('.seg'))placeSeg(seg);paintNotch();});
function toggle(id,on){$(id).classList.toggle('on',on);$(id).setAttribute('aria-checked',String(on));}
function renderFlags(v){flags=v;selected('seg-show',!v.notch_visible?'hide':v.notch_on_hover?'hover':'show');toggle('sw-tray',!!v.tray_visible);}

/* ---- springs ----
   The notch's own spring (morphHandles in shape.js): a response in seconds and a damping ratio, stepped each
   frame. A spring caught mid-flight keeps its speed into the next target, so a row that is pushed aside and
   then called back turns round instead of restarting, and a dropped row carries the pointer's throw. */
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const live=new Set();let springFrame=0,springLast=0;
function spring(x,apply,eps=.05){return {x,v:0,to:x,response:.34,damping:.86,eps,apply,done:null};}
function springTo(s,to,response=.34,damping=.86){
  s.to=to;s.response=response;s.damping=damping;
  if(reduced.matches){s.x=to;s.v=0;live.delete(s);s.apply();s.done?.();return;}
  live.add(s);if(!springFrame){springLast=performance.now();springFrame=requestAnimationFrame(stepSprings);}
}
// Direct manipulation: the value is wherever the pointer says, with no spring between
function hold(s,x){s.x=x;s.to=x;s.v=0;live.delete(s);s.apply();}
function stepSprings(now){
  const dt=Math.min(.032,(now-springLast)/1000);springLast=now;
  const paint=new Set(),done=[];
  for(const s of live){
    const w=2*Math.PI/s.response;
    s.v+=(-w*w*(s.x-s.to)-2*s.damping*w*s.v)*dt;s.x+=s.v*dt;
    if(Math.abs(s.x-s.to)<s.eps&&Math.abs(s.v)<s.eps*8){s.x=s.to;s.v=0;live.delete(s);if(s.done)done.push(s.done);}
    paint.add(s.apply);
  }
  for(const f of paint)f();
  for(const f of done)f();
  springFrame=live.size?requestAnimationFrame(stepSprings):0;
}

/* ---- usage readings, drawn the way the notch draws them ---- */
// The ring's window: the same choice as headlineOf in notch.js for the providers this build collects
function usedOf(a){
  const ws=(a.snap?.windows||[]).filter(w=>w.count==null&&Number.isFinite(w.used));if(!ws.length)return null;
  const by=id=>ws.find(w=>w.id===id), tightest=list=>list.reduce((x,y)=>!x||y.used>x.used||(y.used===x.used&&y.id<x.id)?y:x,null);
  const family=ws.filter(w=>w.id.toLowerCase().startsWith('gemini')), lanes=family.length?family:ws;
  const w=a.base==='claude'?by('session')||ws[0]:a.base==='codex'?by('primary')||ws[0]:tightest(lanes.filter(w=>w.used<1))||tightest(lanes);
  return Math.max(0,Math.min(1,w.used));
}
const staleOf=snap=>snap?.status==='stale'||(snap?.fetched_at>0&&Date.now()-snap.fetched_at>15*60*1000);
const NOTCH_PALETTE={ample:'#00FF88',watch:'#F2FF00',crit:'#FF3F00',track:'#303030',hole:'#2a2a2a'};
let palette={...NOTCH_PALETTE,track:'rgba(255,255,255,.11)'};
function readPalette(){const s=getComputedStyle(document.documentElement),v=n=>s.getPropertyValue('--'+n).trim();palette={ample:v('ample'),watch:v('watch'),crit:v('crit'),track:v('track')};}
function tone(f,p){
  if(colorTransition!=='ramp')return f>=.7?p.crit:f>=.5?p.watch:p.ample;
  const rgb=c=>{const n=parseInt(c.slice(1),16);return [(n>>16)&255,(n>>8)&255,n&255];};
  const mix=(a,b,t)=>{const A=rgb(a),B=rgb(b);return `rgb(${A.map((x,i)=>Math.round(x+(B[i]-x)*t)).join(',')})`;};
  return f<.5?mix(p.ample,p.watch,f/.5):mix(p.watch,p.crit,(f-.5)/.5);
}
function ring(used,size,r,width,p,hole){
  const c=size/2, C=2*Math.PI*r;
  // Nothing at all at zero: a zero-length dash still paints a dot once the caps are round
  const arc=used>0?`<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${tone(used,p)}" stroke-width="${width}" stroke-linecap="round" stroke-dasharray="${(C*used).toFixed(2)} ${C.toFixed(2)}" transform="rotate(-90 ${c} ${c})"/>`:'';
  return (hole?`<circle cx="${c}" cy="${c}" r="${r-width/2-.6}" fill="${hole}"/>`:'')+`<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${p.track}" stroke-width="${width}"/>`+arc;
}
function paintGlyph(el,a){
  const svg=glyphs[a.base]?.kind==='svg'?glyphs[a.base].svg:'', key=svg?a.base:'letter:'+(a.glyph||a.name[0]||'');
  if(el.dataset.key===key)return;el.dataset.key=key;
  el.classList.toggle('letter',!svg);
  if(svg)el.innerHTML=svg; // the app's own bundled marks
  else el.textContent=a.glyph||a.name.slice(0,1);
}
const enabledIds=()=>slots.length?slots.map(s=>s.provider):accounts.map(a=>a.id);

/* ---- accounts ----
   Rows are kept, not rebuilt, so an order that changes (a drop, Alt+arrow, another window) is shown as the
   rows travelling: each is put in its new place and its spring given the distance it jumped, then released. */
const rows=new Map(), list=$('acc-list');
const BELL='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 11.1V7.4a3.8 3.8 0 0 1 7.6 0v3.7l1.3 1.4H2.9z"/><path d="M6.6 14.3h2.8"/><path class="gap" d="M2.5 2.5l11 11"/><path class="strike" d="M2.5 2.5l11 11"/></svg>';
function paintRow(r){
  const lift=r.lift.x, moving=r.y.x||r.x.x||r.tilt.x||lift;
  r.el.style.transform=moving?`translate3d(${r.x.x.toFixed(2)}px,${r.y.x.toFixed(2)}px,0) rotate(${r.tilt.x.toFixed(3)}deg) scale(${(1+.024*lift).toFixed(4)})`:'';
  r.el.style.setProperty('--lift',Math.max(0,Math.min(1,lift)).toFixed(3));
}
function createRow(id){
  const el=document.createElement('div');el.className='acct';el.tabIndex=0;el.dataset.id=id;
  el.setAttribute('role','listitem');el.setAttribute('aria-keyshortcuts','Alt+ArrowUp Alt+ArrowDown');
  el.innerHTML=`<span class="acct-mark"><svg class="ring" viewBox="0 0 36 36" aria-hidden="true"></svg><span class="glyph" aria-hidden="true"></span></span>
    <span class="acct-text"><span class="acct-name"></span><span class="acct-detail" hidden></span></span>
    <span class="acct-actions"><button class="account-focus" type="button" aria-pressed="false"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 3H3v4m10-4h4v4M3 13v4h4m10-4v4h-4"/></svg></button><button class="notification-test" type="button" aria-pressed="false"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m8 4 7 6-7 6Z"/></svg></button><button class="bell" role="switch" aria-label="Usage warnings">${BELL}</button><button class="account-active switch" role="switch" aria-label="Show in notch"></button></span>`;
  const r={id,el,ringEl:el.querySelector('svg.ring'),glyph:el.querySelector('.glyph'),name:el.querySelector('.acct-name'),
    detail:el.querySelector('.acct-detail'),test:el.querySelector('.notification-test'),focus:el.querySelector('.account-focus'),bell:el.querySelector('.bell'),sw:el.querySelector('.account-active'),ringKey:''};
  const paint=()=>paintRow(r);
  r.y=spring(0,paint,.08);r.x=spring(0,paint,.08);r.tilt=spring(0,paint,.004);r.lift=spring(0,paint,.002);
  r.lift.done=()=>{if(!r.lift.x&&drag?.r!==r)el.classList.remove('settling');};
  r.sw.onclick=action(async()=>{
    const on=enabledIds(), next=on.includes(id)?on.filter(x=>x!==id):[...on,id];
    // The notch always shows at least one account: the last switch shakes its head instead of turning off
    if(!next.length){if(!reduced.matches)r.sw.animate([{translate:'0'},{translate:'-3px'},{translate:'3px'},{translate:'-2px'},{translate:'0'}],{duration:320,easing:'ease-out'});return;}
    const before=slots;
    // Shown at once, so the notch above springs with the click rather than after the round trip
    slots=next.length===accounts.length?[]:next.map(provider=>({provider}));renderAccounts();
    try{slots=await call('set_notch_slots',{slots});}catch(e){slots=before;throw e;}finally{renderAccounts();}
  });
  r.bell.onclick=action(async()=>{
    const before=alertPrefs, muted=alertPrefs.muted.includes(id)?alertPrefs.muted.filter(x=>x!==id):[...alertPrefs.muted,id];
    alertPrefs={...alertPrefs,muted};renderAccounts();
    try{renderAlerts(await call('set_alert_preferences',{muted}));}catch(e){renderAlerts(before);throw e;}
  });
  r.test.onclick=action(async()=>{
    notificationTestAccount=await call('set_notification_test',{account:id,on:notificationTestAccount!==id});renderAccounts();
  });
  r.focus.onclick=action(async()=>{
    const available=focusAccounts.filter(x=>accounts.some(a=>a.id===x)),next=available.includes(id)?available.filter(x=>x!==id):[...available,id];
    await changeFocusSelection(next);
  });
  el.addEventListener('pointerdown',e=>press(r,e));
  el.addEventListener('keydown',e=>{if(e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();nudge(id,e.key==='ArrowUp'?-1:1);}});
  rows.set(id,r);return r;
}
function updateRow(r,a,on){
  if(r.name.textContent!==a.name){r.name.textContent=a.name;r.el.setAttribute('aria-label',a.name);}
  paintGlyph(r.glyph,a);
  const used=usedOf(a), key=`${used}|${colorTransition}|${palette.ample}`;
  if(r.ringKey!==key){r.ringKey=key;r.ringEl.innerHTML=ring(used,36,16.2,2.6,palette);}
  r.el.classList.toggle('stale',staleOf(a.snap));
  const shown=on.includes(a.id), muted=alertPrefs.muted.includes(a.id);
  r.el.classList.toggle('off',!shown);
  r.sw.classList.toggle('on',shown);r.sw.setAttribute('aria-checked',String(shown));r.sw.setAttribute('aria-label',a.name);r.sw.title=shown?'Hide from notch':'Show in notch';
  r.bell.setAttribute('aria-checked',String(!muted));r.bell.setAttribute('aria-label',`Usage warnings for ${a.name}`);
  r.test.setAttribute('aria-pressed',String(notificationTestAccount===a.id));r.test.setAttribute('aria-label',`Test notification for ${a.name}`);
  r.focus.setAttribute('aria-pressed',String(focusAccounts.includes(a.id)));r.focus.setAttribute('aria-label',`Focus ${a.name}`);
  r.bell.title=muted?'Enable usage notifications':'Mute usage notifications';
  r.test.title=notificationTestAccount===a.id?'Stop test notification':'Test notification';
  r.focus.title=focusAccounts.includes(a.id)?'Remove from focus':'Focus at rest';
  r.focus.disabled=a.id==='collector';
  // A healthy account needs no status line; a stale or failed one says what went wrong
  const problem=a.snap.status==='ok'?'':a.snap.note||(a.snap.status==='stale'?'Showing the last reading':a.snap.status==='loading'?'Reading usage…':'Usage could not be read');
  r.detail.hidden=!problem;if(r.detail.textContent!==problem){r.detail.textContent=problem;}
}
function renderAccounts(){
  const ids=accounts.map(a=>a.id), on=enabledIds();
  for(const [id,r] of rows)if(!ids.includes(id)){r.el.remove();rows.delete(id);for(const s of [r.x,r.y,r.tilt,r.lift])live.delete(s);}
  for(const a of accounts)updateRow(rows.get(a.id)||createRow(a.id),a,on);
  if(!drag?.lifted)place(ids); // a drag owns the order until it is put down
  renderNotch();
}
function place(ids){
  const els=ids.map(id=>rows.get(id).el);
  if(list.children.length===els.length&&els.every((el,i)=>list.children[i]===el))return;
  // Where each row is drawn now: its slot plus whatever its spring still has in hand
  const drawn=[...rows.values()].filter(r=>r.el.isConnected).map(r=>[r,r.el.offsetTop+r.y.x]);
  const focused=document.activeElement;
  list.append(...els);
  if(focused&&focused!==document.activeElement&&list.contains(focused))focused.focus({preventScroll:true});
  for(const [r,top] of drawn){const jump=top-r.el.offsetTop;if(!jump&&!r.y.x)continue;r.y.x=jump;springTo(r.y,0,.4,.84);}
}
function commitOrder(order){
  const before=accounts;
  accounts=order.map(id=>before.find(a=>a.id===id));renderAccounts();
  action(async()=>{
    try{accounts=await call('set_account_order',{ids:order});slots=await call('get_notch_slots');}
    catch(e){accounts=await api.invoke('get_agent_accounts').catch(()=>before);throw e;}
    finally{renderAccounts();}
  })();
}
function nudge(id,delta){
  const order=accounts.map(a=>a.id), from=order.indexOf(id), to=from+delta;
  if(drag||from<0||to<0||to>=order.length)return;
  order.splice(from,1);order.splice(to,0,id);
  const r=rows.get(id);r.el.classList.add('settling');r.lift.v+=7;springTo(r.lift,0,.42,.62); // a small hop as it passes the other
  commitOrder(order);
}

/* ---- dragging ----
   The row follows the pointer exactly up and down, hangs off it on a band sideways and leans into a swing.
   The rows it passes slide out of its way; the notch above reorders as it goes. Put down, it springs into
   its slot carrying the speed it was thrown at. Escape puts it back. */
let drag=null;
const GAP=6, rubber=o=>22*(1-Math.exp(-o/90));
function press(r,e){
  if(e.button!==0||drag||e.target.closest('button'))return;
  drag={r,pointer:e.pointerId,x0:e.clientX,y0:e.clientY,px:e.clientX,py:e.clientY,vx:0,vy:0,t:e.timeStamp,moved:performance.now(),scroll0:$('body').scrollTop,lifted:false};
  r.el.setPointerCapture(e.pointerId);
  springTo(r.lift,-.4,.2,.9); // it gives a little under the pointer before it comes up
}
function lift(){
  const d=drag, order=accounts.map(a=>a.id);
  d.lifted=true;d.from=d.to=order.indexOf(d.r.id);
  d.slots=order.map(id=>{const el=rows.get(id).el;return {id,top:el.offsetTop,h:el.offsetHeight};});
  const own=d.slots[d.from];
  d.base=d.r.y.x; // a row still settling from its last drop is picked up where it is drawn
  d.step=own.h+GAP;d.min=-own.top;d.max=list.offsetHeight-own.top-own.h;
  document.documentElement.classList.add('dragging');d.r.el.classList.add('lifted','settling');
  springTo(d.r.lift,1,.3,.6);
  d.frame=requestAnimationFrame(dragFrame);
}
function follow(){
  const d=drag, raw=d.base+(d.py-d.y0)+($('body').scrollTop-d.scroll0);
  // Past either end of the list it pulls against a band rather than stopping dead
  hold(d.r.y,raw<d.min?d.min-rubber(d.min-raw):raw>d.max?d.max+rubber(raw-d.max):raw);
  hold(d.r.x,12*Math.tanh((d.px-d.x0)/120));
  springTo(d.r.tilt,Math.max(-2,Math.min(2,d.vx/700)),.22,.7);
  const own=d.slots[d.from], centre=own.top+own.h/2+d.r.y.x;
  let to=0;for(const [i,s] of d.slots.entries())if(i!==d.from&&s.top+s.h/2<centre)to++;
  if(to===d.to)return;
  d.to=to;
  for(const [i,s] of d.slots.entries()){
    if(i===d.from)continue;
    const shift=d.from<to&&i>d.from&&i<=to?-d.step:to<d.from&&i>=to&&i<d.from?d.step:0;
    springTo(rows.get(s.id).y,shift,.3,.84);
  }
  renderNotch();
}
function dragFrame(now){
  const d=drag;if(!d?.lifted)return;
  // Held near the top or bottom of the list, it scrolls, faster the further in
  const b=$('body').getBoundingClientRect(), edge=44, over=d.py<b.top+edge?d.py-b.top-edge:d.py>b.bottom-edge?d.py-b.bottom+edge:0;
  if(over)$('body').scrollTop+=Math.sign(over)*Math.min(16,(Math.abs(over)/edge)**2*16);
  // A pointer held still has no speed, whatever its last move was
  if(now-d.moved>40){d.vx*=.8;d.vy*=.8;}
  follow();
  d.frame=requestAnimationFrame(dragFrame);
}
function move(e){
  const d=drag;if(!d||e.pointerId!==d.pointer)return;
  const dt=Math.max(1,e.timeStamp-d.t)/1000, k=1-Math.exp(-dt/.05);
  d.vx+=((e.clientX-d.px)/dt-d.vx)*k;d.vy+=((e.clientY-d.py)/dt-d.vy)*k;
  d.px=e.clientX;d.py=e.clientY;d.t=e.timeStamp;d.moved=performance.now();
  if(!d.lifted){if(Math.hypot(d.px-d.x0,d.py-d.y0)<4)return;lift();}
  follow();
}
function release(keep){
  const d=drag;if(!d)return;drag=null;
  cancelAnimationFrame(d.frame);
  if(d.r.el.hasPointerCapture?.(d.pointer))d.r.el.releasePointerCapture(d.pointer);
  if(!d.lifted){springTo(d.r.lift,0,.3,.6);return;}
  document.documentElement.classList.remove('dragging');d.r.el.classList.remove('lifted');
  const order=accounts.map(a=>a.id);
  if(keep&&d.to!==d.from){order.splice(d.from,1);order.splice(d.to,0,d.r.id);}
  d.r.y.v=Math.max(-2400,Math.min(2400,d.vy));
  if(keep&&d.to!==d.from)commitOrder(order);else{place(order);renderNotch();}
  for(const s of d.slots)if(s.id!==d.r.id)springTo(rows.get(s.id).y,0,.34,.86);
  springTo(d.r.y,0,.44,.7);springTo(d.r.x,0,.4,.66);springTo(d.r.tilt,0,.42,.55);springTo(d.r.lift,0,.4,.9);
}
document.addEventListener('pointermove',move);
document.addEventListener('pointerup',e=>{if(drag&&e.pointerId===drag.pointer)release(true);});
document.addEventListener('pointercancel',e=>{if(drag&&e.pointerId===drag.pointer)release(false);});
document.addEventListener('lostpointercapture',e=>{if(drag&&e.pointerId===drag.pointer)release(true);},true);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drag){e.preventDefault();release(false);}});

/* ---- the window's own notch ----
   Hangs from the top of the Accounts page with the accounts it will show, in the order it will show them,
   and moves with the list: a drag reorders its rings as it goes, a switch takes one out. It grows out of
   the edge and leaves by sliding back past it, as the notch itself does. Always black: it is a cut-out. */
const N={S:28,G:8,P:12,D:44,F:11,R:16};
const notch={el:$('notch'),path:$('notch').querySelector('path'),svg:$('notch').querySelector('svg'),cells:new Map(),opening:true};
notch.width=spring(0,paintNotch,.1);notch.open=spring(0,paintNotch,.002);
function notchIds(){
  const order=accounts.map(a=>a.id), d=drag;
  if(d?.lifted&&d.to!==d.from){order.splice(d.from,1);order.splice(d.to,0,d.r.id);}
  const on=enabledIds();return order.filter(id=>on.includes(id));
}
function notchShape(w){
  const {D,F,R}=N, k=.5523, t=w+2*F;
  // Flares meet the edge at a tangent and turn straight down; the far corners are plain rounds
  return `M0 0C${F*k} 0 ${F} ${F*(1-k)} ${F} ${F}V${D-R}C${F} ${D-R*(1-k)} ${F+R*(1-k)} ${D} ${F+R} ${D}H${t-F-R}C${t-F-R*(1-k)} ${D} ${t-F} ${D-R*(1-k)} ${t-F} ${D-R}V${F}C${t-F} ${F*(1-k)} ${t-F*k} 0 ${t} 0Z`;
}
function paintNotch(){
  const w=Math.max(2*N.R,notch.width.x), total=w+2*N.F, o=notch.open.x;
  notch.svg.setAttribute('width',total);notch.svg.setAttribute('viewBox',`0 0 ${total} ${N.D}`);notch.svg.style.left=-total/2+'px';
  notch.path.setAttribute('d',notchShape(w));
  // Centred over the list, but never over the title or the close button of a narrow window
  const page=$('pane-accounts'), pane=$('pane').clientWidth, title=$('title'), after=title.offsetLeft+title.offsetWidth+20+total/2;
  const x=Math.min(Math.max(page.offsetWidth?page.offsetLeft+page.offsetWidth/2:pane/2,after),pane-52-total/2);
  if(notch.opening){notch.el.style.transform=`translate3d(${x.toFixed(1)}px,0,0)`;notch.el.style.clipPath=`inset(0 -50vw ${(Math.max(0,1-o)*(N.D+2)).toFixed(2)}px -50vw)`;}
  else{notch.el.style.transform=`translate3d(${x.toFixed(1)}px,${(-(1-o)*(N.D+4)).toFixed(2)}px,0)`;notch.el.style.clipPath='';}
  notch.el.style.visibility=o<=.001?'hidden':'';
}
function paintCell(c){
  const p=Math.max(0,c.presence.x);
  c.el.style.transform=`translate3d(${c.x.x.toFixed(2)}px,0,0) scale(${Math.min(1.08,p).toFixed(3)})`;c.el.style.opacity=Math.min(1,p).toFixed(3);
}
function renderNotch(){
  const ids=notchIds(), n=ids.length, pitch=N.S+N.G;
  for(const [i,id] of ids.entries()){
    const a=accounts.find(x=>x.id===id);if(!a)continue;
    let c=notch.cells.get(id);const x=(i-(n-1)/2)*pitch;
    if(!c){
      const el=document.createElement('div');el.className='n-cell';el.innerHTML='<svg class="ring" viewBox="0 0 28 28"></svg><span class="glyph"></span>';
      c={el,ringEl:el.firstChild,glyph:el.lastChild,key:''};const paint=()=>paintCell(c);
      c.x=spring(x,paint,.05);c.presence=spring(notch.open.x>.5?0:1,paint,.003);
      notch.el.append(el);notch.cells.set(id,c);paint();
    }
    c.presence.done=null;
    springTo(c.x,x,.36,.8);springTo(c.presence,1,.34,.62);
    paintGlyph(c.glyph,a);
    const used=usedOf(a), key=`${used}|${colorTransition}`;
    if(c.key!==key){c.key=key;c.ringEl.innerHTML=ring(used,28,12.2,2.6,NOTCH_PALETTE,NOTCH_PALETTE.hole);}
    c.el.classList.toggle('stale',staleOf(a.snap));
  }
  for(const [id,c] of notch.cells)if(!ids.includes(id)&&c.presence.to!==0){
    c.presence.done=()=>{if(c.presence.x<=0){c.el.remove();notch.cells.delete(id);}};
    springTo(c.presence,0,.24,.9);
  }
  // Closed, it takes its size at once: it grows out of the edge at the width it will have, not spreading as it comes
  const width=n?n*N.S+(n-1)*N.G+2*N.P:0;
  if(notch.open.x<.01&&notch.open.to===0)hold(notch.width,width);else springTo(notch.width,width,.4,.76);
  showNotch(activeTab==='accounts'&&n>0);
}
function showNotch(on){
  if(on===(notch.open.to===1))return;
  notch.opening=on;
  springTo(notch.open,on?1:0,on?.5:.34,on?.74:1);
}

/* ---- sections ----
   One soft pill slides to the chosen section. The bar beside it is Windows' own: its leading end runs ahead
   and the trailing end catches up, so it stretches on the way and lands short. */
const nav={};
function paintNav(){$('nav-pill').style.transform=`translate3d(0,${nav.pill.x.toFixed(2)}px,0)`;$('nav-bar').style.transform=`translate3d(0,${nav.top.x.toFixed(2)}px,0)`;$('nav-bar').style.height=Math.max(0,nav.bottom.x-nav.top.x).toFixed(2)+'px';}
nav.pill=spring(0,paintNav,.05);nav.top=spring(0,paintNav,.05);nav.bottom=spring(0,paintNav,.05);
function placeNav(tab,animate){
  const y=$('tab-'+tab).offsetTop, top=y+10, bottom=y+26;
  if(!animate){hold(nav.pill,y);hold(nav.top,top);hold(nav.bottom,bottom);$('side').classList.add('placed');return;}
  const down=top>nav.top.x;
  springTo(nav.pill,y,.34,.86);
  springTo(nav.top,top,down?.46:.26,.92);springTo(nav.bottom,bottom,down?.26:.46,.92);
}
const TABS=['accounts','appearance','general'];
for(const tab of TABS) $('tab-'+tab).onclick=()=>{
  for(const name of TABS){$('pane-'+name).hidden=name!==tab;$('tab-'+name).setAttribute('aria-selected',name===tab);$('tab-'+name).classList.toggle('sel',name===tab);$('tab-'+name).tabIndex=name===tab?0:-1;}
  $('title').textContent=tab[0].toUpperCase()+tab.slice(1);
  placeNav(tab,!!activeTab&&activeTab!==tab);activeTab=tab;
  for(const seg of $('pane-'+tab).querySelectorAll('.seg'))placeSeg(seg);
  paintNotch();showNotch(tab==='accounts'&&notchIds().length>0);
};
$('side').addEventListener('keydown',e=>{
  if(e.key!=='ArrowDown'&&e.key!=='ArrowUp')return;
  const i=TABS.indexOf(activeTab)+(e.key==='ArrowDown'?1:-1);if(i<0||i>=TABS.length)return;
  e.preventDefault();$('tab-'+TABS[i]).click();$('tab-'+TABS[i]).focus();
});
const initialTab=new URLSearchParams(location.search).get('tab');
$('tab-'+(TABS.includes(initialTab)?initialTab:'accounts')).click();
api.on('settings_tab',tab=>{if(TABS.includes(tab))$('tab-'+tab).click();});

function renderAlerts(prefs){alertPrefs=prefs;for(const key of ['quota','waiting','completion','sound'])toggle('sw-alert-'+key,!!prefs[key]);renderAccounts();}
for(const key of ['quota','waiting','completion','sound'])$('sw-alert-'+key).onclick=action(async()=>renderAlerts(await call('set_alert_preferences',{[key]:!alertPrefs[key]})));
api.on('alert_preferences',renderAlerts);
api.on('notification_test',v=>{notificationTestAccount=v;renderAccounts();});
call('get_notification_test').then(v=>{notificationTestAccount=v;renderAccounts();}).catch(()=>{});
api.on('notch_slots',v=>{slots=v;renderAccounts();});
$('close').onclick=action(()=>call('close_settings'));
$('quit').onclick=action(()=>call('quit_app'));
$('refresh-usage').onclick=action(()=>call('refresh_ring'));
$('btn-data').onclick=action(()=>call('open_data_dir'));
$('btn-recentre').onclick=action(()=>call('reset_notch_position'));
$('save-collector').onclick=action(async()=>{await call('set_collector',{source:$('source').value,sshTarget:$('ssh').value.trim()});$('strip').hidden=false;$('strip').textContent='Collector saved; refreshing…';});
$('shortcut').onchange=action(async()=>{try{await call('set_shortcut',{shortcut:$('shortcut').value});}finally{const c=await call('get_collector');$('shortcut').value=c.shortcut;}});
$('seg-show').onclick=event=>{const b=event.target.closest('button');if(!b)return;action(async()=>renderFlags(await call('set_ui_flags',{notchVisible:b.dataset.v!=='hide',notchOnHover:b.dataset.v!=='show'})))();};
$('sw-tray').onclick=action(async()=>renderFlags(await call('set_ui_flags',{trayVisible:!$('sw-tray').classList.contains('on')})));
// The colour transition also recolours the rings on this page, so its value is kept as well as shown
const kept={'seg-transition':v=>{colorTransition=v;renderAccounts();}};
for(const [id,get,set,key] of [['seg-size','get_scale','set_scale','scale'],['seg-theme','get_theme','set_theme','theme'],['seg-weekly','get_weekly_ring','set_weekly_ring','placement'],['seg-transition','get_color_transition','set_color_transition','style'],['seg-edge','get_notch_edge','set_notch_edge','edge']]){
  const show=v=>{selected(id,v);kept[id]?.(v);};
  action(async()=>show(await call(get)))();
  $(id).onclick=e=>{const b=e.target.closest('button');if(b)action(async()=>{show(await call(set,{[key]:key==='scale'?Number(b.dataset.v):b.dataset.v}));})()};
}
api.on('color_transition',v=>{if(typeof v==='string'){selected('seg-transition',v);kept['seg-transition'](v);}});
for(const [id,get,set] of [['sw-autostart','get_autostart','set_autostart']]){
  action(async()=>toggle(id,await call(get)))();
  $(id).onclick=action(async()=>toggle(id,await call(set,{on:!$(id).classList.contains('on')})));
}
$('screen').onchange=action(()=>call('set_notch_monitor',{id:$('screen').value}));
// Pin lives in the leading pocket and the alerts bell at the end of the rings; Refresh lives here in General.
function renderButtons(v){if(!v)return;toggle('sw-pin-button',v.pin!==false);toggle('sw-alerts-button',v.alerts!==false);}
action(async()=>renderButtons(await call('get_notch_buttons')))();
for(const [id,key] of [['sw-pin-button','pin'],['sw-alerts-button','alerts']])
  $(id).onclick=action(async()=>renderButtons(await call('set_notch_buttons',{[key]:!$(id).classList.contains('on')})));
api.on('notch_buttons',renderButtons);
api.on('ui_flags',renderFlags);
api.on('agent_accounts',v=>{accounts=v;renderAccounts();});
api.on('glyphs',v=>{glyphs=v||{};renderAccounts();});
function applyTheme(v){document.documentElement.dataset.theme=v;readPalette();renderAccounts();}
api.on('theme_resolved',applyTheme);
readPalette();
action(async()=>{
  applyTheme(await call('get_theme_resolved'));
  const c=await call('get_collector');$('source').value=c.source;$('ssh').value=c.sshTarget;$('shortcut').value=c.shortcut;if(c.error)error(c.error);
  alertPrefs=await call('get_alert_preferences');slots=await call('get_notch_slots');accounts=await call('get_agent_accounts');glyphs=await call('get_glyphs').catch(()=>({}))||{};
  renderAlerts(alertPrefs);renderFlags(await call('get_ui_flags'));
  $('about-version').textContent=await call('get_version');
  const monitors=await call('get_monitors');$('row-screen').hidden=false;
  for(const m of monitors){const o=document.createElement('option');o.value=m.id;o.textContent=m.label;o.selected=m.current;$('screen').append(o);}
})();

let updateState={status:'idle'};
let updateReadyTimer;
function renderUpdate(state){
  const finishing=state.status==='ready'&&updateState.status==='downloading'&&!matchMedia('(prefers-reduced-motion: reduce)').matches;
  clearTimeout(updateReadyTimer);
  updateState=state;
  const percent=state.status==='ready'?100:Math.max(0,Math.min(100,Number(state.percent)||0));
  const progressing=state.status==='downloading'||state.status==='ready';
  $('update-row').style.setProperty('--update-progress',`${progressing?percent:0}%`);
  $('update-progress').hidden=state.status!=='downloading'&&!finishing;
  $('update-progress').setAttribute('aria-valuenow',percent);
  if(finishing){
    $('update-status').textContent='Downloading 100%';
    $('update-action').disabled=true;
    updateReadyTimer=setTimeout(()=>renderUpdate(state),220);
    return;
  }
  const labels={idle:['Updates','Check'],checking:['Checking…','Check'],current:['Up to date','Check'],available:[`Version ${state.version}`,'Update'],downloading:[`Downloading ${percent}%`,'Update'],ready:['Ready to update','Restart'],installing:['Restarting…','Restart'],error:['Update failed','Retry'],unavailable:['Updates unavailable','Check']};
  const [label,button]=labels[state.status]||labels.idle;
  $('update-status').textContent=label;$('update-action').textContent=button;
  $('update-action').disabled=['checking','downloading','installing','unavailable'].includes(state.status);
}
$('update-action').onclick=action(()=>call(updateState.status==='ready'?'install_update':updateState.status==='available'?'download_update':'check_for_update'));
api.on('update_state',renderUpdate);
action(async()=>renderUpdate(await call('get_update_state')))();
