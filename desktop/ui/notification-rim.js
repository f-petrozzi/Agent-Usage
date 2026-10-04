'use strict';
// One light travels by distance on the union's actual contour. Its filter surface only grows during
// a circuit: retracting a sliver changes the vector outline, never rescales a gradient or blur texture.
const notificationRim=(()=>{
  const root=document.getElementById('root'),svg=document.createElementNS(SVG_NS,'svg');
  svg.id='notification-rim';uiMotion.attr(svg,'aria-hidden','true');uiMotion.attr(svg,'focusable','false');uiMotion.attr(svg,'hidden','');
  const tail=Array.from({length:18},(_,i)=>({lag:i*10,length:12,alpha:Math.pow(1-i/18,2)}));
  svg.innerHTML=`<defs><g id="rim-silhouette"/><path id="rim-track" pathLength="1000"/>
    <filter id="rim-halo" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="3.2"/></filter>
    <filter id="rim-soft" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".85"/></filter></defs>
    ${[['rim-halo',5,.55],['rim-soft',2.6,.65],['',1.6,1]].map(([filter,width,opacity])=>`<g ${filter?`filter="url(#${filter})"`:''} opacity="${opacity}" fill="none" stroke="var(--rim-color,#fff)" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round">${tail.map(({length,alpha},i)=>`<use href="#rim-track" class="rim-sweep" data-tail="${i}" stroke-dasharray="${length} ${1000-length}" opacity="${alpha}"/>`).join('')}</g>`).join('')}
    <use href="#rim-track" class="rim-tip" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 997"/>`;
  root.append(svg);
  const silhouette=svg.querySelector('#rim-silhouette'),track=svg.querySelector('#rim-track'),tip=svg.querySelector('.rim-tip');
  const sweeps=[...svg.querySelectorAll('.rim-sweep')],regions=[...svg.querySelectorAll('filter')],clones=new Map(),motion=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,queued=false,started=0,still=false,signature='',region=null;
  function clear(){uiMotion.cancel(frame);frame=0;queued=false;started=0;uiMotion.attr(svg,'hidden','');clones.clear();silhouette.replaceChildren();track.removeAttribute('d');signature='';region=null;}
  function geometry(){
    if(passage)return false;
    const origin=root.getBoundingClientRect(),sources=[partA,...[...slivers.values()].map(s=>s.path),...(typeof detailPath!=='undefined'?[detailPath]:[])].filter(el=>el.getAttribute('d')&&el.rimPart);
    for(const [source,clone] of clones)if(!sources.includes(source)){clone.remove();clones.delete(source);}
    const shapes=[],keys=[];
    for(const source of sources){
      const m=source.getScreenCTM();if(!m)continue;
      const matrix=[m.a,m.b,m.c,m.d,m.e-origin.left,m.f-origin.top],d=source.getAttribute('d');
      shapes.push({source,part:source.rimPart,matrix});keys.push(d,...matrix);

    }
    const next=[notchEdge,innerWidth,innerHeight,...keys].join('|');if(next===signature)return !!track.getAttribute('d');
    shapes.forEach(shape=>{
      const source=shape.source;
      let clone=clones.get(source);if(!clone){clone=document.createElementNS(SVG_NS,'path');clones.set(source,clone);silhouette.append(clone);}
      uiMotion.attr(clone,'d',source.getAttribute('d'));uiMotion.attr(clone,'transform',`matrix(${shape.matrix.join(' ')})`);
    });
    const points=rimGeometry.contour(shapes,notchEdge,innerWidth,innerHeight);if(points.length<3)return false;signature=next;
    uiMotion.attr(track,'d',points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(3)} ${y.toFixed(3)}`).join('')+'Z');
    const bounds=[Math.min(...points.map(p=>p[0]))-14,Math.min(...points.map(p=>p[1]))-14,Math.max(...points.map(p=>p[0]))+14,Math.max(...points.map(p=>p[1]))+14];
    region=region?region.map((value,i)=>i<2?Math.min(value,bounds[i]):Math.max(value,bounds[i])):bounds;
    for(const el of regions)for(const [name,value] of Object.entries({x:region[0],y:region[1],width:region[2]-region[0],height:region[3]-region[1]}))uiMotion.attr(el,name,value);
    return true;
  }
  function paint(progress){
    if(!geometry())return;
    for(const sweep of sweeps){
      const segment=tail[Number(sweep.dataset.tail)];
      sweep.style.setProperty('--rim-turn',(-90+360*progress).toFixed(2)+'deg');
      uiMotion.attr(sweep,'stroke-dasharray',still?'1000 0':`${segment.length} ${1000-segment.length}`);
      uiMotion.attr(sweep,'stroke-dashoffset',still?0:-(1000*progress-segment.lag-segment.length));
      sweep.style.display=still&&sweep.dataset.tail!=='0'?'none':'';
    }
    tip.style.display=still?'none':'';uiMotion.attr(tip,'stroke-dashoffset',-(1000*progress-3));
    svg.style.opacity=String(still?.4:smooth(progress/.065)*smooth((1-progress)/.16));
  }
  function refresh(){if(started&&!queued&&!svg.hasAttribute('hidden'))uiMotion.paint('rim-geometry',geometry,40);}
  function step(now){
    frame=0;
    if(carrying||window.agentTracking){clear();return;}
    if(!shown||root.classList.contains('placing')||openness<.9||performance.now()-shownAt<420){if(!queued){clear();return;}frame=uiMotion.frame(step);return;}
    if(!started){started=now;queued=false;svg.removeAttribute('hidden');still=motion.matches;svg.dataset.still=String(still);}
    const progress=Math.min(1,(now-started)/(still?1100:3200));uiMotion.paint('rim',()=>paint(progress),45);
    if(progress===1){clear();return;}frame=uiMotion.frame(step);
  }
  function start(colour){
    svg.style.setProperty('--rim-color',colour||INK);if(frame)return;
    queued=true;started=0;frame=uiMotion.frame(step);
  }
  motion.addEventListener('change',()=>{if(frame){still=motion.matches;svg.dataset.still=String(still);if(started)started=performance.now();}});
  return {start,clear,refresh};
})();
