/* Shared account-card live sessions: one-line names, accessible states and visibility-gated working arcs. */
'use strict';
const workingSessionVisibility=new IntersectionObserver(entries=>{
  for(const entry of entries)entry.target.classList.toggle('is-visible',entry.isIntersecting);
});
function settleWorkingSessions(account,rows){
  if(document.hidden||matchMedia('(prefers-reduced-motion: reduce)').matches
    ||!document.querySelector('#root.visible #card.show')||document.getElementById('card').dataset.account!==account.id)return;
  const busy=new Set(rows.filter(row=>row.state==='busy').map(row=>workingSessionKey(account,row)));
  for(const mark of document.querySelectorAll('#card .s-working.is-visible')){
    if(busy.has(mark.dataset.workingSession))continue;
    const box=mark.getBoundingClientRect(),angle=getComputedStyle(mark,'::after').transform;
    queueMicrotask(()=>{
      const previous=document.querySelectorAll('.s-working-exit');if(previous.length>=6)previous[0].remove();
      const ghost=document.createElement('span');ghost.className='s-working s-working-exit';ghost.setAttribute('aria-hidden','true');
      Object.assign(ghost.style,{left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
      ghost.style.setProperty('--working-exit-angle',angle);document.body.append(ghost);
      ghost.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(.85)'}],{duration:160,easing:'ease-out'})
        .finished.then(()=>ghost.remove(),()=>ghost.remove());
    });
  }
}
function workingSessionKey(account,row){return encodeURIComponent(JSON.stringify([account.id,row.id||row.name]));}
function renderWorkingSessions(account){
  const rows=activity.filter(a=>a.account===account.id)
    .sort((a,b)=>(b.state==='waiting')-(a.state==='waiting')||b.since-a.since);
  settleWorkingSessions(account,rows);
  // Card reconciliation replaces these bounded rows. Release old targets before observing the new ones.
  queueMicrotask(()=>{
    workingSessionVisibility.disconnect();
    for(const mark of document.querySelectorAll('#card .s-working'))workingSessionVisibility.observe(mark);
  });
  if(!rows.length)return '';
  return '<div class="c-sessions">'+rows.slice(0,SESSION_ROWS).map(row=>{
    const waiting=row.state==='waiting',state=textCopy(waiting?'Waiting':'Working');
    const name=row.name||textCopy('Chat'),label=esc(name+', '+state).replace(/"/g,'&quot;');
    const linked=row.id&&row.sessionId&&['claude','codex','antigravity'].includes(row.provider);
    const tag=linked?'button':'div',attrs=linked
      ?` type="button" data-session="${esc(row.id)}" data-account="${esc(row.account)}"`
      :' role="group"';
    const mark=waiting?`<span class="s-dot" style="background:${WATCH}" aria-hidden="true"></span>`
      :`<span class="s-working" data-working-session="${workingSessionKey(account,row)}" aria-hidden="true"></span>`;
    return `<${tag}${attrs} class="s-row${linked?' session-link':''}" aria-label="${label}" title="${label}"><span class="s-name">${esc(name)}</span>${mark}</${tag}>`;
  }).join('')+moreRow(rows.length-SESSION_ROWS)+'</div>';
}
