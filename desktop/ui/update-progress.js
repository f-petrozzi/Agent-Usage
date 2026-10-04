'use strict';
// Progress and notification countdowns share the real exposed ink boundary.
// Cache per source path; changing the timer or percentage leaves geometry alone.
const sliverContour=(()=>{
  const cache=new WeakMap();
  return path=>{
    if(passage||!path?.getAttribute('d'))return '';
    const origin=document.getElementById('root').getBoundingClientRect(),sources=[partA,path],shapes=[],keys=[];
    for(const source of sources){
      const m=source.getScreenCTM();if(!m||!source.rimPart)return '';
      const matrix=[m.a,m.b,m.c,m.d,m.e-origin.left,m.f-origin.top];
      shapes.push({part:source.rimPart,matrix});keys.push(...source.rimPart,...matrix);
    }
    const signature=[innerWidth,innerHeight,...keys].join('|'),previous=cache.get(path);
    if(signature===previous?.signature)return previous.d;
    let end=null;
    const d=rimGeometry.exposed(shapes,1,innerWidth,innerHeight).map(([a,b])=>{
      const connected=end&&Math.hypot(a[0]-end[0],a[1]-end[1])<.001;
      end=b;return `${connected?'':`M${a[0].toFixed(3)} ${a[1].toFixed(3)}`}L${b[0].toFixed(3)} ${b[1].toFixed(3)}`;
    }).join('');
    cache.set(path,{signature,d});return d;
  };
})();
// Persistent light on the sliver's exposed ink boundary. The notch union removes
// its attachment seam; progress packets never replace or restart the stroke.
const updateProgress=(()=>{
  const svg=document.createElementNS(SVG_NS,'svg');
  svg.id='update-progress';uiMotion.attr(svg,'aria-hidden','true');uiMotion.attr(svg,'focusable','false');uiMotion.attr(svg,'hidden','');
  svg.innerHTML=`<path class="update-progress-track" pathLength="100"/>
    <path class="update-progress-halo" pathLength="100"/>
    <path class="update-progress-fill" pathLength="100"/>
    <path class="update-progress-tip" pathLength="100" stroke-dasharray=".8 99.2"/>`;
  document.getElementById('root').append(svg);
  const paths=[...svg.querySelectorAll('path')],fills=paths.slice(1,3),tip=paths[3];
  let shape='',fraction=-1;
  function clear(){uiMotion.attr(svg,'hidden','');}
  function draw(state,{path,opacity}){
    if(!['downloading','ready','installing'].includes(state.status)||opacity<=0||passage||!path?.getAttribute('d')){clear();return;}
    const d=sliverContour(path);if(!d){clear();return;}
    if(d!==shape){shape=d;for(const p of paths)uiMotion.attr(p,'d',d);}
    const next=state.status==='downloading'?Math.max(0,Math.min(100,Number(state.percent)||0)):100;
    if(next!==fraction){fraction=next;for(const path of fills)uiMotion.attr(path,'stroke-dasharray',`${next} 100`);uiMotion.attr(tip,'stroke-dashoffset',-(next-.8));}
    tip.style.opacity=state.status==='downloading'&&next>0&&next<100?'1':'0';
    svg.style.opacity=String(opacity);svg.dataset.percent=String(next);svg.dataset.status=state.status;svg.removeAttribute('hidden');
  }
  return {draw,clear};
})();
