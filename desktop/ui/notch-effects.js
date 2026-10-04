'use strict';
// Bounded accents share the notch's ink. They never scale text or own hit targets.
const notchEffects=(()=>{
  const motion=matchMedia('(prefers-reduced-motion: reduce)'),effects=new Set(),pending=new Set();
  const root=document.getElementById('root'),dock={value:0,frame:0};
  let moved=false;
  function remove(effect){clearTimeout(effect.timer);effect.animation?.cancel();effect.el.remove();effects.delete(effect);}
  function accent(el,keyframes,options,owner=null){
    while(effects.size>=12)remove(effects.values().next().value);
    const effect={el,animation:el.animate(keyframes,options),timer:0,owner};effects.add(effect);
    effect.timer=setTimeout(()=>remove(effect),options.duration+(options.delay||0)+80);
    effect.animation.finished.then(()=>remove(effect)).catch(()=>{});return effect;
  }
  function clear(){
    for(const effect of [...effects])remove(effect);
    for(const wait of pending){uiMotion.cancel(wait.frame);}pending.clear();
    uiMotion.cancel(dock.frame);dock.frame=0;dock.value=0;
  }
  function dismiss(owner){
    for(const wait of [...pending])if(wait.owner===owner){uiMotion.cancel(wait.frame);pending.delete(wait);}
    for(const effect of [...effects])if(effect.owner===owner)remove(effect);
  }
  function renewals(before,after,now=Date.now()){
    const previous=new Map(before.map(a=>[a.id,a])),result=[];
    for(const account of after){
      const old=previous.get(account.id);if(old?.snap?.status!=='ok'||account.snap?.status!=='ok')continue;
      for(const next of account.snap.windows||[]){
        const first=old.snap.windows.find(w=>w.id===next.id&&w.label===next.label);
        // Corrections and moving reset estimates are not renewals. Require a just
        // crossed boundary, a new boundary and restored capacity on fresh readings.
        if(first&&Number.isFinite(first.resets_at)&&first.resets_at>0&&now>=first.resets_at&&now-first.resets_at<=120000
          &&Number.isFinite(next.resets_at)&&next.resets_at>now&&next.resets_at>first.resets_at
          &&Number.isFinite(first.used)&&Number.isFinite(next.used)&&next.used>=0&&first.used-next.used>=.01
          &&!staleOf(old.snap)&&!staleOf(account.snap))result.push({account:account.id,window:next.id});
      }
    }
    return result;
  }
  function renewed(rows){
    if(!shown||window.agentTracking||carrying||root.classList.contains('placing'))return;
    for(const id of new Set(rows.map(r=>r.account))){
      const wrap=pill.querySelector(`.cell[data-p="${CSS.escape(id)}"] .ringwrap`);if(!wrap)continue;
      const el=document.createElementNS(SVG_NS,'svg');el.setAttribute('viewBox','0 0 56 56');el.setAttribute('aria-hidden','true');el.classList.add('quota-renewal');el.dataset.account=id;
      el.innerHTML='<circle cx="28" cy="28" r="25" pathLength="100" fill="none" stroke="var(--ample)" stroke-width="3" stroke-linecap="round" stroke-dasharray="16 84"/>';
      wrap.append(el);
      accent(el,motion.matches?[{opacity:.5},{opacity:0}]:[{transform:'rotate(-90deg)',opacity:0},{transform:'rotate(10deg)',opacity:.95,offset:.25},{transform:'rotate(270deg)',opacity:0}],{duration:motion.matches?500:1050,easing:'cubic-bezier(.22,.65,.25,1)'});
    }
  }
  function merge(s,events){
    if(motion.matches||!shown||window.agentTracking||carrying)return;
    if(pending.size>=4){const old=pending.values().next().value;uiMotion.cancel(old.frame);pending.delete(old);}
    const wait={frame:0,owner:s},start=performance.now();pending.add(wait);
    const launch=()=>{
      pending.delete(wait);
      if(!s.to||!s.el.isConnected||!shown||window.agentTracking||carrying||motion.matches)return;
      if(s.t<.85&&performance.now()-start<700){pending.add(wait);wait.frame=uiMotion.frame(launch);return;}
      const end=s.el.getBoundingClientRect(),origin=root.getBoundingClientRect();
      if(!end.width||!end.height)return;
      const ids=[...new Set(events.map(e=>e.account))].slice(0,3);
      ids.forEach((id,i)=>{
        const source=pill.querySelector(`.cell[data-p="${CSS.escape(id||'')}"] .ringwrap`)?.getBoundingClientRect();if(!source)return;
        const x=source.x+source.width/2-origin.x,y=source.y+source.height/2-origin.y;
        const tx=end.x+end.width/2-origin.x,ty=end.y+end.height/2-origin.y;
        const bend=24,dx=notchEdge==='right'?-bend:notchEdge==='left'?bend:0,dy=notchEdge==='bottom'?-bend:notchEdge==='top'?bend:0;
        const el=document.createElement('div');el.className='notification-droplet';el.setAttribute('aria-hidden','true');el.dataset.account=id;
        el.style.offsetPath=`path('M${x} ${y} C${x+dx} ${y+dy} ${tx+dx} ${ty+dy} ${tx} ${ty}')`;root.append(el);
        accent(el,[{offsetDistance:'0%',transform:'scale(.5)',opacity:0},{offsetDistance:'25%',transform:'scale(1.25,.85)',opacity:.9,offset:.25},
          {offsetDistance:'75%',transform:'scale(.85,1.1)',opacity:1,offset:.72},{offsetDistance:'100%',transform:'scale(.12)',opacity:0}],{duration:620,delay:i*65,easing:'cubic-bezier(.22,.7,.2,1)',fill:'backwards'},s);
      });
    };
    wait.frame=uiMotion.frame(launch);
  }
  function dockRelease(){
    if(!moved)return;moved=false;uiMotion.cancel(dock.frame);dock.frame=0;dock.value=0;
    if(motion.matches||!shown||root.classList.contains('placing'))return;
    const started=performance.now();
    const step=now=>{
      const t=Math.min(1,(now-started)/680);
      dock.value=t===1?0:9*Math.sin(t*Math.PI*2)*Math.exp(-3.8*t);drawShape();
      dock.frame=t===1?0:uiMotion.frame(step);
    };
    dock.frame=uiMotion.frame(step);
  }
  for(const name of ['edge_cursor','move_begin'])listen(name,()=>{moved=true;clear();}).catch(()=>{});
  listen('release',dockRelease).catch(()=>{});
  for(const name of ['disappear','monitor_stow'])listen(name,()=>{moved=false;clear();}).catch(()=>{});
  motion.addEventListener('change',()=>{clear();drawShape();});
  return {renewals,renewed,merge,dismiss,clear,dock};
})();
