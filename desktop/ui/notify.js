'use strict';
/* Alerts grow out of the account they are about, as a sliver of the notch: a rounded rectangle spanning its share of the notch,
   sized to its text. It springs out a little past its length
   and settles, liquid while it moves, and its words arrive once there is black under them. Pointing at it holds
   it and counts it as seen; a click opens its linked session or account usage. Alerts for several accounts come out of their own
   rings together on side edges; flat-edge lifts take turns to keep text readable. An open card comes first: alerts wait. */
const SLIVER={flat:54,flatMin:128,flatMax:160,pad:14,max:228,grace:1600};
const alertQueue=[], slivers=new Map();
let pumpTimer=0, slivHeld=false, sliverSerial=0;
const UPDATE_ID='__update';
let updateState={status:'idle'}, updatePending=false, updateAction=false, updateHovered=false, updateEscape=false, updateRimPending=false;
const updateVisible=()=>['available','downloading','ready','installing','error'].includes(updateState.status);
const updateDot=document.getElementById('update-dot');
const updateActionable=()=>['available','ready','error'].includes(updateState.status);
const sliverSvg=document.createElementNS(SVG_NS,'svg');sliverSvg.id='sliver-shape';sliverSvg.setAttribute('aria-hidden','true');
pill.before(sliverSvg);
const slivering=()=>slivers.size>0;
let notificationTestTimer=0;
function queueNotificationTest(){
  clearTimeout(notificationTestTimer);
  const account=window.notificationTestAccount;if(!account)return;
  if(alertWaits()){notificationTestTimer=setTimeout(queueNotificationTest,200);return;}
  if(slivers.get(account)?.test){drawSliver(slivers.get(account));return;}
  showSliver(account,[{kind:'completion',account,session:'Test notification · A longer sample to check scrolling',took:120000,test:true}],0);
}
listen('notification_test',e=>{
  window.notificationTestAccount=e.payload||null;clearTimeout(notificationTestTimer);
  for(const s of [...slivers.values()])if(s.test)dropSliver(s);
  renderRing();
  if(window.notificationTestAccount){hideCard();retractSlivers(true);queueNotificationTest();}else pumpAlert();
}).catch(()=>{});
listen('appear',()=>{queueNotificationTest();placeUpdateDot();}).catch(()=>{});
listen('layout',()=>queueNotificationTest()).catch(()=>{});
listen('alert',e=>{
  const p=e.payload;if(!p||!Array.isArray(p.events)||!p.events.length)return;
  // Already reading the log: the alert is there at the top of it, so it does not open a second time
  if(logShowing()){if(p.sound)chime(p.events[0].kind);ringBell();return;}
  // Update options keep this space until dismissed; agent alerts remain queued and in the log.
  alertQueue.push(p);pumpAlert();
}).catch(()=>{});
// Not over something the person is doing: while the notch is arriving, carried, tracking or showing a card
function alertWaits(){
  return !shown||performance.now()-shownAt<420||window.agentTracking||carrying||dragging||card.classList.contains('show');
}
function pumpAlert(){
  clearTimeout(pumpTimer);
  if(updatePending){pumpUpdate();return;}
  if(slivers.has(UPDATE_ID))return;
  if(!alertQueue.length){pumpUpdate();return;}
  if(alertWaits()){pumpTimer=setTimeout(pumpAlert,200);return;}
  // Completions share one compact stack, including bursts that arrive while the first is still out.
  // Waiting and usage warnings retain their severity and their account's own sliver.
  if(typeof FINISHED_ID!=='undefined'&&!alertQueue.some(p=>p.events.some(e=>e.kind!=='completion'))){
    const active=[...slivers.values()].filter(s=>s.to&&!s.test&&s.events.every(e=>e.kind==='completion'));
    const events=[...active.flatMap(s=>s.events),...alertQueue.flatMap(p=>p.events)];
    const unique=[...new Map(events.map(e=>[e.id||[e.account,e.session,e.took].join(':'),e])).values()];
    if(unique.length>1){
      const sound=alertQueue.some(p=>p.sound),hold=Math.max(6500,...alertQueue.map(p=>p.hold||6500));alertQueue.length=0;
      for(const s of active)if(s.account!==FINISHED_ID)retract(s);
      showSliver(FINISHED_ID,unique,hold);if(sound)chime('completion');reportHot();return;
    }
  }
  if(!edgeIsVertical()&&slivering()){pumpTimer=setTimeout(pumpAlert,200);return;}
  while(alertQueue.length){
    const p=alertQueue.shift(), byAccount=new Map();
    for(const e of p.events){const key=providers().some(x=>x.id===e.account)?e.account:'';(byAccount.get(key)||byAccount.set(key,[]).get(key)).push(e);}
    const groups=[...byAccount];
    if(!edgeIsVertical()&&groups.length>1){
      const later=groups.splice(1);alertQueue.unshift({...p,events:later.flatMap(([,events])=>events),sound:false});
    }
    for(const [account,events] of groups)showSliver(account,events,p.hold||6500);
    if(p.sound)chime(p.events[0].kind);
    // Flat-edge lifts share limited room: show accounts in order so their text never overlaps.
    if(!edgeIsVertical())break;
  }
  if(alertQueue.length)pumpTimer=setTimeout(pumpAlert,200);
  reportHot();
}
// The words an alert gets: a word in the colour of what it reports, then the reading or the session
const ALERT_RANK={quota100:0,waiting:1,quota80:2,completion:3};
function sliverLine(events){
  if(events[0]?.kind==='update')return updateLine();
  if(events.length>1&&events.every(e=>e.kind==='completion'))return `<span class="s-word" style="color:${INK}">${events.length} finished</span><span class="s-text"><span class="s-scroll">Choose a session</span></span>`;
  const kick=ui().kick||UI.en.kick;
  const e=[...events].sort((a,b)=>ALERT_RANK[a.kind==='quota'?'quota'+(a.level===100?100:80):a.kind]-ALERT_RANK[b.kind==='quota'?'quota'+(b.level===100?100:80):b.kind])[0];
  const acct=providers().find(x=>x.id===e.account);
  let word,colour,text;
  if(e.kind==='quota'){
    const w=acct?.snap.windows.find(x=>x.id===e.window);
    word=e.level===100?kick.limit:kick.warning;colour=tone(Math.min(1,Math.max(w?w.used:1,(e.level||80)/100)));
    text=w?`${textCopy(w.label)} · ${usedParts(w)[0]}%`:'';
  }else if(e.kind==='waiting'){word=kick.waiting;colour=WATCH;text=e.session||'';}
  else{word=kick.finished;colour=INK;text=[e.session,e.took!=null?tookText(e.took):''].filter(Boolean).join(' · ');}
  if(!acct)text=[e.session||'',text].filter(Boolean).join(' · ')||text;
  const more=events.length>1?`<span class="s-more">+${events.length-1}</span>`:'';
  return `<span class="s-word" style="color:${colour}">${esc(word)}</span>${text?`<span class="s-text"><span class="s-scroll">${esc(text)}</span></span>`:''}${more}`;
}
function showSliver(account,events,hold){
  let s=slivers.get(account);
  const arriving=!s||!s.to;
  if(!s){
    const el=document.createElement('div');el.className='sliver';el.dataset.account=account;
    const path=document.createElementNS(SVG_NS,'path');path.setAttribute('class','sliver-ink');
    const id='sliver-goo-'+(++sliverSerial);sliverSvg.insertAdjacentHTML('beforeend',`<defs>${gooDefinition(id)}</defs>`);
    const filter=sliverSvg.querySelector('#'+id);sliverSvg.append(path);
    card.parentElement.append(el);
    s={account,el,path,filter,events:[],t:0,v:0,to:1,frame:0,timer:0,length:0};slivers.set(account,s);placeUnreadDot();
    el.setAttribute('role','button');el.tabIndex=0;
    const activate=()=>{if(s.account===UPDATE_ID){activateUpdate();return;}if(typeof FINISHED_ID!=='undefined'&&s.account===FINISHED_ID){markSeen(s);openCompletionStack(s.events);return;}markSeen(s);retractSlivers();openNotifiedAlert(s.events.find(e=>e.target)||s.events[0],s.account);};
    el.addEventListener('click',activate);
    el.addEventListener('mouseenter',()=>{if(typeof FINISHED_ID!=='undefined'&&s.account===FINISHED_ID&&s.to){markSeen(s);openCompletionStack(s.events);}});
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});
  }
  s.test=events.every(e=>e.test===true);
  const stack=typeof FINISHED_ID!=='undefined'&&account===FINISHED_ID;
  s.events=account===UPDATE_ID||stack?events.slice(0,40):[...events,...s.events.filter(e=>!e.test)].slice(0,6);s.to=1;s.seen=false;
  s.el.classList.toggle('sliver-stack',stack);if(stack)s.el.setAttribute('aria-label',`${s.events.length} finished sessions. Show sessions`);
  if(typeof setFocusExpanded==='function')setFocusExpanded(true);
  s.scroll?.cancel();s.scroll=null;s.scrollDistance=null;
  s.el.innerHTML=sliverLine(s.events);
  // Only as long as the line: measured laid out on one line, then the sliver is cut to it
  s.el.style.height='auto';s.el.style.width='max-content';
  const natural=s.el.scrollWidth;
  s.length=Math.min(SLIVER.max,natural+2*SLIVER.pad);
  clearTimeout(s.timer);s.hold=hold;if(!slivHeld&&!s.test)s.timer=setTimeout(()=>retract(s),hold);
  springSliver(s);
  if(typeof notificationRim!=='undefined'&&(arriving||account!==UPDATE_ID))notificationRim.start(s.el.querySelector('.s-word')?.style.color||INK);
}
function springSliver(s){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){s.t=s.to;s.v=0;drawSliver(s);if(!s.to)dropSliver(s);return;}
  if(s.frame)return;
  let last=performance.now();
  const step=now=>{
    const dt=Math.min(.032,(now-last)/1000);last=now;
    // Out on a loose spring that stretches past its length and settles; back in quickly, without a bounce
    const omega=2*Math.PI/(s.to?.54:.3),zeta=s.to?.56:1;
    s.v+=(-omega*omega*(s.t-s.to)-2*zeta*omega*s.v)*dt;s.t+=s.v*dt;
    const settled=Math.abs(s.t-s.to)<.002&&Math.abs(s.v)<.02;
    if(settled){s.t=s.to;s.v=0;}
    drawSliver(s);
    if(settled){s.frame=0;if(!s.to)dropSliver(s);reportHot();}else s.frame=requestAnimationFrame(step);
  };
  s.frame=requestAnimationFrame(step);
}
// Rounded rectangles share the notch's 20px corners and overlap its front so their roots stay seamless.
function notificationRectPath(u0,u1,d){
  const rad=Math.min(SHAPE.corner,(u1-u0)/2,d);
  return `M${n(u0)} ${-SHAPE.bleed}V${n(d-rad)}A${n(rad)} ${n(rad)} 0 0 0 ${n(u0+rad)} ${n(d)}`
    +`H${n(u1-rad)}A${n(rad)} ${n(rad)} 0 0 0 ${n(u1)} ${n(d-rad)}V${-SHAPE.bleed}Z`;
}
function drawSliver(s){
  const origin=document.getElementById('root').getBoundingClientRect(), W=innerWidth, H=innerHeight;
  const matrix=edgeMatrix(notchEdge,W,H), local=(x,y)=>[matrix[0]*(x-matrix[4])+matrix[1]*(y-matrix[5]),matrix[2]*(x-matrix[4])+matrix[3]*(y-matrix[5])];
  const screen=(u,v)=>[matrix[0]*u+matrix[2]*v+matrix[4],matrix[1]*u+matrix[3]*v+matrix[5]];
  const cell=s.account&&pill.querySelector(`.cell[data-p="${CSS.escape(s.account)}"]`), vertical=edgeIsVertical();
  const notch=pill.getBoundingClientRect(), [start]=local(notch.left-origin.left,notch.top-origin.top);
  const length=vertical?notch.height:notch.width, end=start+length;
  const cells=[...pill.querySelectorAll('.cell')].map(el=>{
    const box=el.getBoundingClientRect();return {el,u:local(box.left+box.width/2-origin.left,box.top+box.height/2-origin.top)[0]};
  }).sort((a,b)=>a.u-b.u);
  const index=s.account===UPDATE_ID||typeof FINISHED_ID!=='undefined'&&s.account===FINISHED_ID?0:cells.findIndex(a=>a.el===cell);
  const depth=edgeDepth(notchEdge), rootDepth=depth-SHAPE.corner, t=Math.max(0,s.t), grown=Math.min(1,t);
  let u0,u1,d;
  if(vertical){
    // Divide the entire notch, including its end padding, into equal physical account sections.
    const count=index<0?1:cells.length, section=length/count;
    u0=start+Math.max(0,index)*section;u1=u0+section;d=s.length*t;
  }else{
    const span=Math.min(length,SLIVER.flatMax,Math.max(SLIVER.flatMin,s.length-2*SLIVER.pad));
    // End accounts extend their outside edge. Middle accounts sit nearer the notch's center, on their own side.
    const middle=(start+end)/2, center=middle+((cells[index]?.u??middle)-middle)*.65;
    u0=index===0?start:index===cells.length-1?end-span:Math.max(start,Math.min(end-span,center-span/2));
    u1=u0+span;d=SLIVER.flat*Math.min(1.25,t);
  }
  if(d<.5){s.path.removeAttribute('d');s.el.style.opacity=0;if(s.account===UPDATE_ID)updateProgress.clear();return;}
  const inkDepth=d+depth-rootDepth;
  s.path.setAttribute('d',notificationRectPath(u0,u1,inkDepth));
  const rimRadius=Math.min(SHAPE.corner,(u1-u0)/2,inkDepth);
  s.path.rimPart=[u0,u1,inkDepth,rimRadius,0,rimRadius,0,-SHAPE.bleed];
  s.path.setAttribute('transform',`matrix(${matrix.join(' ')}) translate(0 ${n(rootDepth)})`);
  // Liquid while it moves, sharp at rest
  const goo=matchMedia('(prefers-reduced-motion: reduce)').matches?0:4.4*Math.sin(Math.PI*grown)*(s.t===s.to?0:1);
  if(goo>.25){
    setGooBlur(s.filter,goo);
    const ink0=u0, ink1=u1;
    for(const [key,value] of Object.entries({x:ink0-40,y:-SHAPE.bleed-40,width:ink1-ink0+80,height:inkDepth+SHAPE.bleed+80}))s.filter.setAttribute(key,n(value));
    s.path.setAttribute('filter',`url(#${s.filter.id})`);
  }else s.path.removeAttribute('filter');
  // Its words sit on the black once there is black to hold them
  const a=screen(u0,depth+SLIVER.pad*.4),b=screen(u1,depth+d-SLIVER.pad*.4);
  const x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]);
  Object.assign(s.el.style,{left:x+'px',top:y+'px',width:Math.abs(a[0]-b[0])+'px',height:Math.abs(a[1]-b[1])+'px',opacity:smooth((t-.74)/.26).toFixed(3)});
  if(s.account===UPDATE_ID)updateProgress.draw(updateState,{x,y,width:Math.abs(a[0]-b[0]),height:Math.abs(a[1]-b[1]),opacity:smooth((t-.74)/.26)});
  if(s.to&&s.t===s.to)scrollSliver(s);
  if(typeof notificationRim!=='undefined')notificationRim.refresh();
}
function scrollSliver(s){
  const clip=s.el.querySelector('.s-text'), text=clip?.querySelector('.s-scroll');
  const distance=text?Math.max(0,text.scrollWidth-clip.clientWidth):0;
  if(s.scrollDistance===distance)return;
  s.scroll?.cancel();s.scroll=null;s.scrollDistance=distance;
  if(distance<2||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  // Keep the status still. Read the beginning, pan to the end, pause, then return without a jump.
  const pause=1400, travel=Math.max(2000,distance/24*1000), duration=2*(pause+travel);
  s.scroll=text.animate([{transform:'translateX(0)',offset:0},{transform:'translateX(0)',offset:pause/duration},
    {transform:`translateX(-${distance}px)`,offset:(pause+travel)/duration},
    {transform:`translateX(-${distance}px)`,offset:(2*pause+travel)/duration},{transform:'translateX(0)',offset:1}],
    {duration,iterations:Infinity,easing:'linear'});
  if(!slivHeld&&!s.test){clearTimeout(s.timer);s.timer=setTimeout(()=>retract(s),Math.max(s.hold,pause*2+travel));}
}
function dropSliver(s){cancelAnimationFrame(s.frame);s.scroll?.cancel();clearTimeout(s.timer);s.el.remove();s.path.remove();s.filter.parentElement.remove();slivers.delete(s.account);if(s.account===UPDATE_ID)updateProgress.clear();placeUnreadDot();reportHot();if(!slivers.size){ringBell();if(typeof scheduleFocusRest==='function')scheduleFocusRest();}if(window.notificationTestAccount)notificationTestTimer=setTimeout(queueNotificationTest,200);if(alertQueue.length||updatePending){clearTimeout(pumpTimer);pumpTimer=setTimeout(pumpAlert,0);}}
function retract(s){clearTimeout(s.timer);s.to=0;springSliver(s);}
// Everything back in at once: a card opening over them, or the notch going away (then without the motion)
function retractSlivers(now=false){for(const s of [...slivers.values()]){if(now){dropSliver(s);continue;}retract(s);}}
function stowTrackingNotifications(){
  updateHovered=false;updatePending=false;slivHeld=false;
  retractSlivers(true);if(typeof notificationRim!=='undefined')notificationRim.clear();
}
// A settled sliver has no running spring. Clear it before the notch moves so neither its
// words nor its ink can remain at the old position while the pointer carries the notch away.
listen('edge_cursor',stowTrackingNotifications).catch(()=>{});
listen('move_begin',stowTrackingNotifications).catch(()=>{});
listen('layout',e=>{if(e.payload.tracking)stowTrackingNotifications();}).catch(()=>{});
// Only the part of a sliver outside the notch is the sliver: its root overlaps the notch, and the ring it came
// from has to stay a ring under the pointer
function sliverAt(x,y){
  for(const s of slivers.values()){const r=s.el.getBoundingClientRect();if(s.to&&r.width&&x>=r.left-6&&x<=r.right+6&&y>=r.top-6&&y<=r.bottom+6)return s;}
  return null;
}
function sliverRects(){return [...slivers.values()].map(s=>s.el.getBoundingClientRect()).filter(r=>r.width).map(r=>[r.left-6,r.top-6,r.width+12,r.height+12]);}
// Under the pointer they all stay, and the one pointed at counts as seen; let go, they give a moment more
function holdSlivers(held,over=null){
  if(over)markSeen(over);
  if(held===slivHeld||!slivers.size)return;
  slivHeld=held;
  for(const s of slivers.values()){clearTimeout(s.timer);if(!held&&s.to&&!s.test)s.timer=setTimeout(()=>retract(s),SLIVER.grace);}
}
// Seen, an alert no longer counts toward the dot on the pocket; only ones that came and went unread do
function markSeen(s){
  const ids=s.events.map(e=>e.id).filter(Boolean);if(!ids.length||s.seen)return;
  s.seen=true;invoke('mark_alerts_read',{ids}).catch(()=>{});
}
addEventListener('resize',()=>{for(const s of slivers.values())drawSliver(s);});

// Updates use the same ink, spring and notification space as a finished turn. The words are the action:
// download only after a click, then offer restart only once the updater has verified the download.
function placeUpdateDot(){
  const previous=updateDot.hidden,g=sprout.geo;
  updateDot.hidden=!shown||folded||!updateVisible()||!g;
  if(previous!==updateDot.hidden)reportHot();
  if(updateDot.hidden)return;
  const o=document.getElementById('root').getBoundingClientRect();
  // Releases take the unread notification's corner, including its existing rounded-edge padding.
  Object.assign(updateDot.style,{left:g.P0[0]-o.left+'px',top:g.P0[1]-o.top+'px'});
  updateDot.dataset.status=updateState.status;
  const [word,text]=updateCopy();updateDot.setAttribute('aria-label',`${word}: ${text}. Show update options`);
  updateDot.setAttribute('aria-expanded',String(!!slivers.get(UPDATE_ID)?.to));
}
function updateDotRect(){if(updateDot.hidden)return null;const r=updateDot.getBoundingClientRect();return [r.left,r.top,r.width,r.height];}
function updateDotHit(x,y){const r=updateDotRect();return !!r&&x>=r[0]&&x<=r[0]+r[2]&&y>=r[1]&&y<=r[1]+r[3];}
function hoverUpdate(on){
  updateHovered=on;
  if(on){openUpdate();return;}
  updatePending=false;if(document.activeElement!==updateDot)holdSlivers(false);
}
function openUpdate(){
  if(!updateVisible())return;
  hideCard();
  const s=slivers.get(UPDATE_ID);
  if(s?.to){holdSlivers(true);return;}
  updatePending=true;pumpAlert();
}
updateDot.addEventListener('focus',()=>{if(!updateEscape)openUpdate();});
updateDot.addEventListener('blur',()=>{if(!updateHovered)holdSlivers(false);});
updateDot.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();callq('activate_control',{control:'update'}).catch(()=>{});});
updateDot.addEventListener('click',e=>{if(e.detail===0)openUpdate();});
listen('control_pressed',e=>{if(e.payload==='update')openUpdate();}).catch(()=>{});
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape'||!(slivers.has(UPDATE_ID)||document.activeElement===updateDot))return;
  updatePending=false;updateHovered=false;const s=slivers.get(UPDATE_ID);if(s)retract(s);
  updateEscape=true;updateDot.focus();updateEscape=false;e.preventDefault();
});
function updateCopy(){
  const version=updateState.version?'v'+String(updateState.version).replace(/^v/,''):'';
  const percent=Math.max(0,Math.min(100,Math.floor(Number(updateState.percent)||0)));
  if(updateState.status==='ready')return ['Update ready',['Restart',version].filter(Boolean).join(' · ')];
  if(updateState.status==='downloading')return ['Downloading',`${percent}%${version?' · '+version:''}`];
  if(updateState.status==='installing')return ['Restarting','Installing update'];
  if(updateState.status==='error')return ['Update failed','Check again'];
  return ['Update available',['Download',version].filter(Boolean).join(' · ')];
}
function updateLine(){
  const [word,text]=updateCopy();
  return `<span class="s-word" style="color:var(--update-blue)">${esc(word)}</span><span class="s-text"><span class="s-scroll">${esc(text)}</span></span>`;
}
function renderUpdate(){
  showSliver(UPDATE_ID,[{kind:'update'}],9000);
  const s=slivers.get(UPDATE_ID), [word,text]=updateCopy();
  s.el.classList.add('sliver-update');s.el.id='update-notification';
  updateDot.setAttribute('aria-expanded','true');
  if(updateHovered||s.el.contains(document.activeElement)||document.activeElement===updateDot)holdSlivers(true);
  if(!s.focusBound){s.focusBound=true;s.el.addEventListener('focusin',()=>holdSlivers(true));s.el.addEventListener('focusout',()=>{if(!updateHovered)holdSlivers(false);});}
  s.el.dataset.status=updateState.status;
  s.el.setAttribute('aria-label',`${word}: ${text}`);
  s.el.setAttribute('aria-disabled',String(!updateActionable()));
  s.el.setAttribute('aria-busy',String(['downloading','installing'].includes(updateState.status)));
  s.el.title=updateState.status==='error'?String(updateState.error||'Check for updates again'):`${word}: ${text}`;
}
function pumpUpdate(){
  if(!updatePending)return;
  if(alertWaits()||window.notificationTestAccount){pumpTimer=setTimeout(pumpAlert,200);return;}
  const alerts=[...slivers.values()].filter(s=>s.account!==UPDATE_ID);
  for(const s of alerts)if(s.to){
    if(!s.seen)alertQueue.unshift({events:s.events,hold:s.hold,sound:false});
    retract(s);
  }
  if(alerts.length){pumpTimer=setTimeout(pumpAlert,200);return;}
  updatePending=false;
  if(updateVisible())renderUpdate();
}
function showUpdate(state){
  if(!state||typeof state.status!=='string')return;
  const announced=state.status!==updateState.status&&['available','ready'].includes(state.status);
  updateState=state;placeUnreadDot();reportHot();
  if(announced){updateRimPending=true;if(shown&&!document.getElementById('root').classList.contains('placing'))startPendingUpdateRim();}
  const s=slivers.get(UPDATE_ID);
  if(!updateVisible()){
    updatePending=false;updateRimPending=false;if(s)retract(s);return;
  }
  if(s?.to){renderUpdate();updatePending=false;}
  // A notice stays a quiet dot until the person asks to see its action.
  else if(updateHovered||document.activeElement===updateDot){updatePending=true;pumpAlert();}
}
function startPendingUpdateRim(){
  if(!updateRimPending||typeof notificationRim==='undefined')return;
  updateRimPending=false;notificationRim.start(getComputedStyle(updateDot).getPropertyValue('--update-blue').trim());
}
async function activateUpdate(){
  if(updateAction||!updateActionable())return;
  const command=updateState.status==='ready'?'install_update':updateState.status==='available'?'download_update':'check_for_update';
  updateAction=true;
  try{await invoke(command);}
  catch(error){showUpdate({...updateState,status:'error',error:String(error)});}
  finally{updateAction=false;}
}
listen('update_state',e=>showUpdate(e.payload)).catch(()=>{});
invoke('get_update_state').then(showUpdate).catch(()=>{});

// A short glass chime, made here rather than shipped as a file: two sine partials a step apart,
// rising for someone waiting, falling for a warning, a fifth for a finished turn
let chimeAudio=null;
function chime(kind){
  try{
    chimeAudio=chimeAudio||new AudioContext();
    if(chimeAudio.state==='suspended')chimeAudio.resume();
    const t0=chimeAudio.currentTime+.03, notes=kind==='quota'?[880,659.25]:kind==='waiting'?[659.25,880]:[783.99,1174.66];
    const out=chimeAudio.createGain();out.gain.value=.14;out.connect(chimeAudio.destination);
    notes.forEach((f,i)=>{
      for(const [mult,level] of [[1,1],[2.76,.18]]){ // a faint inharmonic overtone is what makes it read as glass
        const o=chimeAudio.createOscillator(),g=chimeAudio.createGain(),t=t0+i*.12;
        o.type='sine';o.frequency.value=f*mult;
        g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(level,t+.008);g.gain.exponentialRampToValueAtTime(.0005,t+(mult>1?.35:1.1));
        o.connect(g);g.connect(out);o.start(t);o.stop(t+1.2);
      }
    });
  }catch(_){/* no audio device: the alert still shows */}
}

/* ---- The bell: the alert log ----
   Alerts no longer go to Windows' notification centre, so the notch keeps them. The bell is one of what the
   leading pocket holds (scroll over the pin to reach it); a yellow dot on that pocket says something arrived
   since the log was last open. Pressing the bell grows the log out of that end of the notch, the disc melting
   into the widening flare, with the alert switches along the top. A row opens its linked session or account usage. */
let alertLogData=[],alertPrefsData=null,markTimer=0;
// Filtering changes the view, never the saved log or hidden entries' read state.
const visibleAlertLog=()=>alertLogData.filter(e=>alertPrefsData===null||alertPrefsData[e.kind]===true);
const unreadCount=()=>visibleAlertLog().filter(e=>!e.read).length;
const logShowing=()=>card.classList.contains('show')&&hoverId===ALERTS_ID;
listen('alert_log',e=>{
  const before=unreadCount();alertLogData=Array.isArray(e.payload)?e.payload:[];
  paintBell();if(unreadCount()>before&&!slivering())ringBell();
  if(logShowing())renderCard();
}).catch(()=>{});
invoke('get_alert_log').then(v=>{alertLogData=Array.isArray(v)?v:[];paintBell();}).catch(()=>{});
function applyAlertPreferences(value){alertPrefsData=value;paintBell();if(logShowing())renderCard();}
listen('alert_preferences',e=>applyAlertPreferences(e.payload)).catch(()=>{});
invoke('get_alert_preferences').then(applyAlertPreferences).catch(()=>{});
function paintBell(){
  pinHandle.classList.toggle('unread',unreadCount()>0&&leadFaces.includes('alerts'));
  renderLead();placeUnreadDot();
}
// The unread dot rests in the notch's leading front corner, the rounded one away from the screen edge (shape.js
// works out where). Under the pointer it rides the bell drawn out of that corner and settles on its shoulder. During a
// pocket swap it shrinks, then appears only on the revealed bell; the pin never wears it. The open log replaces it.
const SPROUT_BADGE=[.34,-.39]; // the bell's shoulder, in glyph sizes from its centre (where .bell-dot sits on the pocket's bell)
const sproutButton=document.getElementById('alert-sprout');
function placeUnreadDot(){
  placeUpdateDot();
  const dot=document.getElementById('notch-dot');if(!dot)return;
  const unread=unreadCount()>0&&leadFaces.includes('alerts')&&!updateVisible(), swapping=handles[0].swapping;
  // Leaving, it stays on a bell that is still out; a bell melting home after a swap does not pick it up on the way
  const bell=leadFace()==='alerts'&&!logShowing()&&(hovered==='pin'||handles[0].value>.65&&pinHandle.classList.contains('bell-unread'));
  const g=sprout.geo, on=unread&&!bell&&!swapping&&!logShowing()&&!!g;
  dot.classList.toggle('on',on);
  pinHandle.classList.toggle('bell-unread',unread&&bell&&!swapping);
  // Not while an alert is out: the first account's sliver leaves right beside this corner, and a press there is the alert's
  const offered=on&&!slivering();
  if(sprout.available!==offered){sprout.available=offered;sproutButton.tabIndex=offered?0:-1;}
  morphSprout();
  if(!g)return;
  const o=document.getElementById('root').getBoundingClientRect(), s=Math.max(0,g.s), k=g.rho/g.Rb;
  // Out to the drop first, then over to the shoulder as the bell sharpens; stretched along the way while it travels
  const ride=smooth(s/.55), badge=smooth((s-.35)/.5);
  const bx=g.D[0]+SPROUT_BADGE[0]*g.glyph*k*badge, by=g.D[1]+SPROUT_BADGE[1]*g.glyph*k*badge;
  const x=g.P0[0]+(bx-g.P0[0])*ride, y=g.P0[1]+(by-g.P0[1])*ride;
  const speed=Math.abs(sprout.velocity)*Math.hypot(g.P1[0]-g.P0[0],g.P1[1]-g.P0[1]), stretch=matchMedia('(prefers-reduced-motion: reduce)').matches?0:Math.min(.45,speed/900);
  Object.assign(dot.style,{left:x-o.left+'px',top:y-o.top+'px',
    transform:stretch>.01?`rotate(${Math.atan2(g.P1[1]-g.P0[1],g.P1[0]-g.P0[0]).toFixed(3)}rad) scale(${(1+stretch).toFixed(3)},${(1-stretch*.4).toFixed(3)})`:''});
  dot.style.setProperty('--dot-ring',smooth((s-.55)/.35).toFixed(3));
  // The bell's button sits where the bell comes to rest; its glyph rides the drop there
  const box=g.Rb+5, st=sproutButton.style;
  Object.assign(st,{left:g.P1[0]-o.left-box+'px',top:g.P1[1]-o.top-box+'px',width:2*box+'px',height:2*box+'px'});
  st.setProperty('--glyph-x',`${(g.D[0]-g.P1[0]).toFixed(2)}px`);st.setProperty('--glyph-y',`${(g.D[1]-g.P1[1]).toFixed(2)}px`);
  st.setProperty('--sprout-size',g.glyph.toFixed(2)+'px');st.setProperty('--swell',k.toFixed(3));
  st.setProperty('--glyph-blur',(2.4*(1-smooth(s/.9))).toFixed(2));st.setProperty('--sprout-on',(smooth((s-.42)/.4)).toFixed(3));
  const since=sprout.snapAt?(performance.now()-sprout.snapAt)/1000:9;
  st.setProperty('--sway',since<1.2?`${(16*Math.exp(-since/.26)*Math.sin(2*Math.PI*since/.38)).toFixed(2)}deg`:'0deg');
  sproutButton.classList.add('placed');
  const count=unreadCount(),label=count?`Alerts, ${count} new`:'Alerts';if(sproutButton.getAttribute('aria-label')!==label)sproutButton.setAttribute('aria-label',label);
}
// The bell under the dot: hit and reported as hot. At rest only the dot itself; once it is coming out, the way from the
// dot to the bell, so the pointer can follow it out; drawn back in, the drop where it is now.
function sproutHit(x,y){
  const g=sprout.geo;if(!g||!sprout.available)return false;
  const capsule=(a,b,radius)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t)<=radius;};
  if(hovered==='sprout')return capsule(g.P0,g.P1,g.Rb+5);
  if(sprout.value>.1)return capsule(g.P0,g.D,Math.max(10,g.rho+4));
  return Math.hypot(x-g.P0[0],y-g.P0[1])<=10;
}
function sproutRect(){
  const g=sprout.geo;if(!g||!(hovered==='sprout'||sprout.value>.02))return null;
  const b=g.Rb+5,x0=Math.min(g.P0[0]-10,g.P1[0]-b),y0=Math.min(g.P0[1]-10,g.P1[1]-b);
  return [x0,y0,Math.max(g.P0[0]+10,g.P1[0]+b)-x0,Math.max(g.P0[1]+10,g.P1[1]+b)-y0];
}
sproutButton.addEventListener('focus',()=>{sprout.focused=sproutButton.matches(':focus-visible');morphSprout();});
sproutButton.addEventListener('blur',()=>{sprout.focused=false;morphSprout();});
sproutButton.addEventListener('click',e=>{if(e.detail===0)callq('activate_control',{control:'alerts'}).catch(()=>{});});
// A press anywhere on it (the dot, or the bell drawn out of it) opens the log, before the ring underneath can take it
document.addEventListener('pointerdown',e=>{
  if(e.button!==0||hovered!=='sprout')return;
  e.preventDefault();e.stopPropagation();callq('activate_control',{control:'alerts'}).catch(()=>{});
},true);
function ringBell(always=false){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches||(!always&&!unreadCount()))return;
  if(sprout.value>.5)sproutButton.querySelector('.sprout-glyph').animate([{rotate:'0deg'},{rotate:'20deg'},{rotate:'-15deg'},{rotate:'10deg'},{rotate:'-5deg'},{rotate:'2deg'},{rotate:'0deg'}],{duration:1100,easing:'cubic-bezier(.22,1,.36,1)',composite:'add'});
  else if(leadFace()==='alerts'){
    pinHandle.querySelector('.h-glyph.bell')?.animate([{rotate:'0deg'},{rotate:'20deg'},{rotate:'-15deg'},{rotate:'10deg'},{rotate:'-5deg'},{rotate:'2deg'},{rotate:'0deg'}],{duration:1100,easing:'cubic-bezier(.22,1,.36,1)'});
  }
  const dot=pinHandle.classList.contains('bell-unread')?pinHandle.querySelector('.bell-dot'):document.getElementById('notch-dot');
  if(unreadCount()&&(dot?.classList.contains('on')||pinHandle.classList.contains('bell-unread')))dot?.animate([{scale:0},{scale:1.5},{scale:1}],{duration:520,easing:'cubic-bezier(.34,1.56,.64,1)'});
}
// Pressing the bell: the log grows out of the notch where the bell was
// Pressing the bell holds the log open (pressing it again puts it away), so rings crossed on the way do not take it
function openAlertLog(){holdCard(ALERTS_ID);}
// How long a finished turn ran, in the reader's units: minutes, then hours
function tookText(ms){
  const m=Math.max(1,Math.round(ms/60000)),locale=ui().locale;
  return m<60?new Intl.NumberFormat(locale,{style:'unit',unit:'minute',unitDisplay:'short'}).format(m)
    :new Intl.NumberFormat(locale,{style:'unit',unit:'hour',unitDisplay:'short',maximumFractionDigits:1}).format(m/60);
}
// The three kinds of alert are switches along the top; whether they chime is a fourth, in the title row
const LOG_KINDS=[['quota','Usage'],['waiting','Waiting'],['completion','Finished']];
const SOUND_MARK=on=>`<svg class="a-sound-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.6 6.1h2.1L8 3.3v9.4L4.7 9.9H2.6z"/>${on
  ?'<path d="M10.5 5.7a3.3 3.3 0 0 1 0 4.6"/><path d="M12.4 3.9a5.9 5.9 0 0 1 0 8.2"/>':'<path d="M10.9 6.4l3 3.2M13.9 6.4l-3 3.2"/>'}</svg>`;
function logWhen(at){
  const m=Math.round((Date.now()-at)/60000);
  if(m<1)return textCopy('now');
  if(m<60*24)return ui().ago(m);
  const days=daysApart(at,Date.now());
  if(days===1)return new Intl.RelativeTimeFormat(ui().locale,{numeric:'auto'}).format(-1,'day');
  return new Date(at).toLocaleDateString(ui().locale,{weekday:'short'});
}
const logReduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
// A damped spring as a CSS easing, for motion that is not driven frame by frame here: its own settle time is the duration
function springEasing(period,zeta){
  const w=2*Math.PI/period,wd=w*Math.sqrt(1-zeta*zeta),T=4.6/(zeta*w),points=[];
  for(let i=0;i<=40;i++){const t=T*i/40;points.push(i===40?1:+(1-Math.exp(-zeta*w*t)*(Math.cos(wd*t)+zeta*w/wd*Math.sin(wd*t))).toFixed(4));}
  return {easing:`linear(${points.join(',')})`,duration:Math.round(T*1000)};
}
const POUR=springEasing(.62,.62), SETTLE=springEasing(.5,.74);
function renderAlertLog(){
  const old=card.dataset.account===ALERTS_ID?card.querySelector('.a-log'):null;
  const focused=card.contains(document.activeElement)?document.activeElement.dataset.pref:null;
  const scroll=old?.scrollTop||0, before=old?new Map([...old.querySelectorAll('.a-row')].map(r=>[r.dataset.key,r.offsetTop])):null;
  const kick=ui().kick||UI.en.kick, rows=visibleAlertLog().slice().reverse(), on=key=>!!alertPrefsData?.[key];
  const chips=LOG_KINDS.map(([key,label])=>`<button class="a-chip${on(key)?' on':''}" type="button" data-pref="${key}" aria-pressed="${on(key)}">${esc(textCopy(label))}</button>`).join('');
  const sound=`<span class="a-ink a-sound-ink"><svg class="a-ink-svg" aria-hidden="true"></svg><button class="a-sound${on('sound')?' on':''}" type="button" data-pref="sound" aria-pressed="${on('sound')}" aria-label="${esc(textCopy('Sound'))}">${SOUND_MARK(on('sound'))}</button></span>`;
  let html=`<div class="c-head"><span class="log-mark">${BELL_MARK}</span><span class="c-title">${esc(textCopy('Alerts'))}</span>${sound}${alertLogData.length?`<button class="a-clear" type="button">${esc(textCopy('Clear'))}</button>`:''}</div>
    <div class="a-chips a-ink"><svg class="a-ink-svg" aria-hidden="true"></svg>${chips}</div>`;
  if(!rows.length)html+=`<div class="a-empty">${esc(textCopy(alertLogData.length?'No alerts match these filters':'No alerts this week'))}</div>`;
  else html+=`<div class="a-log"><div class="a-bead" aria-hidden="true"></div>${rows.map((e,i)=>logRow(e,i,kick)).join('')}</div>`;
  // The rows pour out only as the log opens, not each time it refreshes while open
  const entering=detailOpen<.9||card.dataset.account!==ALERTS_ID;
  card.innerHTML=`<div class="usage-content log-content${entering?' entering':''}">${html}</div>`;
  if(focused)card.querySelector(`[data-pref="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
  const list=card.querySelector('.a-log');if(list){list.scrollTop=scroll;fadeLog(list);}
  drawInk();placeBead();
  if(list&&!logReduced()){
    if(entering)pourRows(list);else if(before)flowRows(list,before);
  }
  // Read once it has been open long enough to have been seen
  if(unreadCount()&&!markTimer)markTimer=setTimeout(()=>{
    markTimer=0;const ids=visibleAlertLog().filter(e=>!e.read).map(e=>e.id);
    if(logShowing()&&ids.length)invoke('mark_alerts_read',{ids}).catch(()=>{});
  },1400);
}
// A row reads as the sliver it came out as: the word in the colour of what it reports, then where it came from
function logRow(e,i,kick){
  const acct=providers().find(x=>x.id===e.account)||agentAccounts.find?.(x=>x.id===e.account);
  const quota=e.kind==='quota', waiting=e.kind==='waiting';
  const word=quota?(e.level===100?kick.limit:kick.warning):waiting?kick.waiting:kick.finished;
  const colour=quota?tone(Math.min(1,Math.max(e.used??0,(e.level||80)/100))):waiting?WATCH:INK;
  const w=quota&&acct?acct.snap.windows.find(x=>x.id===e.window):null;
  const detail=quota?`${w?textCopy(w.label):''}${e.used!=null?`${w?' · ':''}${pctText(e.used)}%`:''}`
    :`${e.session||''}${e.kind==='completion'&&e.took!=null?`${e.session?' · ':''}${tookText(e.took)}`:''}`;
  const name=acct?acct.name:e.session||'Agent Usage';
  return `<button class="a-row${e.read?'':' fresh'}" type="button" data-key="${esc(e.id||'row-'+i)}" data-alert="${esc(e.id||'')}" data-account="${esc(e.account||'')}">
    <span class="a-glyph">${acct?glyphHtml(acct,true):''}</span><span class="a-word" style="color:${colour}">${esc(word)}</span><span class="a-when">${esc(logWhen(e.at))}</span>
    <span class="a-sub"><span class="a-name">${esc(name)}</span>${detail&&detail!==name?`<span class="a-detail">${esc(detail)}</span>`:''}</span></button>`;
}
// Opening: the list pours out of the title row, the rows further down travelling further, on a spring that runs a
// little past and settles, so it arrives as one body rather than a row at a time. It waits for the words to have black
// under them (the card shows from 85% open), or it would be spent before it can be seen.
function pourRows(list){
  const rows=[...list.querySelectorAll('.a-row')].slice(0,9),held=rows.map(row=>row.animate([{opacity:0},{opacity:0}],{duration:1e6}));
  const t0=performance.now();
  const go=()=>{
    if(!list.isConnected){held.forEach(a=>a.cancel());return;}
    if(detailOpen<.82&&performance.now()-t0<700){requestAnimationFrame(go);return;}
    rows.forEach((row,i)=>{
      // Lower rows come out from under the ones above them, so they clear before they are seen
      const dy=-(row.offsetTop+row.offsetHeight*.5)*.48;
      row.animate([{translate:`0 ${dy.toFixed(1)}px`},{translate:'0 0'}],{duration:POUR.duration,easing:POUR.easing});
      row.animate([{opacity:0},{opacity:1}],{duration:220,delay:i*22,easing:'ease-out',fill:'backwards'});held[i].cancel();
    });
  };
  requestAnimationFrame(go);
}
// An alert arriving while the log is open: the rows below make way on a spring and the new one wells up in its place
function flowRows(list,before){
  for(const row of list.querySelectorAll('.a-row')){
    const was=before.get(row.dataset.key);
    if(was==null){
      row.animate([{opacity:0,scale:'.94 .62'},{opacity:1,scale:'1 1'}],{duration:SETTLE.duration,easing:SETTLE.easing});
      continue;
    }
    const dy=was-row.offsetTop;
    if(Math.abs(dy)>1)row.animate([{translate:`0 ${dy}px`},{translate:'0 0'}],{duration:SETTLE.duration,easing:SETTLE.easing});
  }
}
// Clear: everything is drawn up into the title row, accelerating as the notch takes it in, then the log is emptied
function drainRows(done){
  const list=card.querySelector('.a-log'),rows=list?[...list.querySelectorAll('.a-row')]:[];
  if(!rows.length||logReduced()){done();return;}
  setBead(null);
  for(const row of rows){
    const dy=-(row.offsetTop-list.scrollTop+row.offsetHeight*.5);
    row.animate([{translate:'0 0',opacity:1},{translate:`0 ${dy.toFixed(1)}px`,opacity:0}],{duration:300,easing:'cubic-bezier(.55,0,.8,.3)',fill:'forwards'});
  }
  setTimeout(done,260);
}

/* The switches are drops of white ink. A switch that is on is full of it, and switches that are on side by side run
   together through a neck, the way the notch's black meets the screen edge, so what is on reads as one body. Turned
   off, a drop draws in to its middle and the neck to its neighbour stretches, pinches and parts; turned on, it wells
   up from the middle and reaches out to a neighbour that is on. Liquid while it moves, sharp at rest. The words are
   drawn in difference over the ink (notch.html), so they invert exactly where the ink has reached. */
const inkState={},neckState={},TAIL=.42,NECK={R:.34,Rmax:.95,least:.2,stretch:1.15};let inkFrame=0,inkLast=0,inkSerial=0;
function inkFor(button){
  const key=button.dataset.pref,to=button.classList.contains('on')?1:0;
  const s=inkState[key]||(inkState[key]={f:to,v:0,to});
  if(s.to!==to){s.to=to;if(logReduced()){s.f=to;s.v=0;}else if(!inkFrame)inkFrame=requestAnimationFrame(stepInk);}
  return s;
}
function stepInk(now){
  const dt=Math.max(0,Math.min(.032,(now-(inkLast||now-16))/1000));inkLast=now;let moving=false;
  for(const s of Object.values(inkState)){
    // In on a loose spring that swells a little past the well; out without a bounce, slowly enough to see the neck
    // stretch, pinch and give
    const omega=2*Math.PI/(s.to?.5:.94),zeta=s.to?.5:.9;
    s.v+=(-omega*omega*(s.f-s.to)-2*zeta*omega*s.v)*dt;s.f+=s.v*dt;
    if(Math.abs(s.f-s.to)<.002&&Math.abs(s.v)<.02){s.f=s.to;s.v=0;}else moving=true;
  }
  if(drawInk(now))moving=true; // a parted neck's tails are still whipping home
  if(moving)inkFrame=requestAnimationFrame(stepInk);else{inkFrame=0;inkLast=0;}
}
const pillPath=(cx,cy,w,h)=>{const r=h/2,x0=cx-w/2+r,x1=cx+w/2-r;
  return `M${n(x0)} ${n(cy-r)}H${n(x1)}A${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(cy+r)}H${n(x0)}A${n(r)} ${n(r)} 0 0 1 ${n(x0)} ${n(cy-r)}Z`;};
// The neck between two drops' facing ends is a liquid bridge: two arcs of radius R, each touching both end circles, as
// a drop pulled between two others narrows to one waist. Drawn apart, the arcs close in; the neck parts while the waist
// still has body (least), never as a thread, and each half then springs home as a droplet on a bridge of its own (drawInk).
function bridge(c1,r1,c2,r2,R,least=0){
  const dx=c2[0]-c1[0],dy=c2[1]-c1[1],d=Math.hypot(dx,dy),a=r1+R,b=r2+R;
  if(d<.01||r1<.3||r2<.3||d>=a+b)return null;
  const ux=dx/d,uy=dy/d,along=(a*a-b*b+d*d)/(2*d),up=Math.sqrt(Math.max(0,a*a-along*along)),waist=2*(up-R);
  if(waist<least)return null;
  // Each arc runs on the side of its circle that faces the axis, from toward one drop to toward the other
  const arc=side=>{
    const P=[c1[0]+ux*along-uy*up*side,c1[1]+uy*along+ux*up*side];
    const t1=Math.atan2(c1[1]-P[1],c1[0]-P[0]);let span=Math.atan2(c2[1]-P[1],c2[0]-P[0])-t1;
    span-=2*Math.PI*Math.round(span/(2*Math.PI));
    return Array.from({length:13},(_,k)=>[P[0]+R*Math.cos(t1+span*k/12),P[1]+R*Math.sin(t1+span*k/12)]);
  };
  const points=[...arc(-1),...arc(1).reverse()];
  return {d:'M'+points.map(p=>`${n(p[0])} ${n(p[1])}`).join('L')+'Z',waist,at:along};
}
const circlePath=(c,r)=>pillPath(c[0],c[1],2*r,2*r);
// The neck's waist follows how far it has been drawn out past rest: full at rest, thinning smoothly over NECK.stretch,
// and the arcs' radius is found to give that waist (a wider radius is a fatter neck), so it never runs to a thread
function neckBetween(c1,r1,c2,r2,rest,h){
  const d=Math.hypot(c2[0]-c1[0],c2[1]-c1[1]),stretch=Math.max(0,d-rest)/(NECK.stretch*h);
  if(stretch>=1)return null;
  // The waist it had at rest, between two full drops, thinned by the stretch: it only ever narrows as they part
  const want=(bridge([0,0],h/2,[rest,0],h/2,NECK.R*h)?.waist??h*.4)*Math.pow(1-stretch,.6);
  if(want<NECK.least*h)return null;
  // Bounded, so a long neck still pinches in the middle rather than straightening into a tube; where the bound cannot
  // keep the waist it wants, it parts
  let lo=.5,hi=NECK.Rmax*h;
  if((bridge(c1,r1,c2,r2,hi)?.waist??-1)<NECK.least*h)return null;
  for(let i=0;i<22;i++){const mid=(lo+hi)/2,w=bridge(c1,r1,c2,r2,mid)?.waist??-1;if(w<want)lo=mid;else hi=mid;}
  return bridge(c1,r1,c2,r2,hi);
}
function drawInk(now=performance.now()){
  let tails=false;
  for(const box of card.querySelectorAll('.a-ink')){
    const svg=box.querySelector('.a-ink-svg');if(!svg)continue;
    if(!svg.firstChild){
      const id='a-ink-goo-'+(++inkSerial);
      // Necks are a path of their own inside the drops' goo, wound the same way as the drops so they only ever add to
      // them: the junctions melt together while it moves, and a neck parts before it is thin enough for the goo to eat
      svg.innerHTML=`<defs>${gooDefinition(id)}</defs><path class="a-well"/><g class="a-drops"><path class="a-drop"/><path class="a-drop a-neck"/></g>`;
    }
    const W=box.clientWidth,H=box.clientHeight;
    svg.setAttribute('width',W);svg.setAttribute('height',H);svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
    let wells='',ink='',necks='',blur=0;
    const drops=[...box.querySelectorAll('[data-pref]')].map(b=>{
      const s=inkFor(b),x=b.offsetLeft,y=b.offsetTop,w=b.offsetWidth,h=b.offsetHeight,cx=x+w/2,cy=y+h/2,f=Math.max(0,s.f);
      b.style.setProperty('--ink',Math.min(1,f).toFixed(3));
      wells+=pillPath(cx,cy,w,h);
      if(s.f!==s.to)blur=Math.max(blur,1.8*Math.sin(Math.PI*Math.min(1,f)));
      if(f<.05)return {key:b.dataset.pref,x,w,h,none:true};
      // A drop wells up round, then spreads along its switch; past 1 the spring swells it a little beyond the well
      const grow=Math.min(1,f),over=Math.max(0,f-1);
      const dh=h*(.3+.7*smooth(grow/.5))+over*5,dw=dh+(w-h)*smooth((grow-.22)/.78)+over*9;
      ink+=pillPath(cx,cy,dw,dh);
      return {key:b.dataset.pref,x,w,h,cx,cy,dw,dh};
    });
    for(let i=0;i+1<drops.length;i++){
      const a=drops[i],b=drops[i+1],st=neckState[a.key+'|'+b.key]||(neckState[a.key+'|'+b.key]={joined:false,at:0});
      const capA=a.none?null:[a.cx+a.dw/2-a.dh/2,a.cy],capB=b.none?null:[b.cx-b.dw/2+b.dh/2,b.cy];
      const R=a.h*NECK.R,neck=capA&&capB?neckBetween(capA,a.dh/2,capB,b.dh/2,(b.x+b.h/2)-(a.x+a.w-a.h/2),a.h):null;
      necks+=neck?neck.d:'';
      // Where it broke, measured from each end, so each half can be drawn home from there as the drops keep moving
      if(neck)st.last={waist:neck.waist,a:neck.at,b:Math.hypot(capB[0]-capA[0],capB[1]-capA[1])-neck.at};
      if(st.joined&&!neck&&!logReduced())st.at=now;
      st.joined=!!neck;
      // Parted: each half is a droplet at the break, joined to its own drop by a bridge, that springs home a little past
      // (so its drop's end swells as it is taken in) while it shrinks; gooed with the drops, so it stays one body with them
      const since=(now-st.at)/1000;
      if(!st.at||since>=TAIL){st.at=0;continue;}
      const u=since/TAIL,home=1-Math.exp(-3.4*u)*Math.cos(5.6*u),{waist=6,a:fromA=12,b:fromB=12}=st.last||{};
      tails=true;blur=Math.max(blur,2.6*Math.pow(1-u,.5));
      for(const [drop,cap,dir,from] of [[a,capA,1,fromA],[b,capB,-1,fromB]]){
        if(!cap)continue;const r=drop.dh/2,leaving=inkState[drop.key]?.to===0;
        // A finger of ink from inside the drop out to where it broke, rounding up as surface tension takes it and staying
        // round until it is nearly home; the half on a drop that is draining is shorter, so that drop stays round
        // It sinks in at full roundness (shrinking it would leave a cone at the drop's end) and is gone once inside
        const round=smooth(u/.2),drip=Math.max(.3,leaving?r*.58:Math.min(r*.62,Math.max(waist/2,r*.34)+r*.22*round));
        const base=cap[0]+dir*r*.4,tip=cap[0]+dir*Math.max(r*.4,r-drip+(from*(leaving?.3:1)-r+drip)*(1-Math.min(1.08,home)));
        ink+=pillPath((base+tip)/2,cap[1],Math.abs(tip-base)+2*drip,2*drip);
      }
    }
    svg.querySelector('.a-well').setAttribute('d',wells);
    const group=svg.querySelector('.a-drops'),filter=svg.querySelector('filter');
    svg.querySelector('.a-drop').setAttribute('d',ink);svg.querySelector('.a-neck').setAttribute('d',necks);
    if(blur>.3){
      setGooBlur(filter,blur);
      for(const [key,value] of Object.entries({x:-20,y:-20,width:W+40,height:H+40}))filter.setAttribute(key,value);
      group.setAttribute('filter',`url(#${filter.id})`);
    }else group.removeAttribute('filter');
  }
  if(tails&&!inkFrame)inkFrame=requestAnimationFrame(stepInk);
  return tails;
}

/* One bead of ink lies under the row the pointer is on. Moving to another row it runs there like a drop on glass:
   its leading edge goes first and its trailing edge catches up, so it stretches on the way, thinning a little, and
   gathers on arrival. Coming onto the list it swells out of the row's middle; leaving, it draws back into it. */
const bead={key:null,top:0,bottom:0,vt:0,vb:0,frame:0,last:0,width:1};
let beadPointer=null;
function setBead(row){
  const key=row?row.dataset.key:null;
  if(key===bead.key)return;
  const fresh=key&&(bead.bottom-bead.top<1);
  bead.key=key;
  if(fresh){const mid=row.offsetTop+row.offsetHeight/2;bead.top=bead.bottom=mid;bead.vt=bead.vb=0;}
  if(logReduced()){const r=beadRow();if(r){bead.top=r.offsetTop;bead.bottom=r.offsetTop+r.offsetHeight;}else bead.top=bead.bottom=(bead.top+bead.bottom)/2;placeBead();return;}
  if(!bead.frame)bead.frame=requestAnimationFrame(stepBead);
}
const beadRow=()=>bead.key==null?null:card.querySelector(`.a-row[data-key="${CSS.escape(bead.key)}"]`);
function stepBead(now){
  const dt=Math.min(.032,(now-(bead.last||now-16))/1000);bead.last=now;
  const row=beadRow(),mid=(bead.top+bead.bottom)/2;
  const top=row?row.offsetTop:mid,bottom=row?row.offsetTop+row.offsetHeight:mid;
  const down=top>bead.top+.5,up=top<bead.top-.5;
  const spring=(x,v,to,period,zeta)=>{const w=2*Math.PI/period;v+=(-w*w*(x-to)-2*zeta*w*v)*dt;return [x+v*dt,v];};
  // The edge in the direction of travel leads; the other follows on a softer spring
  [bead.top,bead.vt]=spring(bead.top,bead.vt,top,row?(up?.24:.4):.3,row?(up?.8:.9):1);
  [bead.bottom,bead.vb]=spring(bead.bottom,bead.vb,bottom,row?(down?.24:.4):.3,row?(down?.8:.9):1);
  if(bead.bottom<bead.top){const m=(bead.top+bead.bottom)/2;bead.top=bead.bottom=m;}
  const settled=Math.abs(bead.top-top)<.3&&Math.abs(bead.bottom-bottom)<.3&&Math.abs(bead.vt)<.05&&Math.abs(bead.vb)<.05;
  if(settled){bead.top=top;bead.bottom=bottom;bead.vt=bead.vb=0;}
  placeBead();
  bead.frame=settled?0:requestAnimationFrame(stepBead);if(settled)bead.last=0;
}
function placeBead(){
  const el=card.querySelector('.a-bead');if(!el)return;
  const row=beadRow()||card.querySelector('.a-row'),full=row?row.offsetHeight:48,h=Math.max(0,bead.bottom-bead.top);
  // Round while small, a little narrower while stretched: it keeps roughly the volume of a drop
  const inset=h<full?(1-h/full)*38:Math.min(10,(h/full-1)*14);
  Object.assign(el.style,{top:n(bead.top)+'px',height:n(h)+'px',left:n(inset)+'%',width:n(100-2*inset)+'%',
    borderRadius:n(Math.min(12,h/2))+'px',opacity:h<1?0:1});
}
function trackBead(x,y){
  if(!logShowing()){setBead(null);return;}
  const row=document.elementFromPoint(x,y)?.closest?.('#card .a-row');
  setBead(row||(document.activeElement?.closest?.('#card .a-row'))||null);
}
document.addEventListener('mousemove',e=>{beadPointer=[e.clientX,e.clientY];if(logShowing()||bead.key)trackBead(e.clientX,e.clientY);});
document.addEventListener('mouseout',e=>{if(!e.relatedTarget){beadPointer=null;setBead(null);}});
// The history runs on into the black past its ends rather than stopping at a cut line, by as much as there is to scroll
function fadeLog(list){
  const below=list.scrollHeight-list.clientHeight-list.scrollTop;
  list.style.setProperty('--fade-top',n(Math.min(18,Math.max(0,list.scrollTop)))+'px');
  list.style.setProperty('--fade-bottom',n(Math.min(26,Math.max(0,below)))+'px');
}
// Scrolling the history moves the rows under a still pointer
document.addEventListener('scroll',e=>{
  if(!e.target?.classList?.contains('a-log'))return;
  fadeLog(e.target);if(beadPointer)trackBead(...beadPointer);
},true);
card.addEventListener('focusin',e=>{const row=e.target.closest('.a-row');if(row)setBead(row);});
card.addEventListener('focusout',e=>{if(!e.relatedTarget?.closest?.('.a-row')&&!beadPointer)setBead(null);});

card.addEventListener('click',e=>{
  if(!logShowing())return;
  const toggle=e.target.closest('[data-pref]');
  if(toggle){
    const key=toggle.dataset.pref,on=!toggle.classList.contains('on');
    toggle.classList.toggle('on',on);toggle.setAttribute('aria-pressed',String(on));
    if(key==='sound')toggle.innerHTML=SOUND_MARK(on);
    drawInk();
    invoke('set_alert_preferences',{[key]:on}).then(applyAlertPreferences).catch(()=>{});return;
  }
  // If the log cannot be cleared, the drained rows come back rather than staying invisible
  if(e.target.closest('.a-clear')){drainRows(()=>invoke('clear_alert_log').catch(()=>{if(logShowing())renderCard();}));return;}
  const row=e.target.closest('.a-row');
  if(row)openNotifiedAlert(alertLogData.find(a=>a.id===row.dataset.alert),row.dataset.account);
});

async function openNotifiedAlert(entry,account){
  clearSessionLinkError();
  if(entry?.id&&['waiting','completion'].includes(entry.kind)){
    try{if(await invoke('open_alert_session',{id:entry.id})){hideCard();return;}}catch(error){if(!logShowing())holdCard(account);showSessionLinkError(error.message||'VS Code could not be opened.');return;}
    if(!logShowing())holdCard(account);
    showSessionLinkError('This older alert has no session link and could not be matched uniquely.');return;
  }
  if(providers().some(p=>p.id===account)){if(logShowing()){hoverId=account;renderCard();}else holdCard(account);}
}

let sessionLinkError=null;
function clearSessionLinkError(){sessionLinkError=null;card.querySelector('.session-link-error')?.remove();}
function restoreSessionLinkError(){
  if(sessionLinkError?.account===card.dataset.account)showSessionLinkError(sessionLinkError.message);
}
function showSessionLinkError(message){
  message=message.replace(/^Error invoking remote method 'command': Error: /,'');
  sessionLinkError={account:card.dataset.account,message};
  let note=card.querySelector('.session-link-error');
  if(!note){note=document.createElement('div');note.className='session-link-error';note.setAttribute('role','status');card.append(note);}
  note.textContent=message;placeCard();
}
