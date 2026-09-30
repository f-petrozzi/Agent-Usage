'use strict';
/* Alerts open out of the notch rather than as Windows toasts. The account's ring stays whole while the others
   recede, and the notch grows the alert out beside it with the same ink and spring as the usage card. It holds
   while it is read, and for as long as the pointer rests on it, then draws back in. A ring under the pointer,
   or a click, turns it into that account's usage. */
const alertQueue=[];
let alertShowing=null,alertHeld=false,alertTimer=0,pumpTimer=0;
listen('alert',e=>{
  const p=e.payload;if(!p||!Array.isArray(p.events)||!p.events.length)return;
  // Already reading the log: the alert is there at the top of it, so it does not open a second time
  if(logShowing()){if(p.sound)chime(p.events[0].kind);ringBell();return;}
  alertQueue.push(p);pumpAlert();
}).catch(()=>{});
// Not over something the person is doing: while the notch is arriving, carried, tracking or showing usage
function alertWaits(){
  return !shown||performance.now()-shownAt<420||window.agentTracking||carrying||dragging||card.classList.contains('show');
}
function pumpAlert(){
  clearTimeout(pumpTimer);
  if(alertShowing||!alertQueue.length)return;
  if(alertWaits()){pumpTimer=setTimeout(pumpAlert,200);return;}
  const p=alertQueue.shift();
  const known=p.events.find(e=>e.account&&providers().some(x=>x.id===e.account));
  if(known)hoverId=known.account;
  alertShowing=p;alertHeld=false;
  clearTimeout(hideTimer);clearTimeout(showTimer);pendingAccount=null;
  card.classList.remove('closing');card.classList.add('show','alerting');
  renderAlert(p);setDetailsShown(true);armWatchdog();
  if(p.sound)chime(p.events[0].kind);
  alertTimer=setTimeout(()=>endAlert(true),p.hold||6500);
}
// Under the pointer it stays; let go, it gives the reader a moment more and then leaves
function holdAlert(held){
  if(!alertShowing||held===alertHeld)return;
  alertHeld=held;clearTimeout(alertTimer);
  if(!held)alertTimer=setTimeout(()=>endAlert(true),1600);
}
function clearAlert(){
  if(!alertShowing)return;
  alertShowing=null;alertHeld=false;clearTimeout(alertTimer);card.classList.remove('alerting');reportHot(); // main stops holding the notch out for it
  ringBell(); // read, it tucks into the bell
  clearTimeout(pumpTimer);pumpTimer=setTimeout(pumpAlert,700); // the next one waits for this one to draw in
}
function endAlert(close){ if(!alertShowing)return; if(close)hideCard(); else clearAlert(); }
card.addEventListener('click',()=>{if(alertShowing){endAlert(false);renderCard();}});

function renderAlert(p){
  const evs=p.events, single=evs.length===1;
  let html=evs.slice(0,3).map(e=>alertBlock(e,single)).join('');
  if(evs.length>3)html+=moreRow(evs.length-3);
  card.innerHTML=`<div class="usage-content alert-content${single?'':' stacked'}">${html}</div>`;
  card.dataset.account=hoverId;
  placeCard();
}
// Each alert says whose it is, what happened in one word, and the reading or session it is about.
// The word takes the colour of what it reports: the usage level, or the waiting yellow.
function alertBlock(e,full){
  const acct=providers().find(x=>x.id===e.account), kick=(ui().kick||UI.en.kick);
  const head=(word,colour)=>`<div class="c-head">${acct?glyphHtml(acct,true):''}<span class="c-title">${esc(acct?acct.name:e.session||'Agent Usage')}</span><span class="a-kick" style="color:${colour}">${esc(word)}</span></div>`;
  if(e.kind==='quota'){
    const w=acct?.snap.windows.find(x=>x.id===e.window);
    // never calmer than the level it crossed, even if the reading has since been corrected down
    const word=e.level===100?kick.limit:kick.warning, colour=tone(Math.min(1,Math.max(w?w.used:1,(e.level||80)/100)));
    if(!full)return `<div class="a-block">${head(word,colour)}${w?`<div class="a-sub">${esc(textCopy(w.label))} · ${esc(usedParts(w)[0])}%</div>`:''}</div>`;
    return `<div class="a-block">${head(word,colour)}${w?renderUsageWindows([w],false,false):`<div class="c-note">${esc(e.body)}</div>`}</div>`;
  }
  const waiting=e.kind==='waiting';
  const detail=waiting&&e.body&&e.body!=='Waiting for input.'?`<div class="a-sub">${esc(textCopy(e.body))}</div>`:'';
  return `<div class="a-block">${head(waiting?kick.waiting:kick.finished,waiting?WATCH:INK)}${e.session?`<div class="a-line"><span class="s-dot" style="background:${waiting?WATCH:INK}"></span>${esc(e.session)}</div>`:''}${full?detail:''}</div>`;
}

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
const logShowing=()=>card.classList.contains('show')&&hoverId===ALERTS_ID&&!alertShowing;
listen('alert_log',e=>{
  const before=unreadCount();alertLogData=Array.isArray(e.payload)?e.payload:[];
  paintBell();if(unreadCount()>before&&!alertShowing)ringBell();
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
  if(unreadCount())pinHandle.querySelector('.lead-dot')?.animate([{scale:0},{scale:1.5},{scale:1}],{duration:520,easing:'cubic-bezier(.34,1.56,.64,1)'});
}
// Pressing the bell: the log grows out of the notch where the bell was
function openAlertLog(){
  hoverId=ALERTS_ID;clearTimeout(hideTimer);clearTimeout(showTimer);pendingAccount=null;
  if(card.classList.contains('show'))renderCard();else showCard();
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
  const detail=quota?`${w?textCopy(w.label):''}${e.used!=null?`${w?' · ':''}${pctText(e.used)}%`:''}`:(e.session||'');
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
