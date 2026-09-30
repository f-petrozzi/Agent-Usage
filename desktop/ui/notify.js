'use strict';
/* Alerts open out of the notch rather than as Windows toasts. The account's ring stays whole while the others
   recede, and the notch grows the alert out beside it with the same ink and spring as the usage card. It holds
   while it is read, and for as long as the pointer rests on it, then draws back in. A ring under the pointer,
   or a click, turns it into that account's usage. */
const alertQueue=[];
let alertShowing=null,alertHeld=false,alertTimer=0,pumpTimer=0;
listen('alert',e=>{
  const p=e.payload;if(!p||!Array.isArray(p.events)||!p.events.length)return;
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
