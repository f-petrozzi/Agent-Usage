'use strict';
function sliverFramePath({x,y,width,height}){
  const left=x+2,top=y+2,right=x+width-2,bottom=y+height-2;
  const r=Math.min(14,(right-left)/2,(bottom-top)/2),mid=(left+right)/2;
  return `M${mid} ${top}H${right-r}Q${right} ${top} ${right} ${top+r}V${bottom-r}Q${right} ${bottom} ${right-r} ${bottom}H${left+r}Q${left} ${bottom} ${left} ${bottom-r}V${top+r}Q${left} ${top} ${left+r} ${top}Z`;
}
// Persistent light on the sliver's exposed ink boundary. The notch union removes
// its attachment seam; progress packets never replace or restart the stroke.
const updateProgress=(()=>{
  const svg=document.createElementNS(SVG_NS,'svg');
  svg.id='update-progress';svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');svg.setAttribute('hidden','');
  svg.innerHTML=`<path class="update-progress-track" pathLength="100"/>
    <path class="update-progress-halo" pathLength="100"/>
    <path class="update-progress-fill" pathLength="100"/>
    <path class="update-progress-tip" pathLength="100" stroke-dasharray=".8 99.2"/>`;
  document.getElementById('root').append(svg);
  const paths=[...svg.querySelectorAll('path')],fills=paths.slice(1,3),tip=paths[3];
  let shape='',signature='',fraction=-1;
  function clear(){svg.setAttribute('hidden','');signature='';}
  function draw(state,{path,opacity}){
    if(!['downloading','ready','installing'].includes(state.status)||opacity<=0||passage||!path?.getAttribute('d')){clear();return;}
    const origin=document.getElementById('root').getBoundingClientRect(),sources=[partA,path],shapes=[],keys=[];
    for(const source of sources){
      const m=source.getScreenCTM();if(!m||!source.rimPart){clear();return;}
      const matrix=[m.a,m.b,m.c,m.d,m.e-origin.left,m.f-origin.top];
      shapes.push({part:source.rimPart,matrix});keys.push(...source.rimPart,...matrix);
    }
    const nextShape=[innerWidth,innerHeight,...keys].join('|');
    if(nextShape!==signature){
      const segments=rimGeometry.exposed(shapes,1,innerWidth,innerHeight);
      if(!segments.length){clear();return;}
      let previous=null;
      const d=segments.map(([a,b])=>{
        const connected=previous&&Math.hypot(a[0]-previous[0],a[1]-previous[1])<.001;
        previous=b;return `${connected?'':`M${a[0].toFixed(3)} ${a[1].toFixed(3)}`}L${b[0].toFixed(3)} ${b[1].toFixed(3)}`;
      }).join('');
      signature=nextShape;
      if(d!==shape){shape=d;for(const p of paths)p.setAttribute('d',d);}
    }
    const next=state.status==='downloading'?Math.max(0,Math.min(100,Number(state.percent)||0)):100;
    if(next!==fraction){fraction=next;for(const path of fills)path.setAttribute('stroke-dasharray',`${next} 100`);tip.setAttribute('stroke-dashoffset',-(next-.8));}
    tip.style.opacity=state.status==='downloading'&&next>0&&next<100?'1':'0';
    svg.style.opacity=String(opacity);svg.dataset.percent=String(next);svg.dataset.status=state.status;svg.removeAttribute('hidden');
  }
  return {draw,clear};
})();
