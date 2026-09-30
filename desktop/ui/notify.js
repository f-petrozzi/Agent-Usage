'use strict';
/* Alerts grow out of the ring they are about, as a sliver of the notch: a thin tab the height of the ring, joined
   to the notch by flares of its own, only as long as its one line needs. It springs out a little past its length
   and settles, liquid while it moves, and its words arrive once there is black under them. Pointing at it holds
   it and counts it as seen; a click opens that account's usage. Alerts for several accounts come out of their own
   rings together; a second for the same account takes over its sliver. An open card comes first: alerts wait. */
const SLIVER={thick:40,flat:38,flare:12,pad:14,max:300,grace:1600};
const alertQueue=[], slivers=new Map();
let pumpTimer=0, slivHeld=false, sliverSerial=0;
const sliverSvg=document.createElementNS(SVG_NS,'svg');sliverSvg.id='sliver-shape';sliverSvg.setAttribute('aria-hidden','true');
pill.before(sliverSvg);
const slivering=()=>slivers.size>0;
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
  if(alertWaits()){pumpTimer=setTimeout(pumpAlert,200);return;}
  while(alertQueue.length){
    const p=alertQueue.shift(), byAccount=new Map();
    for(const e of p.events){const key=providers().some(x=>x.id===e.account)?e.account:'';(byAccount.get(key)||byAccount.set(key,[]).get(key)).push(e);}
    for(const [account,events] of byAccount)showSliver(account,events,p.hold||6500);
    if(p.sound)chime(p.events[0].kind);
  }
  reportHot();
}
// The one line an alert gets: a word in the colour of what it reports, then the reading or the session
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
  return `<span class="s-word" style="color:${colour}">${esc(word)}</span>${text?`<span class="s-text">${esc(text)}</span>`:''}${more}`;
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
    el.addEventListener('click',()=>{markSeen(s);const id=s.account;retractSlivers();if(id)holdCard(id);});
  }
  s.events=[...events,...s.events].slice(0,6);s.to=1;
  s.el.innerHTML=sliverLine(s.events);
  // Only as long as the line: measured laid out on one line, then the sliver is cut to it
  s.el.style.width='auto';const natural=s.el.scrollWidth;
  s.length=Math.min(SLIVER.max,natural+2*SLIVER.pad);
  clearTimeout(s.timer);s.hold=hold;if(!slivHeld)s.timer=setTimeout(()=>retract(s),hold);
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
// Drawn in edge space like the notch itself: u along the edge, v in from it. A side edge sends it across the
// screen beside its ring, a flat edge hangs it below (or above) its ring, spreading to its length as it drops.
function drawSliver(s){
  const origin=document.getElementById('root').getBoundingClientRect(), W=innerWidth, H=innerHeight;
  const matrix=edgeMatrix(notchEdge,W,H), local=(x,y)=>[matrix[0]*(x-matrix[4])+matrix[1]*(y-matrix[5]),matrix[2]*(x-matrix[4])+matrix[3]*(y-matrix[5])];
  const screen=(u,v)=>[matrix[0]*u+matrix[2]*v+matrix[4],matrix[1]*u+matrix[3]*v+matrix[5]];
  const anchor=(s.account&&pill.querySelector(`.cell[data-p="${CSS.escape(s.account)}"] .ringwrap`))||pill;
  const r=anchor.getBoundingClientRect(), [uc]=local(r.left+r.width/2-origin.left,r.top+r.height/2-origin.top);
  const depth=edgeDepth(notchEdge)-2, t=Math.max(0,s.t), grown=Math.min(1,t), vertical=edgeIsVertical();
  let u0,u1,d;
  if(vertical){
    const thick=SLIVER.thick*(.62+.38*smooth(grown));
    u0=uc-thick/2;u1=uc+thick/2;d=s.length*t;
  }else{
    const span=SLIVER.flat+(s.length-SLIVER.flat)*smooth((grown-.18)/.82), limit=notchEdge==='top'||notchEdge==='bottom'?W:H;
    u0=Math.max(10,uc-span/2);u1=Math.min(limit-10,u0+span);u0=u1-span;d=SLIVER.flat*Math.min(1.25,t);
  }
  if(d<.5){s.path.removeAttribute('d');s.el.style.opacity=0;return;}
  const rad=Math.min((u1-u0)/2,d), flare=Math.min(SLIVER.flare,d*.5);
  s.path.setAttribute('d',partPath(u0,u1,d,rad,flare,rad,flare));
  s.path.setAttribute('transform',`matrix(${matrix.join(' ')}) translate(0 ${n(depth)})`);
  // Liquid while it moves, sharp at rest
  const goo=matchMedia('(prefers-reduced-motion: reduce)').matches?0:4.4*Math.sin(Math.PI*grown)*(s.t===s.to?0:1);
  if(goo>.25){
    s.filter.querySelector('feGaussianBlur').setAttribute('stdDeviation',n(goo));
    for(const [key,value] of Object.entries({x:u0-40,y:-SHAPE.bleed-40,width:u1-u0+80,height:d+SHAPE.bleed+80}))s.filter.setAttribute(key,n(value));
    s.path.setAttribute('filter',`url(#${s.filter.id})`);
  }else s.path.removeAttribute('filter');
  // Its words sit on the black once there is black to hold them
  const a=screen(u0,depth+(vertical?SLIVER.pad*.4:0)),b=screen(u1,depth+d-(vertical?SLIVER.pad*.4:0));
  const x=Math.min(a[0],b[0]),y=Math.min(a[1],b[1]);
  Object.assign(s.el.style,{left:x+'px',top:y+'px',width:Math.abs(a[0]-b[0])+'px',height:Math.abs(a[1]-b[1])+'px',opacity:smooth((t-.74)/.26).toFixed(3)});
}
function dropSliver(s){cancelAnimationFrame(s.frame);clearTimeout(s.timer);s.el.remove();s.path.remove();s.filter.parentElement.remove();slivers.delete(s.account);reportHot();if(!slivers.size)ringBell();}
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
  for(const s of slivers.values()){clearTimeout(s.timer);if(!held&&s.to)s.timer=setTimeout(()=>retract(s),SLIVER.grace);}
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
   into the widening flare, with the alert switches along the top. A row turns into that account's usage. */
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
  renderLead();
}
// Something new: the bell swings from its top if it is out, otherwise the pocket's dot pops. `always` swings it
// even with nothing unread, as it buds out of the flare
function ringBell(always=false){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches||(!always&&!unreadCount()))return;
  if(leadFace()==='alerts'){
    pinHandle.querySelector('.h-glyph.bell')?.animate([{rotate:'0deg'},{rotate:'20deg'},{rotate:'-15deg'},{rotate:'10deg'},{rotate:'-5deg'},{rotate:'2deg'},{rotate:'0deg'}],{duration:1100,easing:'cubic-bezier(.22,1,.36,1)'});
  }
  if(unreadCount()&&!pinHandle.classList.contains('swapping'))pinHandle.querySelector('.lead-dot')?.animate([{scale:0},{scale:1.5},{scale:1}],{duration:520,easing:'cubic-bezier(.34,1.56,.64,1)'});
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
  const kick=ui().kick||UI.en.kick, rows=[...alertLogData].reverse().slice(0,30);
  const chips=CHIPS.map(([key,label])=>`<button class="a-chip${alertPrefsData?.[key]?' on':''}" type="button" data-pref="${key}" aria-pressed="${!!alertPrefsData?.[key]}">${esc(textCopy(label))}</button>`).join('');
  let html=`<div class="c-head"><span class="log-mark">${BELL_MARK}</span><span class="c-title">${esc(textCopy('Alerts'))}</span>${rows.length?`<button class="a-clear" type="button">${esc(textCopy('Clear'))}</button>`:''}</div>
    <div class="a-chips">${chips}</div>`;
  if(!rows.length)html+=`<div class="a-empty">${esc(textCopy('No alerts this week'))}</div>`;
  else html+=`<div class="a-log">${rows.map((e,i)=>logRow(e,i,kick)).join('')}</div>`;
  // The rows come in one after another only as the log opens, not each time it refreshes while open
  const entering=detailOpen<.9||card.dataset.account!==ALERTS_ID;
  card.innerHTML=`<div class="usage-content log-content${entering?' entering':''}">${html}</div>`;
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
  return `<button class="a-row${e.read?'':' fresh'}" type="button" data-account="${esc(e.account||'')}" style="--i:${i}">
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
  if(row&&providers().some(p=>p.id===row.dataset.account)){hoverId=row.dataset.account;renderCard();}
});
