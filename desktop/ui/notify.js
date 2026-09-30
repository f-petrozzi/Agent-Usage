'use strict';
/* Alerts grow out of the account they are about, as a sliver of the notch: a rounded rectangle spanning its share of the notch,
   sized to its text. It springs out a little past its length
   and settles, liquid while it moves, and its words arrive once there is black under them. Pointing at it holds
   it and counts it as seen; a click opens its linked session or account usage. Alerts for several accounts come out of their own
   rings together on side edges; flat-edge lifts take turns to keep text readable. An open card comes first: alerts wait. */
const SLIVER={flat:54,flatMin:128,flatMax:160,pad:14,max:228,grace:1600};
const alertQueue=[], slivers=new Map();
let pumpTimer=0, slivHeld=false, sliverSerial=0;
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
listen('appear',()=>queueNotificationTest()).catch(()=>{});
listen('layout',()=>queueNotificationTest()).catch(()=>{});
listen('alert',e=>{
  const p=e.payload;if(!p||!Array.isArray(p.events)||!p.events.length)return;
  // Already reading the log: the alert is there at the top of it, so it does not open a second time
  if(logShowing()){if(p.sound)chime(p.events[0].kind);ringBell();return;}
  alertQueue.push(p);pumpAlert();
}).catch(()=>{});
// Not over something the person is doing: while the notch is arriving, carried, tracking or showing a card
function alertWaits(){
  return !shown||performance.now()-shownAt<420||window.agentTracking||carrying||dragging||card.classList.contains('show');
}
function pumpAlert(){
  clearTimeout(pumpTimer);
  if(!alertQueue.length)return;
  if(alertWaits()||(!edgeIsVertical()&&slivering())){pumpTimer=setTimeout(pumpAlert,200);return;}
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
  if(!s){
    const el=document.createElement('div');el.className='sliver';el.dataset.account=account;
    const path=document.createElementNS(SVG_NS,'path');path.setAttribute('class','sliver-ink');
    const id='sliver-goo-'+(++sliverSerial);sliverSvg.insertAdjacentHTML('beforeend',`<defs>${gooDefinition(id)}</defs>`);
    const filter=sliverSvg.querySelector('#'+id);sliverSvg.append(path);
    card.parentElement.append(el);
    s={account,el,path,filter,events:[],t:0,v:0,to:1,frame:0,timer:0,length:0};slivers.set(account,s);
    el.setAttribute('role','button');el.tabIndex=0;
    const activate=()=>{markSeen(s);retractSlivers();openNotifiedAlert(s.events.find(e=>e.target)||s.events[0],s.account);};
    el.addEventListener('click',activate);
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();activate();}});
  }
  s.test=events.every(e=>e.test===true);
  s.events=[...events,...s.events.filter(e=>!e.test)].slice(0,6);s.to=1;s.seen=false;
  s.scroll?.cancel();s.scroll=null;s.scrollDistance=null;
  s.el.innerHTML=sliverLine(s.events);
  // Only as long as the line: measured laid out on one line, then the sliver is cut to it
  s.el.style.height='auto';s.el.style.width='max-content';
  const natural=s.el.scrollWidth;
  s.length=Math.min(SLIVER.max,natural+2*SLIVER.pad);
  clearTimeout(s.timer);s.hold=hold;if(!slivHeld&&!s.test)s.timer=setTimeout(()=>retract(s),hold);
  springSliver(s);
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
  const index=cells.findIndex(a=>a.el===cell);
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
  if(d<.5){s.path.removeAttribute('d');s.el.style.opacity=0;return;}
  const inkDepth=d+depth-rootDepth;
  s.path.setAttribute('d',notificationRectPath(u0,u1,inkDepth));
  s.path.setAttribute('transform',`matrix(${matrix.join(' ')}) translate(0 ${n(rootDepth)})`);
  // Liquid while it moves, sharp at rest
  const goo=matchMedia('(prefers-reduced-motion: reduce)').matches?0:4.4*Math.sin(Math.PI*grown)*(s.t===s.to?0:1);
  if(goo>.25){
    s.filter.querySelector('feGaussianBlur').setAttribute('stdDeviation',n(goo));
    const ink0=u0, ink1=u1;
    for(const [key,value] of Object.entries({x:ink0-40,y:-SHAPE.bleed-40,width:ink1-ink0+80,height:inkDepth+SHAPE.bleed+80}))s.filter.setAttribute(key,n(value));
    s.path.setAttribute('filter',`url(#${s.filter.id})`);
  }else s.path.removeAttribute('filter');
  // Its words sit on the black once there is black to hold them
  const a=screen(u0,depth+SLIVER.pad*.4),b=screen(u1,depth+d-SLIVER.pad*.4);
  const x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]);
  Object.assign(s.el.style,{left:x+'px',top:y+'px',width:Math.abs(a[0]-b[0])+'px',height:Math.abs(a[1]-b[1])+'px',opacity:smooth((t-.74)/.26).toFixed(3)});
  if(s.to&&s.t===s.to)scrollSliver(s);
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
function dropSliver(s){cancelAnimationFrame(s.frame);s.scroll?.cancel();clearTimeout(s.timer);s.el.remove();s.path.remove();s.filter.parentElement.remove();slivers.delete(s.account);reportHot();if(!slivers.size)ringBell();if(window.notificationTestAccount)notificationTestTimer=setTimeout(queueNotificationTest,200);}
function retract(s){clearTimeout(s.timer);s.to=0;springSliver(s);}
// Everything back in at once: a card opening over them, or the notch going away (then without the motion)
function retractSlivers(now=false){for(const s of [...slivers.values()]){if(now){dropSliver(s);continue;}retract(s);}}
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
const unreadCount=()=>alertLogData.filter(e=>!e.read).length;
const logShowing=()=>card.classList.contains('show')&&hoverId===ALERTS_ID;
listen('alert_log',e=>{
  const before=unreadCount();alertLogData=Array.isArray(e.payload)?e.payload:[];
  paintBell();if(unreadCount()>before&&!slivering())ringBell();
  if(logShowing())renderCard();
}).catch(()=>{});
invoke('get_alert_log').then(v=>{alertLogData=Array.isArray(v)?v:[];paintBell();}).catch(()=>{});
listen('alert_preferences',e=>{alertPrefsData=e.payload;if(logShowing())renderCard();}).catch(()=>{});
invoke('get_alert_preferences').then(v=>{alertPrefsData=v;}).catch(()=>{});
function paintBell(){
  pinHandle.classList.toggle('unread',unreadCount()>0&&leadFaces.includes('alerts'));
  renderLead();placeUnreadDot();
}
// The unread dot occupies existing space inside the bezel corner. It shrinks there during a pocket swap,
// then appears only on the revealed bell. The pin never wears a notification badge.
function placeUnreadDot(){
  const dot=document.getElementById('notch-dot');if(!dot)return;
  const r=pill.getBoundingClientRect(),o=document.getElementById('root').getBoundingClientRect();
  const x=notchEdge==='right'?r.right-10:r.left+10, y=notchEdge==='bottom'?r.bottom-10:r.top+10;
  Object.assign(dot.style,{left:x-o.left+'px',top:y-o.top+'px'});
  const unread=unreadCount()>0&&leadFaces.includes('alerts'), swapping=handles[0].swapping;
  const bell=leadFace()==='alerts'&&(hovered==='pin'||handles[0].value>.65)&&!logShowing();
  dot.classList.toggle('on',unread&&!bell&&!swapping);
  pinHandle.classList.toggle('bell-unread',unread&&bell&&!swapping);
}
function ringBell(always=false){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches||(!always&&!unreadCount()))return;
  if(leadFace()==='alerts'){
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
const CHIPS=[['quota','Usage'],['waiting','Waiting'],['completion','Finished'],['sound','Sound']];
function logWhen(at){
  const m=Math.round((Date.now()-at)/60000);
  if(m<1)return textCopy('now');
  if(m<60*24)return ui().ago(m);
  const days=daysApart(at,Date.now());
  if(days===1)return new Intl.RelativeTimeFormat(ui().locale,{numeric:'auto'}).format(-1,'day');
  return new Date(at).toLocaleDateString(ui().locale,{weekday:'short'});
}
function renderAlertLog(){
  const scroll=card.dataset.account===ALERTS_ID?(card.querySelector('.a-log')?.scrollTop||0):0;
  const kick=ui().kick||UI.en.kick, rows=[...alertLogData].reverse();
  const chips=CHIPS.map(([key,label])=>`<button class="a-chip${alertPrefsData?.[key]?' on':''}" type="button" data-pref="${key}" aria-pressed="${!!alertPrefsData?.[key]}">${esc(textCopy(label))}</button>`).join('');
  let html=`<div class="c-head"><span class="log-mark">${BELL_MARK}</span><span class="c-title">${esc(textCopy('Alerts'))}</span>${rows.length?`<button class="a-clear" type="button">${esc(textCopy('Clear'))}</button>`:''}</div>
    <div class="a-chips">${chips}</div>`;
  if(!rows.length)html+=`<div class="a-empty">${esc(textCopy('No alerts this week'))}</div>`;
  else html+=`<div class="a-log">${rows.map((e,i)=>logRow(e,i,kick)).join('')}</div>`;
  // The rows come in one after another only as the log opens, not each time it refreshes while open
  const entering=detailOpen<.9||card.dataset.account!==ALERTS_ID;
  card.innerHTML=`<div class="usage-content log-content${entering?' entering':''}">${html}</div>`;
  const list=card.querySelector('.a-log');if(list)list.scrollTop=scroll;
  // Read once it has been open long enough to have been seen
  if(unreadCount()&&!markTimer)markTimer=setTimeout(()=>{markTimer=0;if(logShowing())invoke('mark_alerts_read').catch(()=>{});},1400);
}
function logRow(e,i,kick){
  const acct=providers().find(x=>x.id===e.account)||agentAccounts.find?.(x=>x.id===e.account);
  const quota=e.kind==='quota', waiting=e.kind==='waiting';
  const word=quota?(e.level===100?kick.limit:kick.warning):waiting?kick.waiting:kick.finished;
  const colour=quota?tone(Math.min(1,Math.max(e.used??0,(e.level||80)/100))):waiting?WATCH:INK;
  const w=quota&&acct?acct.snap.windows.find(x=>x.id===e.window):null;
  const detail=quota?`${w?textCopy(w.label):''}${e.used!=null?`${w?' · ':''}${pctText(e.used)}%`:''}`
    :`${e.session||''}${e.kind==='completion'&&e.took!=null?`${e.session?' · ':''}${tookText(e.took)}`:''}`;
  return `<button class="a-row${e.read?'':' fresh'}" type="button" data-alert="${esc(e.id||'')}" data-account="${esc(e.account||'')}" style="--i:${i}">
    <span class="a-glyph">${acct?glyphHtml(acct,true):''}</span><span class="a-name">${esc(acct?acct.name:e.session||'Agent Usage')}</span>
    <span class="a-word" style="color:${colour}">${esc(word)}</span><span class="a-when">${esc(logWhen(e.at))}</span>
    ${detail?`<span class="a-detail">${esc(detail)}</span>`:''}</button>`;
}
card.addEventListener('click',e=>{
  if(!logShowing())return;
  const chip=e.target.closest('.a-chip');
  if(chip){const key=chip.dataset.pref;chip.classList.toggle('on');invoke('set_alert_preferences',{[key]:!alertPrefsData?.[key]}).then(v=>{alertPrefsData=v;}).catch(()=>{});return;}
  if(e.target.closest('.a-clear')){invoke('clear_alert_log').catch(()=>{});return;}
  const row=e.target.closest('.a-row');
  if(row)openNotifiedAlert(alertLogData.find(a=>a.id===row.dataset.alert),row.dataset.account);
});

async function openNotifiedAlert(entry,account){
  clearSessionLinkError();
  if(entry?.id&&['waiting','completion'].includes(entry.kind)&&providers().find(p=>p.id===account)?.base!=='gemini'){
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
