
const invoke = window.__TAURI__.core.invoke;
const listen = window.__TAURI__.event.listen;

/* Colour ramp (upstream palette values) */
let AMPLE='#00FF88', WATCH='#F2FF00', CRIT='#FF3F00';
// The status arc is neutral on purpose: the ring behind it is coloured by how much of the limit
// is gone, and a green arc inside it reads as part of that scale. Waiting borrows the warning yellow.
let TRACK='#303030', INK='#ffffff', DIM='#808080', HOLE='#2a2a2a';
// The arcs and the card's dots are drawn into SVG and inline styles, where `var()` does not reach,
// so the palette is read back out of the page instead of written down twice.
function readPalette(){
  const s=getComputedStyle(document.documentElement);
  const v=(name,fallback)=>s.getPropertyValue(name).trim()||fallback;
  TRACK=v('--track',TRACK); INK=v('--ink',INK); DIM=v('--ink-dim',DIM); HOLE=v('--hole',HOLE);
  AMPLE=v('--ample',AMPLE); WATCH=v('--watch',WATCH); CRIT=v('--crit',CRIT);
}
readPalette();
/* The palette switches on this attribute, and what is drawn into SVG is redrawn by hand, since
   var() does not reach it. `dark` is the default the CSS already holds, so a failed ask changes
   nothing rather than leaving the page half-painted. */
function applyTheme(name){
  document.documentElement.dataset.theme = name === 'light' ? 'light' : 'dark';
  readPalette();
  renderRing();
  if(card&&card.classList.contains('show')) renderCard();
}
invoke('get_theme_resolved').then(applyTheme).catch(()=>{});
listen('theme_resolved',e=>applyTheme(e.payload)).catch(()=>{});
let colorTransition='hard_step';
const stepTone=f=> f>=0.7?CRIT : f>=0.5?WATCH : AMPLE;
// A continuous sRGB ramp across the whole range: the Windows watch cut has always been 50%, so
// this is a named equivalence rather than a magic number. Windows has no watch-limit slider.
const WATCH_AT=0.5;
function hex3(c){ const n=parseInt(c.slice(1),16); return [(n>>16)&255,(n>>8)&255,n&255]; }
function lerpHex(a,b,t){
  const A=hex3(a), B=hex3(b);
  const ch=i=>Math.round(A[i]+(B[i]-A[i])*t);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}
const rampTone=f=>{
  f=Math.max(0,Math.min(1,f));
  if(f<WATCH_AT) return lerpHex(AMPLE,WATCH,f/WATCH_AT);
  return lerpHex(WATCH,CRIT,(f-WATCH_AT)/(1-WATCH_AT));
};
const tone=f=> colorTransition==='ramp'?rampTone(f):stepTone(f);
// Whole percents, except where rounding would read as nothing used or nothing left, as the Mac's Percent does
function smallPct(v){
  if(v<=0) return '0';
  const t=Math.round(v*10)/10;
  if(t<0.1) return '<0.1';
  if(t>99.9) return '>99.9';
  return t.toFixed(1);
}
function pctText(f){ const v=f*100; return v>0&&v<1?smallPct(v):String(Math.round(v)); }
// Both ends, since vendors disagree on which they print; the left half comes from the rounded used half, as their dashboards do
function usedParts(w){
  const v=w.used*100;
  let used, left;
  if((v>0&&v<1)||(v>99&&v<100)){ used=smallPct(v); left=100-v>99.9?'>99.9':smallPct(Math.max(0,100-v)); }
  else { const u=Math.round(v); used=String(u); left=String(Math.max(0,100-u)); }
  if(w.derived) used='~'+used;
  return [used,left];
}

let usage={status:'',windows:[],fetched_at:0,note:''};
let codexSnap={status:'absent',windows:[],fetched_at:0,note:''};
let cursorSnap={status:'absent',windows:[],fetched_at:0,note:''};
// Grok Build credits, from the Grok CLI's own session; absent until that CLI is signed in
let grokSnap={status:'absent',windows:[],fetched_at:0,note:''};
let glmSnap={status:'absent',windows:[],fetched_at:0,note:''};
// OpenCode Go plan, read with OpenCode's own sign-in; absent until OpenCode is installed
let opencodeSnap={status:'absent',windows:[],fetched_at:0,note:''};
let agSnap={status:'absent',windows:[],fetched_at:0,note:''};
let glyphs={}; // id → {kind:'mark'|'appicon', url}
let activity=[]; // live sessions from the collector's feed: {provider,account,state:'busy'|'waiting',name,detail,since}
/* Which screen edge the notch is pinned to. The Electron main process owns it (it is what placed the window); the page is
   told so it can mirror or rotate itself to match. 'right' is the default and the pre-edge layout. */
let notchEdge='right';
// Show on hover. the logic is beside the move handle below; declared here, since reportHot reads `folded` from the first frame
let folded=false, pointerIn=false, menuOpen=false, foldTimer=null;
/* Insets in CSS pixels: top, right, bottom, left. The pill
   stays against the screen edge; the card is kept out of these. */
let insets=[0,0,0,0];
function applyInsets(v){
  const next=Array.isArray(v)&&v.length===4?v.map(n=>Math.max(0,Number(n)||0)):[0,0,0,0];
  if(next.every((n,i)=>n===insets[i])) return;
  insets=next;
  if(card&&card.classList.contains('show')){ placeCard(); reportHot(); }
}
// Pushed on every placement, and asked for once in case the placement happened before this page was listening
listen('notch_insets',e=>applyInsets(e.payload)).catch(()=>{});
invoke('get_notch_insets').then(applyInsets).catch(()=>{});
function edgeIsVertical(){ return notchEdge==='left'||notchEdge==='right'; }
function applyEdge(e){
  const next=(e==='left'||e==='top'||e==='bottom')?e:'right';
  if(next===notchEdge) return;
  notchEdge=next;
  document.body.dataset.edge=next;
  // The window changes shape with the edge, and so does the width the zoom correction measures against
  reportDpr();
  // The pill changes shape, so both the hot rectangles and the card's anchor have to be measured again
  if(card&&card.classList.contains('show')) renderCard();
  reportHot();
}
function setUiLanguage(lang){
  const next=TEXT[lang]?lang:'en';
  if(uiLang===next) return;
  uiLang=next;
  renderRing();
  if(card&&card.classList.contains('show')) renderCard();
}
// "Is it working?" per account, from the collector's session feed. Returns running | attention | idle
function workState(p){
  const acts=activity.filter(a=>a.account===p.id);
  if(acts.some(a=>a.state==='waiting')) return 'attention';
  if(acts.some(a=>a.state==='busy')) return 'running';
  return 'idle';
}
function glyphHtml(p,small){
  const g=glyphs[p.base||p.id];
  if(g&&g.kind==='svg'&&g.svg) return `<span class="mark">${g.svg}</span>`;
  if(g&&g.url) return `<img class="${g.kind}" src="${g.url}" alt="${p.name}"${small?' style="width:16px;height:16px;border-radius:4px"':''}>`;
  return small?'':p.glyph; // fallback letter
}
// Provider table (order = top to bottom in the pill). `glyph` is the fallback letter used when no mark is available
// Which providers get a ring: [{provider}]. null or an empty list means every provider.
let notchSlots=null;
function slotFor(id){
  if(!Array.isArray(notchSlots)) return null;
  for(const s of notchSlots){ if(s&&s.provider===id) return s; }
  return null;
}
// One cell per Claude account. Each account's windows arrive carrying its heading in `group` and,
// past the default account, an `@slug` id; the cell gets that account's windows under the ids they
// would have had on their own, so headlineOf and weeklyOf need no rule about accounts. `base` is the
// provider the cell belongs to (glyph, activity, slot choice); `id` is what makes the cell unique.
function claudeCells(){
  const ws=Array.isArray(usage.windows)?usage.windows:[];
  const accounts=[];
  for(const w of ws){
    const g=w.group||'';
    if(!accounts.some(a=>a.g===g)) accounts.push({g:g,slug:(String(w.id).split('@')[1]||'')});
  }
  // One account (or a reading with no headings yet) is the single cell it has always been
  if(accounts.length<2) return [{id:'claude',base:'claude',name:'Claude',glyph:'C',snap:usage}];
  return accounts.map(a=>({
    id:a.slug?'claude@'+a.slug:'claude',
    base:'claude',
    name:a.g||'Claude',
    glyph:'C',
    snap:Object.assign({},usage,{windows:ws.filter(w=>(w.group||'')===a.g)
      .map(w=>Object.assign({},w,{id:String(w.id).split('@')[0]}))})
  }));
}
let appearanceSettings={aliases:false,compactSessions:false};
function applyAppearance(value){
  appearanceSettings={aliases:value?.aliases===true,compactSessions:value?.compactSessions===true};
  document.getElementById('root').classList.toggle('account-labels',appearanceSettings.aliases);
  renderRing();if(typeof updateSessionList==='function')updateSessionList();
}
invoke('get_appearance').then(applyAppearance).catch(()=>{});
listen('appearance',e=>applyAppearance(e.payload)).catch(()=>{});
let agentAccounts=[];
let accountOffset=0;
function availableProviders(){
  const list=agentAccounts.length?agentAccounts:[{id:'collector',base:'claude',name:'Agent Usage',glyph:'…',snap:usage}];
  const picked=list.filter(p=>!!slotFor(p.id));
  return picked.length?list.filter(p=>picked.includes(p)||p.id===window.notificationTestAccount):list;
}
function providers(){
  const all=availableProviders();
  const capacity=Math.max(1,Math.floor((edgeIsVertical()?innerHeight-150:innerWidth-150)/90));
  accountOffset=Math.min(accountOffset,Math.max(0,all.length-capacity));
  return all.slice(accountOffset,accountOffset+capacity);
}
// Antigravity's "Notch reads" and "Model data", as in the Mac app; chosen in settings
let agPrefs={limit:'automatic',model:'gemini'};
// Where the weekly limit's own ring goes, from settings: 'off', 'inside' or 'outside'
let weeklyRing='off';
// The tightest metered window, ties going to the lower id so the choice never flickers
function tightestOf(ws){
  return ws.filter(w=>w.count==null).reduce((a,b)=>!a||b.used>a.used||(b.used===a.used&&b.id<a.id)?b:a,null);
}
function laneFamily(w){ const id=w.id.toLowerCase(); return id.startsWith('gemini')?'gemini':(id.startsWith('3p')||id.startsWith('claude'))?'3p':''; }
function laneIs(w,limit){
  const t=(w.id+' '+w.label).toLowerCase();
  return limit==='weekly'?t.includes('weekly'):['5h','5-hour','five hour','five-hour','hourly','session'].some(k=>t.includes(k));
}
// The window a provider's ring shows: the same provider window rules used by the tray
// BEGIN TESTABLE HEADLINE SELECTOR
function headlineOf(snap,id){
  const ws=snap.windows; if(!ws.length) return null;
  const byId=x=>ws.find(w=>w.id===x)||null;
  if(id==='claude') return byId('session')||ws[0];
  if(id==='codex') return byId('primary')||ws[0];
  if(id==='cursor') return byId('included')||byId('api');
  if(id==='grok') return byId('credits')||ws[0];
  if(id==='glm') return byId('session');
  if(id==='opencode') return byId('rolling');
  const fam=ws.filter(w=>laneFamily(w)===agPrefs.model), lanes=fam.length?fam:ws;
  if(agPrefs.limit!=='automatic'){ const w=tightestOf(lanes.filter(w=>laneIs(w,agPrefs.limit))); if(w) return w; }
  return tightestOf(lanes.filter(w=>w.used<1))||tightestOf(lanes)||lanes[0];
}
// END TESTABLE HEADLINE SELECTOR
// The weekly window each provider reports, or null where there is none: Claude names it seven_day,
// Codex calls its second window secondary, and Antigravity has one per model family. Cursor has none.
// BEGIN TESTABLE WEEKLY SELECTOR
function weeklyOf(snap,id){
  const ws=snap.windows.filter(w=>w.count==null); if(!ws.length) return null;
  const byId=x=>ws.find(w=>w.id===x)||null;
  if(id==='claude') return byId('seven_day')||byId('weekly_all')||byId('weekly');
  if(id==='codex') return byId('secondary');
  if(id==='cursor') return null;
  if(id==='grok') return null; // the credits window is already the weekly one
  if(id==='glm') return byId('weekly');
  if(id==='opencode') return byId('weekly');
  const fam=ws.filter(w=>laneFamily(w)===agPrefs.model), lanes=fam.length?fam:ws;
  return tightestOf(lanes.filter(w=>laneIs(w,'weekly')));
}
// END TESTABLE WEEKLY SELECTOR
// 15 minutes, the Mac's `UsageStore.staleAfter`. At 5 a reading went grey between two polls of a
// provider that is answering perfectly well, which made "stale" mean "recently fetched" rather than
// "old enough not to trust". A provider that knows its own reading is stale still says so in status.
function staleOf(snap){ if(snap.status==='stale') return true; return snap.fetched_at>0 && (Date.now()-snap.fetched_at)>15*60*1000; }
let stateSnap={sessions:[],agg:'idle'};

function svgArc(r,frac,color,width,extra=''){
  // Nothing at all at zero: a zero-length dash still paints a dot once the caps are round, where the
  // Mac's `trim(from: 0, to: 0)` draws nothing. A reading small enough that its two caps meet does
  // draw as a dot, on both platforms. `ProviderRing.sweep` has no floor. Upstream #260 argues that
  // is wrong, for the local model's arc; if it lands, the same floor belongs here.
  if(!(frac>0)) return '';
  const C=2*Math.PI*r;
  return `<circle cx="28" cy="28" r="${r}" fill="none" stroke="${color}" stroke-width="${width}"
    stroke-dasharray="${(C*frac).toFixed(2)} ${C.toFixed(2)}" stroke-linecap="round"
    transform="rotate(-90 28 28)" ${extra}/>`;
}

// Pin occupies the near flare's pocket; refreshing a ring or Settings refreshes usage.
let notchButtons={pin:true,alerts:true}, pinnedNow=false, leadFaces=['pin','alerts'], leadIndex=0;
// The alert log's place in the card (notify.js); its button is one of what the leading pocket holds
const ALERTS_ID='__alerts';
const BELL_MARK='<svg class="bell-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 16.6V11a5.6 5.6 0 0 1 11.2 0v5.6l1.7 1.9H4.7z"/><path d="M10 21h4"/></svg>';
function renderRing(){
  const ps=providers();
  // Rebuild the DOM only when the structure changes (never swap the element under the cursor)
  const want=ps.map(p=>p.id+':'+(glyphs[p.base]?glyphs[p.base].kind:'-')).join(',')+`|${notchButtons.pin}`;
  if(pill.dataset.cells!==want){
    pill.innerHTML=ps.map((p,i)=>`<div class="cell" role="button" tabindex="0" aria-label="${esc(p.name)}" data-p="${p.id}" style="--i:${i}">
      <div class="ringwrap"><svg class="ring" viewBox="0 0 56 56"></svg><svg class="reading" viewBox="0 0 56 56"></svg><div class="activity-layer"><svg class="activity" viewBox="0 0 56 56"></svg></div><div class="glyph ${(!glyphs[p.base]&&p.glyph.length>1)?'small':''}">${glyphHtml(p)}</div></div>
      <div class="pct">…</div><span class="account-alias" aria-hidden="true"></span></div>`).join('');
    pill.dataset.cells=want;
  }
  pill.style.setProperty('--length',`${ps.length*68+Math.max(0,ps.length-1)*14+36}px`);
  document.getElementById('pin-handle').classList.toggle('on',pinnedNow);renderLead();
  for(const p of ps){
    const cell=pill.querySelector(`.cell[data-p="${p.id}"]`); if(!cell) continue;
    const svg=cell.querySelector('svg.ring'), reading=cell.querySelector('svg.reading'), activity=cell.querySelector('svg.activity'), pct=cell.querySelector('.pct'), glyph=cell.querySelector('.glyph'), wrap=cell.querySelector('.ringwrap');
    const h=headlineOf(p.snap,p.base);
    cell.querySelector('.account-alias').textContent=p.alias||p.name.replace(/^(?:Codex|Claude|Antigravity|AGY)(?:\s*[·:—-]\s*|\s+)/i,'')||p.name;
    cell.title=p.name+(h?` · ${h.label} used`:'' );
    cell.setAttribute('aria-label',p.name+(h?`, ${h.label}: ${pctText(h.used)}% used`:''));
    let inner=`<circle cx="28" cy="28" r="22" fill="${HOLE}"/><circle cx="28" cy="28" r="25" fill="none" stroke="${TRACK}" stroke-width="5"/>`;
    wrap.classList.toggle('pressed',!!refreshing[p.id]);
    const used=h&&h.count==null?Math.min(h.used,1):null, prev=reading.dataset.used?Number(reading.dataset.used):null;
    const readingMarkup=used==null?'':svgArc(25,used,tone(used),5);
    if(reading.dataset.markup!==readingMarkup){reading.innerHTML=readingMarkup;reading.dataset.markup=readingMarkup;}
    reading.dataset.used=used==null?'':String(used);
    // A new reading while the notch is open: the arc eases from the old value, so what changed is visible
    const arc=reading.querySelector('circle');
    if(arc&&shown&&prev!=null&&Math.abs(used-prev)>=0.005&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const C=2*Math.PI*25, dash=f=>`${(C*f).toFixed(2)} ${C.toFixed(2)}`;
      arc.animate([{strokeDasharray:dash(prev),stroke:tone(prev)},{strokeDasharray:dash(used),stroke:tone(used)}],{duration:700,easing:'cubic-bezier(.32,.72,.24,1)'});
    }
    if(weeklyRing!=='off'){ // the week, thinner and at its own radius, in its own colour: a session at 12% beside a week at 91% is the case this exists for
      const wk=weeklyOf(p.snap,p.base);
      // Inside, it shares the gap with the working indicator, so it stands down while that is showing
      const taken=weeklyRing==='inside'&&workState(p)!=='idle';
      if(wk&&(!h||wk.id!==h.id)&&!taken){
        const r=weeklyRing==='inside'?16:31;
        inner+=`<circle cx="28" cy="28" r="${r}" fill="none" stroke="${TRACK}" stroke-width="2.4" opacity="0.7"/>`
          +svgArc(r,Math.min(wk.used,1),tone(wk.used),2.4,'opacity="0.85"');
      }
    }
    if(svg.dataset.markup!==inner){svg.innerHTML=inner;svg.dataset.markup=inner;}
    { // thin inner arc: spinning white = working, yellow pulse = waiting on you (one animation for all four, different sources)
      // Its own layer, so a stale reading can dim around it without dimming it: see `.ringwrap.stale`
      const ws=workState(p);
      const layer=activity.parentElement;
      // Keep a running arc's DOM and animation phase through quota/heartbeat updates.
      if(layer.dataset.state!==ws){
        layer.dataset.state=ws;layer.classList.toggle('running',ws==='running');
        if(ws==='running') activity.innerHTML=svgArc(19,0.28,INK,2.5);
        else if(ws==='attention') activity.innerHTML=`<g class="arc-pulse"><circle cx="28" cy="28" r="19" fill="none" stroke="${WATCH}" stroke-width="2.5"/></g>`;
        else activity.innerHTML='';
      }
    }
    if(p.snap.status==='needsAuth'||p.snap.status==='none') pct.textContent='N/A';
    else if(h && h.count!=null) pct.textContent='~'+h.count;
    else if(h) pct.textContent=(h.derived?'~':'')+pctText(h.used)+'%';
    else pct.textContent=p.snap.windows.length?'N/A':'…'; // its declared window is missing: a dash, not a wait
    glyph.classList.toggle('dim', !!(h && h.used>=1));
    wrap.classList.toggle('stale', staleOf(p.snap));
  }
  reportHot(); // a provider appearing or leaving resizes the pill
  if(typeof applyFocusLayout==='function')applyFocusLayout();
}

function resetCopy(ms){
  if(!ms) return '';
  const diff=ms-Date.now();
  if(diff<=0) return ui().resetting;
  const min=Math.round(diff/60000); // rounded before the test, so 59m40s never reads "Resets in 60 min"
  if(min<60) return ui().resetsIn(Math.max(1,min));
  const d=new Date(ms), locale=ui().locale;
  // A weekday only names a day in the coming week: a Codex monthly reset 26 days out read as this Monday
  if(daysApart(Date.now(),ms)>=7) return ui().resetsDate(d.toLocaleDateString(locale,{month:'short',day:'numeric'}));
  const t=d.toLocaleTimeString(locale,{hour:'numeric',minute:'2-digit',hourCycle:stateSnap.clock_24h?'h23':'h12'});
  if(diff<24*60*60*1000) return ui().resetsAt(t);
  return ui().resetsOn(d.toLocaleDateString(locale,{weekday:'short'}),t);
}
// Calendar days rather than 24-hour blocks, so a clock change cannot move the answer
function daysApart(from,to){
  const day=ms=>{const d=new Date(ms); return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();};
  return Math.round((day(to)-day(from))/86400000);
}

function ago(ms){
  const m=Math.round((Date.now()-ms)/60000);
  return ui().ago(m);
}

// The card is clipped, not scrolled, so rows past this would push its title off the top; the rest are counted, as on the Mac
const SESSION_ROWS=5;
function moreRow(n){ return n>0?`<div class="s-more">${ui().andMore(n)}</div>`:''; }

let hoverId='claude';
let claudeAuth={busy:false,message:''};
let claudeActionMessage='';
// Authentication stays on the collector machine.
function renderUsageWindows(windows,boxed=true,headings=true){
  let html='',group=null;
  for(const w of windows){
    if((w.group||null)!==group){
      if(group&&boxed) html+=`</div>`;
      group=w.group||null;
      if(group&&headings)html+=`<div class="g-head">${esc(textCopy(group))}</div>`;
      if(group&&boxed)html+=`<div class="g-box">`;
    }
    if(w.count!=null){
      html+=`<div class="win"><div class="w-row"><span class="w-label">${esc(textCopy(w.label))}</span></div>
        <div class="w-used">${w.count>0?`~${w.count} ${textCopy(w.count===1?'request today':'requests today')}`:textCopy('no requests today')}</div></div>`;
      continue;
    }
    const [used,left]=usedParts(w);
    html+=`<div class="win">
      <div class="w-row"><span class="w-label">${esc(textCopy(w.label))}</span><span class="w-pct">${esc(used)}%</span></div>
      <div class="w-track" data-window="${esc(w.id)}"><div class="w-fill" style="width:${(Math.min(w.used,1)*100).toFixed(0)}%;background:${tone(w.used)}"></div></div>
      <div class="w-foot"><span class="w-reset">${resetCopy(w.resets_at)}</span><span class="w-left">${esc(ui().left(left))}</span></div>
    </div>`;
  }
  if(group&&boxed) html+=`</div>`;
  return html;
}

// A banked or granted reset is worth seeing at a glance, so it is a row of the card, not metadata
// A clock wound back, so it does not read as the card's refresh arrow
const RESET_ICON='<svg class="r-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.9 8.6A5.2 5.2 0 1 0 4.4 4.2"/><path d="M2.7 2.4v2.5h2.5"/><path d="M8 5.3v2.9l1.9 1.2"/></svg>';
// Under the pointer (or focused) the row opens to each reset against its own date and how long is left,
// so it is clear which to use first. It stays open through re-renders while the pointer is on it.
let resetsOpen=null;
function resetsRow(r,account){
  if(!r||!(r.count>0))return '';
  const until=r.expires>Date.now()?`<span class="r-until">${esc(ui().until(new Date(r.expires).toLocaleDateString(ui().locale,{month:'short',day:'numeric'})))}</span>`:'';
  const each=(r.each||[]).filter(e=>e.at===null||e.at>Date.now());
  const head=`<div class="r-head">${RESET_ICON}<span class="r-count">${esc(ui().resets(r.count))}</span>${until}</div>`;
  if(!each.length)return `<div class="c-resets">${head}</div>`;
  const rows=each.map(e=>`<div class="r-item">${e.count>1?`<span class="r-times">×${e.count}</span>`:''}<span class="r-when">${esc(e.at?resetStamp(e.at):e.known?ui().never:ui().unknown)}</span>${e.at?`<span class="r-rel">${esc(resetLeft(e.at))}</span>`:''}</div>`).join('');
  return `<div class="c-resets expandable${resetsOpen===account?' open':''}" tabindex="0" data-account="${esc(account)}">${head}<div class="r-list"><div>${rows}</div></div></div>`;
}
function resetStamp(ms){
  return new Date(ms).toLocaleString(ui().locale,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hourCycle:stateSnap.clock_24h?'h23':'h12'});
}
// "in 3 days", "tomorrow", "in 5 hours", in the reader's language
function resetLeft(ms){
  const diff=ms-Date.now(),rtf=new Intl.RelativeTimeFormat(ui().locale,{numeric:'auto'});
  if(diff<3600e3)return rtf.format(Math.max(1,Math.round(diff/60000)),'minute');
  if(diff<36*3600e3)return rtf.format(Math.round(diff/3600e3),'hour');
  return rtf.format(daysApart(Date.now(),ms),'day');
}
let resetsGrowing=false,resetsGrowTimer=0;
function openResets(row,on){
  if(!row||row.classList.contains('open')===on)return;
  resetsOpen=on?row.dataset.account:null;row.classList.toggle('open',on);
  if(on){resetsGrowing=true;clearTimeout(resetsGrowTimer);resetsGrowTimer=setTimeout(()=>{resetsGrowing=false;},520);}
}
const HISTORY_ICON='<svg class="r-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.8 8A5.2 5.2 0 1 1 4.4 11.8"/><path d="M2.8 11.3V8H6"/><path d="M8 4.8V8l2 1.3"/></svg>';
function renderCard(){
  const c=document.getElementById('card');
  if(typeof renderSessionToolsCard==='function'&&renderSessionToolsCard())return;
  c.classList.remove('session-card');
  if(hoverId===ALERTS_ID){ // the bell: the alert log in the same lobe
    const changed=!!c.dataset.account&&c.dataset.account!==ALERTS_ID;
    if(typeof setExtraContent==='function')setExtraContent([],[]);
    renderAlertLog();c.dataset.account=ALERTS_ID;if(typeof restoreSessionLinkError==='function')restoreSessionLinkError();placeCard();syncAccountFocus(card.classList.contains('show'));
    if(changed&&typeof changeDetailAccount==='function')changeDetailAccount();
    return;
  }
  const p=providers().find(x=>x.id===hoverId)||agentAccounts.find(x=>x.id===hoverId)||providers()[0];
  if(!p)return;
  const snap=p.snap;
  const extraWindows=p.base==='gemini'?snap.windows.filter(w=>laneFamily(w)==='3p'):[];
  const mainWindows=p.base==='gemini'?snap.windows.filter(w=>laneFamily(w)!=='3p'):snap.windows;
  const hasExtras=!!snap.details?.length||extraWindows.length>0;
  const inlineExtras=edgeIsVertical()&&hasExtras;
  const headIcon=glyphHtml(p,true);
  // p.name is no longer a constant: for a second account it is built from the home
  // directory's slug and the subscriptionType read out of .credentials.json.
  const title=esc(ui().title(p.name));
  const refresh=`<button class="c-refresh${refreshing[p.id]?' spinning':''}" type="button" aria-label="Refresh ${esc(p.name)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.9 9.2A5 5 0 1 1 11.5 4.3"/><path d="M12.2 1.9v2.8H9.4"/></svg></button>`;
  let html=`<div class="c-head">${headIcon}${hasExtras&&!inlineExtras?`<button class="c-title metadata-trigger" type="button" aria-expanded="false" aria-controls="extra-card">${title}</button>`:`<span class="c-title">${title}</span>`}${p.id==='collector'?'':`<div class="c-head-actions"><button class="c-history-trigger" type="button" data-account="${esc(p.id)}" aria-label="Sessions for ${esc(p.name)}" title="Sessions">${HISTORY_ICON}</button>${refresh}</div>`}</div>`;
  if(staleOf(snap)&&snap.fetched_at) html+=`<div class="c-sub">${ui().updated(ago(snap.fetched_at))}</div>`;
  if(snap.status==='needsAuth'){
    const who={claude:'Sign in to Claude Code to see usage.',cursor:'Sign in to Cursor to see usage.',codex:'Sign in to Codex to see usage.',grok:'Run grok login to see usage.',opencode:'Run opencode auth login to see usage.',gemini:'Sign in to Antigravity to see usage.'}[p.base]||'';
    html+=`<div class="c-note">${textCopy(who)}<br>${esc(textCopy(snap.note||''))}</div>`;
  }else if(!snap.windows.length){
    html+=`<div class="c-note">${esc(textCopy(snap.note||'Waiting for first reading…'))}</div>`;
  }else{
    html+=renderUsageWindows(mainWindows,p.base!=='gemini',p.base!=='gemini');
    html+=resetsRow(snap.resets,p.id);
    if(inlineExtras)html+=`<div class="inline-extras">${renderExtraContent(snap.details||[],extraWindows)}</div>`;
    if(snap.note) html+=`<div class="c-note">${esc(textCopy(snap.note))}</div>`;
  }
  if(!snap.windows.length){
    if(inlineExtras)html+=`<div class="inline-extras">${renderExtraContent(snap.details||[],extraWindows)}</div>`;
  }
  { // this account's live sessions: waiting before busy, newest first within each, so what gets cut is what matters least
    const acts=activity.filter(a=>a.account===p.id).sort((a,b)=>(b.state==='waiting')-(a.state==='waiting')||b.since-a.since);
    if(acts.length){
      html+=`<div class="c-sessions">`;
      for(const a of acts.slice(0,SESSION_ROWS)){
        const col=a.state==='waiting'?WATCH:INK;
        const linked=a.id&&a.sessionId&&['claude','codex','antigravity'].includes(a.provider);
        const tag=linked?'button':'div', attrs=linked?` type="button" data-session="${esc(a.id)}" data-account="${esc(a.account)}"`:"";
        html+=`<${tag}${attrs} class="s-row${linked?' session-link':''}"><span class="s-dot" style="background:${col}"></span>${esc(a.name)}<span style="color:#808080;margin-left:auto">${esc(textCopy(a.detail))}</span></${tag}>`;
      }
      html+=moreRow(acts.length-SESSION_ROWS)+`</div>`;
    }
  }
  const wasOpen=typeof extraTarget==='number'&&extraTarget===1&&c.dataset.account===p.id;
  const scroll=c.scrollTop,changedAccount=!!c.dataset.account&&c.dataset.account!==p.id;
  c.innerHTML=`<div class="usage-content">${html}</div>`;c.dataset.account=p.id;
  if(typeof setExtraContent==='function')setExtraContent(inlineExtras?[]:snap.details||[],inlineExtras?[]:extraWindows);
  const titleTrigger=c.querySelector('.metadata-trigger');
  if(titleTrigger){
    let closeTimer;
    const expand=on=>setExtraShown(on);
    titleTrigger.addEventListener('mouseenter',()=>{clearTimeout(closeTimer);expand(true);});
    titleTrigger.addEventListener('mouseleave',()=>{closeTimer=setTimeout(()=>{
      if(titleTrigger.isConnected&&!c.matches(':hover')&&!extraCard.matches(':hover'))expand(false);
    },250);});
    titleTrigger.addEventListener('focusin',()=>expand(true));
    titleTrigger.addEventListener('click',()=>expand(!extraTarget));
    if(wasOpen)expand(true);
  }
  c.scrollTop=scroll;
  if(changedAccount&&typeof changeDetailAccount==='function')changeDetailAccount();
  if(typeof restoreSessionLinkError==='function')restoreSessionLinkError();
  placeCard();
  syncAccountFocus(card.classList.contains('show'));
}
// Usage stays centered on the notch when the hovered account changes.
function placeCard(){
  // Measured on screen, written inside #root, which is offset while it slides
  const o=document.getElementById('root').getBoundingClientRect();
  const r=pill.getBoundingClientRect(), cell=pill.querySelector(`.cell[data-p="${hoverId}"]`)||pill;
  // Fit the alert log to the flat notch; side edges retain a compact readable column.
  const log=hoverId===ALERTS_ID,tools=typeof isSessionToolsCard==='function'&&isSessionToolsCard();
  card.classList.toggle('alert-card',log);
  if(log){
    const chips=card.querySelector('.a-chips'), style=getComputedStyle(card), switches=chips?[...chips.querySelectorAll('.a-chip')]:[];
    const controls=switches.reduce((sum,b)=>sum+b.offsetWidth,0)+Math.max(0,switches.length-1)*(chips?parseFloat(getComputedStyle(chips).gap):0);
    const minimum=controls+parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+2;
    // Its width is scaled with its text by --tz in CSS, so what is measured here is set back in the notch's own units
    const tz=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tz'))||1;
    card.style.setProperty('--card-width',Math.min((innerWidth-16)/tz,Math.max(minimum/tz,edgeIsVertical()?228:r.width))+'px');
  }
  else if(tools){const tz=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tz'))||1;card.style.setProperty('--card-width',Math.min(400,(innerWidth-16)/tz)+'px');}
  else card.style.removeProperty('--card-width');
  const cr=r, w=card.offsetWidth, h=card.offsetHeight;
  let x=cr.left+cr.width/2-w/2, y=cr.top+cr.height/2-h/2;
  if(notchEdge==='left') x=r.right;
  if(notchEdge==='right') x=r.left-w;
  if(notchEdge==='top') y=r.bottom;
  if(notchEdge==='bottom') y=r.top-h;
  // On side edges keep the log at the bell's top pocket; flat edges use the notch's center.
  if(hoverId===ALERTS_ID){
    if(edgeIsVertical())y=r.top-12; // retain the top alignment on side edges; flat edges center on the notch
  }
  const pixelRatio=devicePixelRatio||1;
  x=Math.round(Math.max(8,Math.min(innerWidth-w-8,x))*pixelRatio)/pixelRatio;y=Math.round(Math.max(8,Math.min(innerHeight-h-8,y))*pixelRatio)/pixelRatio;
  card.style.cssText+=`;transform:none;right:auto;bottom:auto;left:${x-o.left}px;top:${y-o.top}px`;
  // The transparent bridge only supplies hit testing; details.js draws the connected ink.
  const rr=(cell.querySelector('.ringwrap')||cell).getBoundingClientRect();
  if(edgeIsVertical()){
    const top=Math.max(r.top+12,rr.top+rr.height/2-46),bottom=Math.min(r.bottom-12,rr.top+rr.height/2+46);
    const left=notchEdge==='left'?r.right-8:x+w-1,right=notchEdge==='left'?x+1:r.left+8;
    tail.style.cssText=`left:${left-o.left}px;top:${top-o.top}px;width:${right-left}px;height:${bottom-top}px`;
  }else{
    const left=Math.max(r.left+12,rr.left+rr.width/2-46),right=Math.min(r.right-12,rr.left+rr.width/2+46);
    const top=notchEdge==='top'?r.bottom-8:y+h-1,bottom=notchEdge==='top'?y+1:r.top+8;
    tail.style.cssText=`left:${left-o.left}px;top:${top-o.top}px;width:${right-left}px;height:${bottom-top}px`;
  }
  if(typeof syncDetails==='function')syncDetails();
  if(typeof placeExtraCard==='function')placeExtraCard();

}

function esc(s){const d=document.createElement('div');d.textContent=s||'';return d.innerHTML;}

/* Hover: stays expanded while either the pill or the card is under the cursor; collapses after a 250 ms grace period (upstream motion rule) */
const card=document.getElementById('card'), pill=document.getElementById('pill'), tail=document.getElementById('tail');
// The reset row opens under the pointer or focus (resetsRow)
card.addEventListener('mouseover',e=>openResets(e.target.closest?.('.c-resets.expandable'),true));
card.addEventListener('mouseout',e=>{const row=e.target.closest?.('.c-resets.expandable');if(row&&!row.contains(e.relatedTarget))openResets(row,false);});
card.addEventListener('focusin',e=>openResets(e.target.closest?.('.c-resets.expandable'),true));
card.addEventListener('focusout',e=>{const row=e.target.closest?.('.c-resets.expandable');if(row&&!row.contains(e.relatedTarget))openResets(row,false);});
// The card grows while the row opens, and the notch's ink follows it frame by frame. While it opens the ink leads
// rather than easing after it, so no line of the list is ever drawn outside the black.
new ResizeObserver(()=>{
  if(!card.classList.contains('show'))return;
  placeCard();
  if(resetsGrowing&&detailBox&&detailAim&&detailBox.edge===detailAim.edge){
    for(const [lo,hi] of [['u0','u1'],['v0','v1']]){detailBox[lo]=Math.min(detailBox[lo],detailAim[lo]);detailBox[hi]=Math.max(detailBox[hi],detailAim[hi]);}
    drawDetails();
  }
}).observe(card);
let hideTimer=null,showTimer=null,pendingAccount=null;
/* Peek and hold, as popovers do. A ring under a resting pointer peeks at its usage; a click holds it. A peek
   follows the pointer, needs it to rest before another ring takes over (so rings crossed on the way to the card
   are passed by), and closes shortly after it leaves. A held card ignores the rings passed over, stays while the
   pointer is away for a while (for good, with the notch kept on screen), and closes on a click outside the notch
   or on its own trigger again. Whether the pointer is still over the notch also comes from main's own cursor
   check (notch_pointer): the moves Windows forwards to this page can stop after a click. */
const PEEK_OPEN=120, PEEK_SWITCH=110, PEEK_GRACE=300, HELD_AWAY=1500;
let cardHeld=false,awayTimer=0,restAt={x:-99,y:-99};
function holdCard(id){
  if(!id||!shown||window.agentTracking)return;
  if(cardHeld&&hoverId===id&&card.classList.contains('show')){hideCard();return;} // its trigger again: put it away
  clearTimeout(showTimer);clearTimeout(hideTimer);clearTimeout(awayTimer);awayTimer=0;pendingAccount=null;
  cardHeld=true;card.classList.add('held');
  if(hoverId===id&&card.classList.contains('show'))return;
  hoverId=id;
  if(card.classList.contains('show')){renderCard();armWatchdog();}else showCard();
}
// The pointer has left the notch: a peek goes after a short grace, a held card only after a longer absence
function leaveCard(){
  clearTimeout(showTimer);pendingAccount=null;
  if(!card.classList.contains('show'))return;
  if(typeof sessionSwitcherShowing==='function'&&sessionSwitcherShowing())return;
  if(cardHeld){if(!pinnedNow&&!awayTimer)awayTimer=setTimeout(()=>{awayTimer=0;hideCard();},HELD_AWAY);return;}
  scheduleHide();
}
function showCard(){if(typeof retractSlivers==='function')retractSlivers(); /* a card takes the place of any alert */clearTimeout(hideTimer);card.classList.remove('closing');card.classList.add('show');renderCard();setDetailsShown(true);armWatchdog();refreshClock();} // show first, then render: placeCard needs offsetHeight
// Nothing is broadcast when the Windows clock format changes, so ask again each time the card opens
function refreshClock(){
  invoke('get_state').then(s=>{
    if(!s||s.clock_24h===stateSnap.clock_24h) return;
    stateSnap.clock_24h=s.clock_24h;
    if(card.classList.contains('show')) renderCard();
  }).catch(()=>{});
}
function hideCard(){if(typeof closeSessionTools==='function')closeSessionTools();if(typeof clearSessionLinkError==='function')clearSessionLinkError();cardHeld=false;clearTimeout(awayTimer);awayTimer=0;card.classList.remove('held');if(typeof setExtraShown==='function')setExtraShown(false,!shown||window.agentTracking||carrying);clearTimeout(showTimer);pendingAccount=null;if(!card.classList.contains('show'))return;card.classList.remove('show');card.classList.add('closing');setDetailsShown(false,!shown||window.agentTracking||carrying);reportHot();}
function scheduleHide(){clearTimeout(hideTimer);hideTimer=setTimeout(hideCard,PEEK_GRACE);}
// ===== Diagnostics + geometry =====
function jslog(m){invoke('log_js',{msg:String(m)}).catch(()=>{});}
function callq(cmd,args){ // invoke with visible failure: any command error is reported on screen (a silent .catch used to swallow them)
  return invoke(cmd,args).catch(e=>{notice(cmd+' failed: '+(e&&e.message||e));throw e;});
}
// Hot rectangles use CSS pixels; main applies Electron zoom when testing DIP cursor coordinates.
function rectOf(el){const r=el.getBoundingClientRect(),k=1;return [r.left*k,r.top*k,r.width*k,r.height*k];}
/* The Electron main process gates click-through on these, so they are reported whenever the pill or card moves, not only
   when the card opens: a stale pill rectangle is a pill that cannot be clicked. */
let hotFrame=0,lastHot='';
function reportHot(){
  if(!hotFrame) hotFrame=uiMotion.frame(flushHot);
}
function flushHot(){hotFrame=0;uiMotion.paint('hot',paintHot,50);}
function paintHot(){
  const open=card.classList.contains('show');
  const rects=open?[rectOf(pill),rectOf(tail),rectOf(card)]:[rectOf(pill)];
  if(open&&typeof detailHotRect==='function'){const expanded=detailHotRect();if(expanded)rects.push(expanded);}
  if(open&&typeof extraTarget==='number'&&extraTarget){rects.push(rectOf(extraCard));const bridge=extraBridgeRect();if(bridge)rects.push(bridge);}
  const controls={};
  if(placeHandles()&&!(open&&typeof isSessionToolsCard==='function'&&isSessionToolsCard())){
    const handleRect=at=>[at.x-at.reach,at.y-at.reach,at.reach*2,at.reach*2];
    controls.settings=handleRect(orbAt);rects.push(controls.settings);
    if(showPin&&hovered!=='sprout'){const lead=handleRect(pinAt);controls[leadFace()]=lead;rects.push(lead);} // named for what the pocket holds
  }
  // The bell drawn out of the unread dot is a second way to the log; while it is out, a press there is the log's
  const sproutBox=typeof sproutRect==='function'?sproutRect():null;
  if(sproutBox){rects.push(sproutBox);if(hovered==='sprout')controls.alerts=sproutBox;}
  const updateBox=typeof updateDotRect==='function'?updateDotRect():null;
  if(updateBox){rects.push(updateBox);controls.update=updateBox;}
  if(typeof sliverRects==='function')rects.push(...sliverRects());
  const data={rects,controls,expanded:open,alerting:typeof slivering==='function'&&slivering()};const signature=JSON.stringify(data);
  if(signature!==lastHot){lastHot=signature;callq('set_hot',data).catch(()=>{lastHot='';});}
}
// Expansion and scrolling alter the clickable card bounds without a cursor move.
new ResizeObserver(()=>{if(card.classList.contains('show'))placeCard();reportHot();}).observe(card);
/* What wakes the folded notch: the resting pill, as long along the edge as the pill and deepened into
   the screen by the Mac's pillHotZone. Design.px(90), 34 here. because the pill is small and the
   place that opens it should not be (NotchViewModel.wakeLength and wakeDepth). */
const WAKE_BAND=34;
function wakeRect(){
  const r=document.getElementById('rest').getBoundingClientRect(), k=1;
  const b=WAKE_BAND*(parseFloat(document.documentElement.style.zoom)||1); // rects come back zoomed
  let x=r.left,y=r.top,w=r.width,h=r.height;
  if(notchEdge==='left') w+=b; else if(notchEdge==='top') h+=b; else if(notchEdge==='bottom'){ y-=b; h+=b; } else { x-=b; w+=b; }
  return [x*k,y*k,w*k,h*k];
}
/* Reserved background probe geometry beside the resting pill. */
const PROBE_GAP=4, PROBE_DEPTH=12;
function probeRect(){
  const r=document.getElementById('rest').getBoundingClientRect(), k=1;
  const z=parseFloat(document.documentElement.style.zoom)||1, g=PROBE_GAP*z, d=PROBE_DEPTH*z;
  let x=r.left-g-d,y=r.top,w=d,h=r.height;
  if(notchEdge==='left') x=r.right+g;
  else if(notchEdge==='top'){ x=r.left; y=r.bottom+g; w=r.width; h=d; }
  else if(notchEdge==='bottom'){ x=r.left; y=r.top-g-d; w=r.width; h=d; }
  return [x*k,y*k,w*k,h*k];
}
function armWatchdog(){
  uiMotion.frame(reportHot); // wait one frame so renderCard's new content is laid out before measuring
}
// Electron owns window dimensions and zoom; the renderer reports CSS viewport metrics
// before acknowledging a destination placement. It never applies a second CSS zoom.
function fitZoom(){ return 1; }
function reportDpr(settled){
  const z=fitZoom();
  jslog(`dpr=${window.devicePixelRatio} inner=${innerWidth}x${innerHeight} cssZoom=${z.toFixed(3)}`);
  callq('report_dpr',{dpr:window.devicePixelRatio||1,w:innerWidth,h:innerHeight,settled:settled===true}).catch(()=>{});
}
window.addEventListener('resize',()=>{clearTimeout(window._dprT);window._dprT=setTimeout(()=>{reportDpr(true);reportHot();},120);});
matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener('change',()=>reportDpr());
// A landing on a screen at another scale: empty the page, which leaves the transparent window
// invisible while it is resized and re-zoomed, and say so once that has painted. hiding the window
// itself would pause the page, and the re-zoom would then happen in plain view
listen('notch_landing',()=>{
  document.documentElement.style.visibility='hidden';
  uiMotion.frame(()=>uiMotion.frame(()=>invoke('notch_hidden').catch(()=>{})));
}).catch(()=>{});
listen('notch_reveal',()=>{ document.documentElement.style.visibility=''; }).catch(()=>{});

/* Collapse test: no trust in element-level mouseenter/mouseleave/e.target at all : 
   pure geometry: is the cursor (clientX/Y) inside pill rect ∪ card rect ∪ their bounding box?
   Leaving the window: document mouseout (relatedTarget=null) plus the native cursor watchdog (system cursor) as a second line. */
function inRect(x,y,r,pad){return x>=r.left-pad&&y>=r.top-pad&&x<r.right+pad&&y<r.bottom+pad;}
function syncAccountFocus(on){
  if(hoverId===ALERTS_ID)on=false; // the log is about every account, so none recedes
  if(typeof isSessionToolsCard==='function'&&isSessionToolsCard())on=false;
  for(const el of pill.querySelectorAll('.cell')){
    const selected=on&&el.dataset.p===hoverId;
    el.classList.toggle('focused-account',selected);
    el.classList.toggle('compact-account',on&&!selected);
    el.setAttribute('aria-expanded',String(selected));
  }
}
function cellAt(x,y){
  for(const el of pill.querySelectorAll('.cell')){
    const hit=el.classList.contains('compact-account')?(el.querySelector('.glyph .mark,.glyph img')||el.querySelector('.glyph')):el;
    if(inRect(x,y,hit.getBoundingClientRect(),6))return el.dataset.p;
  }
  return null;
}
pill.addEventListener('focusin',e=>{
  const cell=e.target.closest('.cell');if(!cell||!shown||window.agentTracking||typeof sessionSwitcherShowing==='function'&&(sessionSwitcherShowing()||switcherPending))return;
  clearTimeout(showTimer);pendingAccount=null;hoverId=cell.dataset.p;
  if(card.classList.contains('show'))renderCard();else showCard();
});
pill.addEventListener('keydown',e=>{
  if(!e.target.closest('.cell')||!['Enter',' '].includes(e.key))return;
  e.preventDefault();holdCard(e.target.closest('.cell').dataset.p);
});
function pointerInHot(x,y){
  const p=pill.getBoundingClientRect();
  if(inRect(x,y,p,4))return true;
  if(!card.classList.contains('show'))return false;
  if(typeof extraTarget==='number'&&extraTarget&&(inRect(x,y,extraCard.getBoundingClientRect(),4)||extraContains(x,y)))return true;
  if(typeof detailContains==='function'&&detailContains(x,y))return true;
  const c=card.getBoundingClientRect();
  if(inRect(x,y,c,4))return true;
  return inRect(x,y,tail.getBoundingClientRect(),4);
}
let hideLogged=0;
document.addEventListener('mousemove',e=>{
  // Folded, the page is sent events only over the pill, so any movement at all is the pointer reaching it
  if(!shown) return; // stowed or on its way out; only the shortcut brings it back
  if(window.agentTracking)return;
  if(dragging)return; // no card while dragging
  if(carrying) return; // the notch is in hand; the card would only be in the way
  if(typeof sessionSwitcherShowing==='function'&&sessionSwitcherShowing())return;
  setHovered(onHandle(e.clientX,e.clientY));
  // Over a handle or the pin/refresh row, the card gives way
  // The bell's own log stays open while the pointer is back on the bell; any other handle takes over from the card
  if(hovered==='pin'&&leadFace()==='alerts'&&card.classList.contains('show')&&hoverId===ALERTS_ID){clearTimeout(hideTimer);return;}
  if(hovered||e.target.closest?.('.ctl')){ clearTimeout(showTimer);pendingAccount=null;if(card.classList.contains('show')){ clearTimeout(hideTimer); hideCard(); } return; }
  const hot=pointerInHot(e.clientX,e.clientY);
  // Over an alert's sliver: it holds (and counts as seen), and nothing else under the pointer reacts
  if(typeof slivering==='function'&&slivering()){const over=sliverAt(e.clientX,e.clientY);holdSlivers(!!over,over);if(over)return;}
  if(hot){
    clearTimeout(hideTimer);clearTimeout(awayTimer);awayTimer=0;
    if(cardHeld){clearTimeout(showTimer);pendingAccount=null;return;} // held: rings passed over leave it be
    const id=cellAt(e.clientX,e.clientY);
    if(id&&(!card.classList.contains('show')||id!==hoverId)){
      // Only a pointer at rest peeks: every move of more than a few pixels starts the wait again
      const moved=Math.hypot(e.clientX-restAt.x,e.clientY-restAt.y)>3;
      if(pendingAccount!==id||moved){
        restAt={x:e.clientX,y:e.clientY};clearTimeout(showTimer);pendingAccount=id;
        showTimer=setTimeout(()=>{
          pendingAccount=null;hoverId=id;
          if(card.classList.contains('show')){renderCard();armWatchdog();}else showCard();
        },card.classList.contains('show')?PEEK_SWITCH:PEEK_OPEN);
      }
    }else{clearTimeout(showTimer);pendingAccount=null;}
  }
  else { if(card.classList.contains('show')&&hideLogged++<5) jslog(`mousemove left the hot area at ${e.clientX},${e.clientY}`); leaveCard(); }
});
document.addEventListener('mouseout',e=>{if(!e.relatedTarget)leaveCard();}); // relatedTarget null = the cursor left the page
// Main relays a physical press into the page when Windows does not deliver it; this says that one did arrive
document.addEventListener('pointerdown',()=>{invoke('page_pressed').catch(()=>{});},true);
// A press anywhere outside the notch puts a held card away (main sees it through its input helper)
listen('outside_press',()=>{if(cardHeld)hideCard();}).catch(()=>{});
card.addEventListener('click',async e=>{
  if(e.target.closest('.session-pin,.session-tool-action'))return;
  const history=e.target.closest('.c-history-trigger');
  if(history){requestSessionSwitcher(true,history.dataset.account);return;}
  const session=e.target.closest('.session-link');
  if(session){
    clearSessionLinkError();
    try{if(await invoke('open_working_session',{id:session.dataset.session,account:session.dataset.account})){hideCard();return;}}catch(error){showSessionLinkError(error.message||'VS Code could not be opened.');return;}
    showSessionLinkError('VS Code could not open this session. Check that the matching workspace and extension are open.');return;
  }
  const b=e.target.closest('.c-refresh');if(b&&card.dataset.account){refreshRing(card.dataset.account);b.classList.add('spinning');}});
// Clicking a card being peeked at holds it
card.addEventListener('click',()=>{if(!cardHeld&&card.classList.contains('show'))holdCard(hoverId);});
// Card content changes change its height -> report the hot rectangles again
listen('usage',()=>{if(card.classList.contains('show'))armWatchdog();}).catch(()=>{});
listen('state',()=>{if(card.classList.contains('show'))armWatchdog();}).catch(()=>{});
/* The pill can be dragged up and down the right edge. Press and move more than 4 px = drag (handed to main,
   which follows the system cursor; the card is collapsed first); release without moving = click (refetches that ring). */
let press=null, dragging=false;
/* As on the Mac, a clicked ring presses in until its reading lands, and the reading turns once.
   Each provider's reading listener below calls settle() for its ring; PRESS_MAX is only the fallback.
   Main answers false when no reading is coming (Claude inside its rate-limit wait). */
const PRESS_MIN=380, PRESS_MAX=6000;
const refreshing={};
function refreshRing(id){
  if(refreshing[id]) return;
  refreshing[id]={at:Date.now(),timer:setTimeout(()=>settle(id),PRESS_MAX)};
  renderRing();
  turnReading(id);
  // The cell id addresses the DOM, the provider id addresses the collector: a second Claude
  // account's cell is `claude@work`, which no command answers to.
  const provider=(providers().find(p=>p.id===id)||{}).base||id;
  invoke('refresh_ring',{provider}).then(coming=>{if(!coming)settle(id);}).catch(()=>settle(id));
}
// The reading has a layer of its own that renders never replace, turned as a whole element so the
// compositor can run it; it finishes its turn whenever the press lets go
function turnReading(id,reveal=false){
  const el=pill.querySelector(`.cell[data-p="${id}"] svg.reading`);
  if(!el||matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if(el.getAnimations().some(a=>a.playState==='running')) return;
  el.style.transformOrigin='50% 50%';
  el.animate(reveal?[{transform:'rotate(-100deg)',opacity:0},{transform:'rotate(0deg)',opacity:1}]:[{transform:'rotate(0deg)'},{transform:'rotate(360deg)'}],{duration:reveal?650:950,easing:'cubic-bezier(.22,1,.36,1)'});
}
function settle(id){
  const r=refreshing[id]; if(!r) return;
  clearTimeout(r.timer);
  const wait=r.at+PRESS_MIN-Date.now();
  if(wait>0){ r.timer=setTimeout(()=>settle(id),wait); return; }
  delete refreshing[id];
  renderRing();
  card.querySelector(`.c-refresh.spinning`)?.classList.toggle('spinning',!!refreshing[card.dataset.account]);
}
// Alt+drag, the Mac's ⌥-drag. Without Alt a press on the pill is only ever a click. a ring
// refreshes (#244). so one that slips can no longer carry the notch off (#251).
pill.addEventListener('mousedown',e=>{ if(e.button!==0||folded||e.target.closest('.ctl'))return; press={x:e.clientX,y:e.clientY,id:cellAt(e.clientX,e.clientY),alt:e.altKey}; });
document.addEventListener('mousemove',e=>{
  if(!press||dragging||!press.alt)return;
  if(Math.abs(e.clientY-press.y)>4||Math.abs(e.clientX-press.x)>4){
    dragging=true; clearTimeout(hideTimer); hideCard();
    invoke('drag_begin').catch(err=>{notice('drag_begin failed: '+err);dragging=false;});
  }
});
document.addEventListener('mouseup',e=>{
  if(e.button!==0)return;
  if(press&&!dragging&&press.id) holdCard(press.id); // a ring click holds its card; refresh is the card's own button
  press=null;
});
// The Mac's right-click menu, naming the ring or card under the pointer; Electron's default menu never shows
document.addEventListener('contextmenu',e=>{
  e.preventDefault();
  if(dragging||!pointerInHot(e.clientX,e.clientY)) return;
  // The command returns once the menu has closed, which is when folding may be thought about again
  menuOpen=true;
  invoke('show_notch_menu',{provider:cellAt(e.clientX,e.clientY)||hoverId}).catch(err=>notice('show_notch_menu failed: '+err))
    .finally(()=>{ menuOpen=false; scheduleFold(); });
});
listen('drag_end',()=>{dragging=false;press=null;reportHot();scheduleFold();}).catch(()=>{});

function notice(msg){
  const n=document.getElementById('notice');
  n.textContent=msg;n.classList.add('show');
  clearTimeout(n._h);n._h=setTimeout(()=>n.classList.remove('show'),6000);
}

/* ---- The handles ----------------------------------------------------------
   Settings past the far end of the pill, pin past the near one. Placed whenever the hot rectangles
   are reported, since those follow every change to the pill. Hover is a circle round each fillet's
   centre, as on the Mac, not the whole box; the card gives way while either is under the pointer.
   Settings opens the panel; Pin keeps the notch visible at its current location. */
const orb=document.getElementById('orb'), pinHandle=document.getElementById('pin-handle');
function handleMetrics(edge=notchEdge,length){
  const horizontal=edge==='top'||edge==='bottom';
  const depth=horizontal?90:70;
  length??=horizontal?pill.offsetWidth:pill.offsetHeight;
  const scale=Math.max(.86,Math.min(1.25,Math.sqrt(depth/70)*(.72+.28*Math.min(1,length/228))));
  return {scale,flare:38.7*scale,arm:32*scale,stroke:10.2*scale,disc:48*scale,reach:35*scale,glyph:23*scale};
}
let orbAt=null,pinAt=null,hovered=null,orbSpins=0,showPin=true,carrying=false;
// x and y are on screen; the handles live in #root, which is offset while it slides
function put(el,x,y,o,metrics){
  const {reach,glyph}=metrics;
  el.style.left=(x-o.left-reach)+'px';el.style.top=(y-o.top-reach)+'px';
  el.style.width=el.style.height=2*reach+'px';el.style.setProperty('--glyph-size',glyph+'px');
  el.classList.add('placed');return {x,y,reach};
}
function placeHandles(){
  const retreated=card.classList.contains('show')&&typeof isSessionToolsCard==='function'&&isSessionToolsCard();
  orb.inert=retreated;pinHandle.inert=retreated;
  const r=pill.getBoundingClientRect();if(!r.width)return false;
  const metrics=handleMetrics(),R=metrics.flare,origin=document.getElementById('root').getBoundingClientRect();
  // Each fillet's centre: the corner of its square diagonally opposite the one on the screen edge
  const far=notchEdge==='left'?[r.left+R,r.bottom+R]:notchEdge==='top'?[r.right+R,r.top+R]
    :notchEdge==='bottom'?[r.right+R,r.bottom-R]:[r.right-R,r.bottom+R];
  const close=notchEdge==='left'?[r.left+R,r.top-R]:notchEdge==='top'?[r.left-R,r.top+R]
    :notchEdge==='bottom'?[r.left-R,r.bottom-R]:[r.right-R,r.top-R];
  orbAt=put(orb,far[0],far[1],origin,metrics);
  pinAt=showPin?put(pinHandle,close[0],close[1],origin,metrics):null;
  if(!showPin)pinHandle.classList.remove('placed','hover');return true;
}
function near(at,x,y){return !!at&&Math.abs(x-at.x)<=at.reach&&Math.abs(y-at.y)<=at.reach;}
// The unread dot's bell comes first: it sits in the notch's corner, inside the pin's reach on some edges
function onHandle(x,y){
  if(typeof updateDotHit==='function'&&updateDotHit(x,y))return 'update';
  if(typeof sproutHit==='function'&&sproutHit(x,y))return 'sprout';
  if(card.classList.contains('show')&&typeof isSessionToolsCard==='function'&&isSessionToolsCard())return null;
  return near(orbAt,x,y)?'orb':near(pinAt,x,y)?'pin':null;
}
function setHovered(which){
  const was=hovered;hovered=which;if(was!==which&&typeof hoverUpdate==='function')hoverUpdate(which==='update');orb.classList.toggle('hover',which==='orb');pinHandle.classList.toggle('hover',which==='pin');
  if(was!==which&&typeof morphHandles==='function') morphHandles();
  if(was!==which&&(was==='sprout'||which==='sprout'))reportHot();
}
orb.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();callq('activate_control',{control:'settings'}).catch(()=>{});});
orb.addEventListener('click',e=>{if(e.detail===0)callq('activate_control',{control:'settings'}).catch(()=>{});});
pinHandle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();e.stopPropagation();callq('activate_control',{control:leadFace()}).catch(()=>{});});
pinHandle.addEventListener('click',e=>{if(e.detail===0)callq('activate_control',{control:leadFace()}).catch(()=>{});});
// The Mac's press: down fast, back with a little bounce
function pressIn(el){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([{transform:'scale(1)',easing:'ease-out'},{transform:'scale(.84)',offset:.21,easing:'cubic-bezier(.34,1.56,.64,1)'},{transform:'scale(1)'}],{duration:430});
}
// main.cjs confirms an activation from either click path (page or input helper), so both animate once
listen('control_pressed',e=>{
  if(e.payload==='settings'){orb.style.setProperty('--spins',++orbSpins);pressIn(orb);}
  if(e.payload==='pin')pressIn(pinHandle);
  if(e.payload==='alerts'){pressIn(hovered==='sprout'?document.getElementById('alert-sprout'):pinHandle);if(typeof openAlertLog==='function')openAlertLog();}
});
/* The leading pocket holds more than one control: pin, then the alert log, each there unless turned off in
   Settings. Scrolling over it swaps them (swapHandle in shape.js), the one in the pocket flowing back into the
   notch and the next budding out; it stays on the last one chosen. */
function leadFace(){return leadFaces[Math.min(leadIndex,leadFaces.length-1)]||'pin';}
function renderLead(){
  const face=leadFace(),pinHandle=document.getElementById('pin-handle'); // callable before the handle constants below exist
  pinHandle.classList.toggle('face-alerts',face==='alerts');pinHandle.classList.toggle('face-pin',face==='pin');
  if(face==='pin'){pinHandle.setAttribute('aria-label',pinnedNow?'Let it hide':'Keep on screen');pinHandle.setAttribute('aria-pressed',String(pinnedNow));}
  else{const n=typeof unreadCount==='function'?unreadCount():0;pinHandle.setAttribute('aria-label',n?`Alerts, ${n} new`:'Alerts');pinHandle.removeAttribute('aria-pressed');}
  if(typeof reportHot==='function')reportHot();
}
function renderNotchButtons(value){
  if(!value)return;
  notchButtons={pin:value.pin!==false,alerts:value.alerts!==false};
  const was=leadFace();leadFaces=['pin','alerts'].filter(f=>notchButtons[f]);
  leadIndex=Math.max(0,leadFaces.indexOf(was));showPin=leadFaces.length>0;
  renderRing();renderLead();reportHot();if(typeof drawShape==='function')drawShape();
}
document.addEventListener('wheel',e=>{
  if(e.target.closest?.('#card'))return;
  if(hovered!=='pin'||leadFaces.length<2)return;
  e.preventDefault();
  if(Math.abs(e.deltaY)<4)return;
  const step=e.deltaY>0?1:-1;
  // The bell's swing comes from the pull itself (drawPull), so nothing more plays once it is home
  swapHandle(0,()=>{leadIndex=(leadIndex+step+leadFaces.length)%leadFaces.length;renderLead();});
},{passive:false});
listen('notch_buttons',e=>renderNotchButtons(e.payload)).catch(()=>{});
invoke('get_notch_buttons').then(renderNotchButtons).catch(()=>{});
// Legacy Alt-drag still retracts the handles while carrying; the shortcut moves the notch directly.
listen('move_begin',()=>{carrying=true;window.agentTracking=true;document.getElementById('root').classList.add('carrying');moveArms(0,ARM_MOTION.absorb);setHovered(null);clearTimeout(hideTimer);hideCard();});
listen('move_end',()=>{carrying=false;window.agentTracking=false;document.getElementById('root').classList.remove('carrying');setHovered(null);reportHot();moveArms(1,ARM_MOTION.emerge,smooth);});
document.addEventListener('pointerup',e=>{if(e.button===0&&carrying)callq('end_move').catch(()=>{});});
/* Appearing grows the notch out of the screen edge; disappearing slides it away past the edge
   (agent-usage.css). The Mac's resting-pill fold is not used: with nothing on screen at rest it read as a
   strip growing, and a slide in hides the base until the end, so the notch seemed to float in. */
let shown=false;
function setFolded(f){
  if(f===folded) return;
  folded=f;
  if(f){ clearTimeout(hideTimer); hideCard(); setHovered(null); }
  document.body.classList.toggle('folded',f);
  reportHot();
}
function unfold(){ clearTimeout(foldTimer); }
function scheduleFold(){ clearTimeout(foldTimer); }
let shownAt=0;
function setShown(on,edge){
  if(on===shown) return;
  shown=on;if(on)shownAt=performance.now();
  const root=document.getElementById('root');
  if(!on){ if(typeof notificationRim!=='undefined')notificationRim.clear(); if(typeof retractSlivers==='function')retractSlivers(true); root.classList.remove('visible'); uiMotion.cancel(openFrame);openFrame=0;moveArms(0,ARM_MOTION.absorb);setHovered(null); return; } // absorb, then slide away
  /* Arriving: wells out of the edge instead of sliding in, so its base and flares sit on the screen edge
     from the first frame. Laid out in place and closed against the edge with transitions held, then opened. */
  document.body.classList.add('no-motion');
  if(edge&&edge!==notchEdge){ applyEdge(edge); renderRing(); }
  root.classList.add('visible','growing');
  openShape(); // closed against the edge before the first frame, then the spring (shape.js)
  void pill.offsetWidth;
  document.body.classList.remove('no-motion');
  root.classList.remove('growing'); // the arms sweep out as it opens
  if(typeof startPendingUpdateRim==='function')startPendingUpdateRim();
}
// Hit rectangles are measured on screen, so the ones taken mid-slide are re-taken once it lands
document.getElementById('root').addEventListener('transitionend',e=>{ if(e.target.id==='root') reportHot(); });
function applyUiFlags(f){ scheduleFold(); if(f){ pinnedNow=f.notch_on_hover===false&&f.notch_visible!==false; renderRing(); } }
listen('notch_pointer',e=>{ pointerIn=e.payload===true; if(pointerIn) unfold(); else { scheduleFold(); leaveCard(); if(typeof hoverUpdate==='function')hoverUpdate(false); if(typeof holdSlivers==='function')holdSlivers(false); } }).catch(()=>{});
listen('ui_flags',e=>applyUiFlags(e.payload)).catch(()=>{});
listen('pill_backdrop',e=>{
  if(e.payload==='dark'||e.payload==='light') document.body.dataset.behind=e.payload;
  else delete document.body.dataset.behind;
}).catch(()=>{});
invoke('get_ui_flags').then(applyUiFlags).catch(()=>{});

listen('usage',e=>{usage=e.payload||usage;claudeActionMessage='';settle('claude');renderRing();if(card.classList.contains('show'))renderCard();})
  .catch(e=>notice('listen(usage) failed: '+e));
listen('state',e=>{stateSnap=e.payload||stateSnap;setUiLanguage(stateSnap.lang_resolved);renderRing();if(card.classList.contains('show'))renderCard();})
  .catch(e=>notice('listen(state) failed: '+e));
listen('notice',e=>notice(e.payload)).catch(()=>{});
listen('codex',e=>{codexSnap=e.payload||codexSnap;settle('codex');renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
listen('cursor',e=>{cursorSnap=e.payload||cursorSnap;settle('cursor');renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_cursor').then(u=>{cursorSnap=u||cursorSnap;renderRing();}).catch(()=>{});
listen('grok',e=>{grokSnap=e.payload||grokSnap;settle('grok');renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_grok').then(u=>{grokSnap=u||grokSnap;renderRing();}).catch(()=>{});

listen('antigravity',e=>{agSnap=e.payload||agSnap;settle('gemini');renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_antigravity').then(u=>{agSnap=u||agSnap;renderRing();}).catch(()=>{});
listen('glm',e=>{glmSnap=e.payload||glmSnap;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_glm').then(u=>{glmSnap=u||glmSnap;renderRing();}).catch(()=>{});
listen('opencode',e=>{opencodeSnap=e.payload||opencodeSnap;settle('opencode');renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_opencode').then(u=>{opencodeSnap=u||opencodeSnap;renderRing();}).catch(()=>{});
invoke('get_notch_slots').then(v=>{if(Array.isArray(v)){notchSlots=v;renderRing();}}).catch(()=>{});
listen('notch_slots',e=>{
  notchSlots=Array.isArray(e.payload)?e.payload:null;
  renderRing();
  if(card.classList.contains('show')){renderCard();armWatchdog();}
}).catch(()=>{});
invoke('get_antigravity_prefs').then(p=>{if(p){agPrefs=p;renderRing();}}).catch(()=>{});
invoke('get_weekly_ring').then(v=>{if(typeof v==='string'){weeklyRing=v;renderRing();}}).catch(()=>{});
listen('weekly_ring',e=>{if(typeof e.payload==='string'){weeklyRing=e.payload;renderRing();}}).catch(()=>{});
invoke('get_color_transition').then(v=>{if(typeof v==='string'){colorTransition=v;renderRing();}}).catch(()=>{});
listen('color_transition',e=>{if(typeof e.payload==='string'){colorTransition=e.payload;renderRing();}}).catch(()=>{});
listen('antigravity_prefs',e=>{if(e.payload){agPrefs=e.payload;renderRing();}}).catch(()=>{});
listen('glyphs',e=>{glyphs=e.payload||glyphs;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
listen('activity',e=>{activity=e.payload||activity;renderRing();if(card.classList.contains('show'))renderCard();}).catch(()=>{});
invoke('get_activity').then(a=>{activity=a||activity;renderRing();}).catch(()=>{});
invoke('get_glyphs').then(g=>{glyphs=g||glyphs;renderRing();}).catch(()=>{});
// The edge: pushed on every placement (a drag that snapped elsewhere, or Settings), and asked for once
// at startup in case the placement happened before this page was listening.
listen('notch_edge',e=>applyEdge(e.payload)).catch(()=>{});
// applyEdge measures for the edge it is given; on the right-hand one it returns early, so the first
// measurement is made here either way. and still made if the ask fails, from the default edge.
invoke('get_notch_edge').then(e=>{applyEdge(e);reportDpr();}).catch(()=>reportDpr());
invoke('get_codex').then(u=>{codexSnap=u||codexSnap;renderRing();}).catch(()=>{});
invoke('get_usage').then(u=>{usage=u||usage;renderRing();}).catch(e=>notice('get_usage failed: '+e));
invoke('get_state').then(s=>{stateSnap=s||stateSnap;setUiLanguage(stateSnap.lang_resolved);renderRing();}).catch(()=>{});
setInterval(renderRing,30_000); // stale state and reset copy move with time


listen('refresh_started',()=>{for(const p of providers())turnReading(p.id);}).catch(()=>{});
