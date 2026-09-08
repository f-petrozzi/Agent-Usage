// Sample-only companion to the native Windows renderer. No provider requests.
const frame = document.querySelector('#frame');
let compact=false, pinned=true, weekly=true, hoveredAccount=-1;
try { const saved=JSON.parse(localStorage.getItem('agent-usage-design')||'{}');compact=saved.compact===true;weekly=saved.weekly!==false; } catch {}
const colors=n=>n<15?'#ff6b72':n<40?'#f2b24c':'#95d8c5';
const symbols={codex:'<path d="m8 5-6 7 6 7m8-14 6 7-6 7m-2-14-4 14"/>',claude:Array.from({length:10},(_,i)=>{const a=i*Math.PI/5;return `<path d="M${12+Math.cos(a)*4} ${12+Math.sin(a)*4}L${12+Math.cos(a)*10} ${12+Math.sin(a)*10}"/>`;}).join(''),close:'<path d="m6 6 12 12M6 18 18 6"/>',refresh:'<path d="M20 9V4h-5M20 4a8 8 0 1 0 1 10"/>',collapse:'<path d="m5 15 7-7 7 7"/>',expand:'<path d="m5 9 7 7 7-7"/>',pin:'<path d="M8 3h8v7l3 4H5l3-4ZM12 14v8"/>',unpin:'<path d="M8 3h8v7l3 4H5l3-4ZM12 14v8M3 3l18 18"/>',reserve:'<path d="M4 8h16v13H4zM2 4h20v4H2zM10 12h4"/>'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${symbols[name]||symbols.reserve}</svg>`;
const day=86400000, now=Date.now();
const base=[
{name:'Codex a',provider:'codex',active:true,plan:'Pro',left:[75,60],clock:[.62,.45],resets:['3h 06m','3d 03h'],banked:2,expiries:[now+2*day,now+12*day],credits:1294.14},
{name:'Codex b',provider:'codex',plan:'Pro',left:[93,82],clock:[.8,.7],resets:['4h 00m','4d 21h'],banked:1,expiries:[now+19*day],credits:0},
{name:'Claude',provider:'claude',plan:'Pro',left:[94,80],clock:[.7,.5],resets:['3h 30m','3d 12h'],extra:83.85}
];
function accounts(){const rows=structuredClone(base),state=document.querySelector('#scenario').value;
if(state==='low'){rows[0].left=[28,14];rows[0].note='At this pace, empty by 4:14pm';rows[2].left=[12,36];rows[2].note='At this pace, empty by 2:40pm';}
if(state==='exhausted'){rows[2].left=[34,0];rows[2].note='Out until 12:51am';}
if(state==='limited')rows[2].note='Claude is rate limited; retry after 14:30 (last reading)';
if(state==='error')rows[2].error='Can’t read Claude limits. Try again shortly.';
if(state==='unknown'){rows[0].expiries=null;rows[1].expiries=[null];}
if(state==='full')rows.forEach(a=>a.left=[100,100]);return rows;}
function point(r,f){const a=(135+270*f)*Math.PI/180;return [44+r*Math.cos(a),44+r*Math.sin(a)];}
function arc(r,f){return `M${point(r,0)}A${r} ${r} 0 ${f*270>180?1:0} 1 ${point(r,f)}`;}
function gauge(a){const n=a.error?null:a.left[weekly?1:0];return `<div class="gauge" role="img" aria-label="${a.name}: ${n===null?'usage unavailable':n+' percent remaining, '+(weekly?'weekly':'5-hour')}"><svg viewBox="0 0 88 88"><g fill="none" stroke-width="5" stroke-linecap="round"><path d="${arc(40,1)}" stroke="#2b3340"/>${n>0?`<path d="${arc(40,n/100)}" stroke="${colors(n)}"/>`:''}</g></svg><div class="gauge-value ${n===100?'three':''}"><strong>${n===null?'—':n}</strong><small>% left</small></div></div>`;}
function button(action,label,symbol,pressed){return `<button data-action="${action}" aria-label="${label}" title="${label}" ${pressed===undefined?'':`aria-pressed="${pressed}"`}>${icon(symbol)}</button>`;}
function header(){const state=document.querySelector('#scenario').value;return `<header class="frame-header"><div class="title-row"><strong>Usage</strong><div class="actions">${button('pin','Toggle simulated pin',pinned?'pin':'unpin',pinned)}${button('refresh','Refresh sample','refresh')}${button('fold',compact?'Expand':'Collapse',compact?'expand':'collapse')}${button('close','Hide preview','close')}</div></div><div class="status ${state==='stale'?'warning':''}">${state==='loading'?'Reading limits…':state==='stale'?'Stale — refresh to update':'Updated just now'}</div><div class="selection-row"><div class="tabs" role="group" aria-label="Gauge window"><button data-action="hourly" aria-pressed="${!weekly}">5-hour</button><button data-action="weekly" aria-pressed="${weekly}">Weekly</button></div></div></header>`;}
function identity(a){return `<div class="identity"><span class="provider-${a.provider}">${icon(a.provider)}</span><span>${a.name}</span></div>`;}
function details(a){let content='';if(a.banked!==undefined){content+=`<div class="bank-hover" tabindex="0" aria-label="${a.banked} banked resets; hover or focus for expiration dates"><div class="detail-title">${icon('reserve')}${a.banked} ${a.banked===1?'reset':'resets'} banked</div><div class="bank-reveal"><div class="bank-content">`;
if(a.banked>0){if(!a.expiries)content+='<div>Expiration dates unavailable</div>';else a.expiries.forEach(t=>{content+=t===null?'<div>No expiration</div>':`<div class="detail-row ${t-now<3*day?'urgent':''}"><span>Expires</span><time datetime="${new Date(t).toISOString()}">${new Date(t).toLocaleString('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}</time></div>`;});}}
if(a.banked!==undefined)content+='</div></div></div>';
if(a.credits!==undefined)content+=`<div>${a.credits.toLocaleString('en-US',{minimumFractionDigits:2})} credits available</div>`;
if(a.extra!==undefined)content+=`<div>Extra usage on / $${a.extra.toFixed(2)} used</div>`;
if(a.note)content+=`<div class="urgent">${a.note}</div>`;return `<div class="details">${content}</div>`;}
function render(){hoveredAccount=-1;frame.hidden=false;frame.className='frame'+(compact?' compact':'');document.querySelector('#mode').textContent=compact?'Show expanded':'Show compact';try{localStorage.setItem('agent-usage-design',JSON.stringify({compact,weekly}));}catch{}
const rows=accounts();if(document.querySelector('#scenario').value==='loading'){frame.innerHTML=header()+'<div class="message" role="status">Reading limits…</div>';return;}
if(compact){frame.innerHTML=`<div class="compact-controls"><button data-action="${weekly?'hourly':'weekly'}" aria-label="${weekly?'Show 5-hour usage':'Show weekly usage'}" title="${weekly?'Show 5-hour usage':'Show weekly usage'}">${weekly?'W':'5h'}</button>${button('fold','Expand','expand')}</div>`+`<div class="cells">${rows.map((a,index)=>`<div data-account="${index}" tabindex="0" class="cell" title="${a.note||a.error||((weekly?'Weekly':'5-hour')+': resets in '+a.resets[weekly?1:0])}">${gauge(a)}${identity(a)}</div>`).join('')}</div><div class="reset-reveal" aria-live="polite"></div>`;return;}
frame.innerHTML=header()+rows.map(a=>`<article class="account"><div class="account-inner"><div class="account-head">${identity(a)}<span class="plan">${a.active?'<span class="active">Active</span>':''}${a.plan}</span></div>${a.error?`<div class="error">${a.error}</div>`:`<div class="account-main">${gauge(a)}<div class="limits">${a.left.map((n,i)=>`<div class="limit"><div class="values"><span>${i?'Weekly':'5 hours'}</span><span class="clock">${a.resets[i]}</span></div><div class="meter" role="meter" aria-label="${a.name} ${i?'weekly':'5-hour'} remaining" aria-valuenow="${n}" aria-valuemin="0" aria-valuemax="100"><span class="fill" style="width:${n}%;--color:${colors(n)}"></span><span class="notch" style="left:${a.clock[i]*100}%"></span><span class="meter-value">${n}%</span></div></div>`).join('')}</div></div>${details(a)}`}</div></article>`).join('');}
function revealReset(index){
  if(!compact)return;
  hoveredAccount=index;
  const row=frame.querySelector('.reset-reveal');if(!row)return;
  frame.classList.toggle('has-reset',index>=0);
  if(index<0){row.textContent='';return;}
  const a=accounts()[index],fraction=a.clock[weekly?1:0],duration=weekly?7*day:5*3600000;
  const reset=new Date(now+fraction*duration);
  row.textContent=a.error?'Usage unavailable':'Resets '+reset.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
}
frame.addEventListener('pointermove',e=>{if(!compact)return;const cell=e.target.closest('[data-account]');const next=cell?Number(cell.dataset.account):e.target.closest('.reset-reveal')?hoveredAccount:-1;if(next!==hoveredAccount)revealReset(next);});
frame.addEventListener('pointerleave',()=>revealReset(-1));
frame.addEventListener('focusin',e=>{const cell=e.target.closest('[data-account]');if(cell)revealReset(Number(cell.dataset.account));});
frame.addEventListener('focusout',e=>{if(!frame.contains(e.relatedTarget))revealReset(-1);});
frame.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;switch(b.dataset.action){case 'hourly':weekly=false;break;case 'weekly':weekly=true;break;case 'fold':compact=!compact;break;case 'pin':pinned=!pinned;break;case 'close':frame.hidden=true;return;}render();});
frame.addEventListener('dblclick',e=>{if(!e.target.closest('button')){compact=!compact;render();}});
document.querySelector('#scenario').addEventListener('change',render);
document.querySelector('#scale').addEventListener('change',e=>{frame.style.zoom=e.target.value;});
document.querySelector('#mode').addEventListener('click',()=>{compact=!compact;render();});
document.querySelector('#restore').addEventListener('click',()=>{compact=false;pinned=true;weekly=true;document.querySelector('#scenario').value='normal';document.querySelector('#scale').value='1';frame.style.zoom=1;render();});render();
