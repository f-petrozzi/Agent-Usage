'use strict';
// Perimeter travel takes the shortest route along the screen edges, including corners.
// All coordinates here are CSS pixels; the main process converts hit regions to DIPs.
let layout={scale:1,edge:'right',along:.5}, target=0, position=null, frame=0, last=0;
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
// The handles sit a fillet past each end of the pill (38.7 + their 28.5 reach), so it stops short of the corners
const CORNER=68;
function perimeterAt(edge,along){
  const w=innerWidth,h=innerHeight;
  return edge==='top'?along*w:edge==='right'?w+along*h:edge==='bottom'?w+h+(1-along)*w:2*w+h+(1-along)*h;
}
// Where the notch may rest: its whole length clear of the corner zone, so it never settles squeezed.
// While the shortcut is held it follows the pointer into the corners and squeezes through them.
function restingAlong(edge,along){
  if(window.agentTracking) return clamp(along,0,1);
  const len=edge==='top'||edge==='bottom'?innerWidth:innerHeight, L=Math.max(pill.offsetWidth,pill.offsetHeight);
  const m=Math.min(.5,(L/2+CORNER)/len);
  return clamp(along,m,1-m);
}
function aim(edge,along,snap=false){
  target=perimeterAt(edge,restingAlong(edge,along));
  if(position===null||snap) position=target;
  if(!frame) frame=requestAnimationFrame(animate);
}
function animate(now){
  frame=0;
  const w=innerWidth,h=innerHeight,total=2*(w+h), dt=Math.min(40,now-(last||now-16));last=now;
  let delta=((target-position+total*1.5)%total)-total/2;
  position=(position+(reduced.matches?delta:delta*(1-Math.exp(-dt/65)))+total)%total;
  if(Math.abs(delta)<.3) position=target;
  let edge,x,y;
  if(position<w){edge='top';x=position;y=0;}
  else if(position<w+h){edge='right';x=w;y=position-w;}
  else if(position<2*w+h){edge='bottom';x=2*w+h-position;y=h;}
  else{edge='left';x=0;y=total-position;}
  const edgeChanged=edge!==notchEdge;
  applyEdge(edge);if(edgeChanged)renderRing();
  const pw=pill.offsetWidth,ph=pill.offsetHeight;
  // Snap settled text to physical pixels. Layout itself is never rotated or raster-scaled.
  const pixel=v=>Math.abs(delta)>.3?v:Math.round(v*devicePixelRatio)/devicePixelRatio;
  /* Rounding a corner: within reach of it the notch shortens and slides into it, until it is a D×D cap in
     the corner itself. That cap is the same shape on both edges, so the edge changes inside it instead of
     the notch jumping from one edge to the other. */
  const vertical=edge==='left'||edge==='right';
  const L=vertical?ph:pw, D=vertical?pw:ph, len=vertical?h:w, at=vertical?y:x;
  const zone=L/2+CORNER, reach=Math.min(at,len-at);
  const squeeze=zone>D/2?clamp((zone-reach)/(zone-D/2),0,1):0;
  const Ls=L-(L-D)*squeeze;
  const start=squeeze>0?(at<len/2?CORNER*(1-squeeze):len-CORNER*(1-squeeze)-Ls):clamp(at-L/2,CORNER,len-L-CORNER);
  const along=pixel(start+Ls/2-L/2), across=vertical?(edge==='left'?0:w-pw):(edge==='top'?0:h-ph);
  const px=vertical?across:along, py=vertical?along:across;
  pill.style.left='0';pill.style.top='0';pill.style.right='auto';pill.style.bottom='auto';
  pill.style.transform=shapeSvg.style.transform=`translate(${px}px,${py}px)`;
  // The box keeps its length; the outline is drawn Ls long within it, closing up into the corner (shape.js)
  setShapeSqueeze(Ls,at<len/2,squeeze);drawShape();
  document.getElementById('root').style.setProperty('--sq',squeeze.toFixed(3));
  if(card.classList.contains('show')) placeCard();
  reportHot();
  if(Math.abs(delta)>.3) frame=requestAnimationFrame(animate);else last=0;
}
function loadAccounts(value){agentAccounts=value||[];renderRing();if(card.classList.contains('show'))renderCard();aim(layout.edge,layout.along);}
window.agentUsage.on('agent_accounts',loadAccounts);
invoke('get_agent_accounts').then(loadAccounts).catch(e=>notice(String(e)));
window.agentUsage.on('layout',value=>{
  layout=value;window.agentTracking=value.tracking;
  const appearing=!!value.visible&&!shown; // arrives just before `appear`: place it now, never glide in from where it was hidden
  aim(value.edge,value.along,position===null||appearing);setShown(!!value.visible,value.edge);
});
window.agentUsage.on('edge_cursor',value=>{
  window.agentTracking=true;layout.edge=value.edge;
  layout.along=['top','bottom'].includes(value.edge)?value.x/layout.scale/innerWidth:value.y/layout.scale/innerHeight;
  hideCard();aim(value.edge,layout.along);
});
window.agentUsage.on('appear',()=>{position=null;setShown(true,layout.edge);aim(layout.edge,layout.along,true);requestAnimationFrame(()=>{for(const p of providers())turnReading(p.id,true);});});
window.agentUsage.on('disappear',()=>{hideCard();setShown(false);});
window.agentUsage.on('release',()=>{window.agentTracking=false;aim(layout.edge,layout.along);});
window.addEventListener('resize',()=>aim(layout.edge,layout.along,true));
// Keep an arbitrary number of accounts accessible without clipping the screen.
let accountOffset=0;
const originalProviders=providers;
providers=function(){const all=originalProviders();const capacity=Math.max(1,Math.floor((edgeIsVertical()?innerHeight-150:innerWidth-150)/90));accountOffset=Math.min(accountOffset,Math.max(0,all.length-capacity));return all.slice(accountOffset,accountOffset+capacity);};
pill.addEventListener('wheel',event=>{event.preventDefault();accountOffset=Math.max(0,accountOffset+Math.sign(event.deltaY));hideCard();renderRing();aim(layout.edge,layout.along);},{passive:false});
invoke('ready').catch(e=>notice(String(e)));
