'use strict';
function sliverFramePath({x,y,width,height}){
  const left=x+2,top=y+2,right=x+width-2,bottom=y+height-2;
  const r=Math.min(14,(right-left)/2,(bottom-top)/2),mid=(left+right)/2;
  return `M${mid} ${top}H${right-r}Q${right} ${top} ${right} ${top+r}V${bottom-r}Q${right} ${bottom} ${right-r} ${bottom}H${left+r}Q${left} ${bottom} ${left} ${bottom-r}V${top+r}Q${left} ${top} ${left+r} ${top}Z`;
}
// A persistent vector frame: progress packets may replace the sliver's text, but
// never replace this stroke or restart its transition. Geometry follows its spring.
const updateProgress=(()=>{
  const svg=document.createElementNS(SVG_NS,'svg');
  svg.id='update-progress';svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('hidden','');
  svg.innerHTML=`<path class="update-progress-track" pathLength="100"/>
    <path class="update-progress-halo" pathLength="100"/>
    <path class="update-progress-fill" pathLength="100"/>
    <path class="update-progress-tip" pathLength="100" stroke-dasharray=".8 99.2"/>`;
  document.getElementById('root').append(svg);
  const paths=[...svg.querySelectorAll('path')],fills=paths.slice(1,3),tip=paths[3];
  let shape='',fraction=-1;
  function clear(){svg.setAttribute('hidden','');}
  function draw(state,{x,y,width,height,opacity}){
    if(!['downloading','ready','installing'].includes(state.status)||width<8||height<8||opacity<=0){clear();return;}
    // Start at the top midpoint and travel clockwise, with the rounded corners
    // fully inside the sliver so no glow cuts across the notch's attachment.
    const d=sliverFramePath({x,y,width,height});
    if(d!==shape){shape=d;for(const path of paths)path.setAttribute('d',d);}
    const next=state.status==='downloading'?Math.max(0,Math.min(100,Number(state.percent)||0)):100;
    if(next!==fraction){fraction=next;for(const path of fills)path.setAttribute('stroke-dasharray',`${next} 100`);tip.setAttribute('stroke-dashoffset',-(next-.8));}
    tip.style.opacity=state.status==='downloading'&&next>0&&next<100?'1':'0';
    svg.style.opacity=String(opacity);svg.dataset.percent=String(next);svg.dataset.status=state.status;svg.removeAttribute('hidden');
  }
  return {draw,clear};
})();
