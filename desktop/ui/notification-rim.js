'use strict';
// A single sweep of light around the merged black silhouette. Subtracting its eroded alpha from its
// dilated alpha keeps the border outside the notch and alert together, with no seam where they overlap.
const notificationRim=(()=>{
  const root=document.getElementById('root'),svg=document.createElementNS(SVG_NS,'svg');
  svg.id='notification-rim';svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('hidden','');
  svg.innerHTML=`<defs>
    <clipPath id="rim-screen"><rect/></clipPath>
    <filter id="rim-outline" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feMorphology in="SourceAlpha" operator="dilate" radius="1.35" result="outer"/>
      <feMorphology in="SourceAlpha" operator="erode" radius=".8" result="inner"/>
      <feComposite in="outer" in2="inner" operator="out"/>
      <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/>
    </filter>
    <mask id="rim-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" style="mask-type:alpha">
      <g filter="url(#rim-outline)"><g id="rim-silhouette" clip-path="url(#rim-screen)" fill="#fff"/></g>
    </mask>
    <filter id="rim-halo" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="rim-soft" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1.2"/></filter>
  </defs>
  ${[['rim-halo',.8],['rim-soft',.85],['',.95]].map(([filter,opacity])=>`<g ${filter?`filter="url(#${filter})"`:''} opacity="${opacity}">
    <g mask="url(#rim-mask)"><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" class="rim-sweep"></div></foreignObject></g></g>`).join('')}`;
  root.append(svg);
  const silhouette=svg.querySelector('#rim-silhouette'),screenClip=svg.querySelector('#rim-screen rect');
  const sweeps=[...svg.querySelectorAll('.rim-sweep')],foreigns=[...svg.querySelectorAll('foreignObject')];
  const regions=[...svg.querySelectorAll('filter'),svg.querySelector('mask')];
  const clones=new Map(),motion=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0,queued=false,started=0,still=false,signature='';
  function clear(){cancelAnimationFrame(frame);frame=0;queued=false;started=0;svg.setAttribute('hidden','');clones.clear();silhouette.replaceChildren();signature='';}
  function geometry(){
    const origin=root.getBoundingClientRect(),sources=[partA,partB,...[...slivers.values()].map(s=>s.path)].filter(el=>el.getAttribute('d'));
    for(const [source,clone] of clones)if(!sources.includes(source)){clone.remove();clones.delete(source);}
    let left=innerWidth,top=innerHeight,right=0,bottom=0;
    for(const source of sources){
      const matrix=source.getScreenCTM();if(!matrix)continue;
      let clone=clones.get(source);if(!clone){clone=document.createElementNS(SVG_NS,'path');clones.set(source,clone);silhouette.append(clone);}
      const d=source.getAttribute('d'),transform=`matrix(${[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e-origin.left,matrix.f-origin.top].map(n).join(' ')})`;
      if(clone.getAttribute('d')!==d)clone.setAttribute('d',d);
      if(clone.getAttribute('transform')!==transform)clone.setAttribute('transform',transform);
      const r=source.getBoundingClientRect();left=Math.min(left,r.left-origin.left);top=Math.min(top,r.top-origin.top);
      right=Math.max(right,r.right-origin.left);bottom=Math.max(bottom,r.bottom-origin.top);
    }
    // Close the perimeter just inside the bezel, rather than tracing the paths' off-screen bleed.
    left=Math.max(1,left);top=Math.max(1,top);right=Math.min(innerWidth-1,right);bottom=Math.min(innerHeight-1,bottom);
    if(right<=left||bottom<=top)return false;
    const bounds=[left,top,right-left,bottom-top].map(n),next=bounds.join(',')+','+innerWidth+','+innerHeight;
    if(signature!==next){
      signature=next;
      for(const [name,value] of Object.entries({x:1,y:1,width:innerWidth-2,height:innerHeight-2}))screenClip.setAttribute(name,value);
      for(const el of regions)for(const [name,value] of Object.entries({x:bounds[0]-18,y:bounds[1]-18,width:bounds[2]+36,height:bounds[3]+36}))el.setAttribute(name,value);
      for(const foreign of foreigns)for(const [name,value] of Object.entries({x:bounds[0]-18,y:bounds[1]-18,width:bounds[2]+36,height:bounds[3]+36}))foreign.setAttribute(name,value);
      // Draw the sweep in a square, then fit it to the live outline. An unscaled conic gradient spends
      // almost its whole turn on one long edge when the sliver closes into a thin notch. Keeping both
      // axes normalized lets the light finish all four sides while the spring changes the silhouette.
      const width=bounds[2]+36,height=bounds[3]+36,size=Math.max(width,height);
      for(const sweep of sweeps)Object.assign(sweep.style,{width:size+'px',height:size+'px',transform:`scale(${width/size},${height/size})`});
    }
    return true;
  }
  function paint(progress){
    if(!geometry())return;
    for(const sweep of sweeps)sweep.style.setProperty('--rim-turn',(-90+360*progress).toFixed(2)+'deg');
    const fade=still?.4:smooth(progress/.065)*smooth((1-progress)/.16);
    svg.style.opacity=String(fade);
  }
  function step(now){
    frame=0;
    if(carrying||window.agentTracking){clear();return;}
    // A release notice may arrive before the native window has appeared. Let its arrival finish first.
    if(!shown||root.classList.contains('placing')||openness<.9||performance.now()-shownAt<420){
      if(!queued){clear();return;}frame=requestAnimationFrame(step);return;
    }
    if(!started){started=now;queued=false;svg.removeAttribute('hidden');still=motion.matches;svg.dataset.still=String(still);}
    const duration=still?1100:3200,progress=Math.min(1,(now-started)/duration);
    paint(progress);
    if(progress===1){clear();return;}
    frame=requestAnimationFrame(step);
  }
  function start(colour){
    // Coalesce a notification burst into its current circuit; progress changes do not call this.
    svg.style.setProperty('--rim-color',colour||INK);
    if(frame)return;
    queued=true;started=0;frame=requestAnimationFrame(step);
  }
  motion.addEventListener('change',()=>{if(frame){still=motion.matches;svg.dataset.still=String(still);if(started)started=performance.now();}});
  return {start,clear};
})();
