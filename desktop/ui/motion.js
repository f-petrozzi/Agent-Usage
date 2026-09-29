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
/* Carried round a corner, each ring (and the pin/refresh row) keeps its offset from the notch's middle along
   the border, clockwise, and follows a line half the notch's depth in that takes the corner on one cubic
   rather than stepping across it (the Mac's ringPoint). Where the two edges lay the rings out in opposite
   orders (bottom-right and top-left), they dip out mid-bend instead of passing through each other. */
const HEADING={top:[1,0],right:[0,1],bottom:[-1,0],left:[0,-1]}, CLOCKWISE={top:1,right:1,bottom:-1,left:-1};
function trackPoint(t){
  const w=innerWidth,h=innerHeight,total=2*(w+h),d=35,round=1.6*d;
  const inset=t=>{ t=((t%total)+total)%total;
    if(t<w) return [t,d]; if(t<w+h) return [w-d,t-w]; if(t<2*w+h) return [2*w+h-t,h-d]; return [d,total-t]; };
  for(const [at0,first,second] of [[w,'top','right'],[w+h,'right','bottom'],[2*w+h,'bottom','left'],[0,'left','top']]){
    let off=((t-at0)%total+total)%total; if(off>total/2) off-=total;
    if(Math.abs(off)>=round) continue;
    const a=inset(at0-round), b=inset(at0+round), da=HEADING[first], db=HEADING[second], k=(round-d)*.8, u=(off+round)/(2*round), v=1-u;
    const c1=[a[0]+da[0]*k,a[1]+da[1]*k], c2=[b[0]-db[0]*k,b[1]-db[1]*k];
    return [0,1].map(i=>v*v*v*a[i]+3*v*v*u*c1[i]+3*v*u*u*c2[i]+u*u*u*b[i]);
  }
  return inset(t);
}
let carriedRound=false;
function carryItems(pass,px,py,vertical,L){
  const items=[...pill.querySelectorAll('.cell,.ctl')], root=document.getElementById('root');
  if(!pass){
    if(carriedRound){ for(const el of items){ el.style.transform=''; el.style.removeProperty('--bend'); } root.style.setProperty('--cross','0'); carriedRound=false; }
    return;
  }
  carriedRound=true;
  const w=innerWidth,h=innerHeight,total=2*(w+h), cornerAt={tr:w,br:w+h,bl:2*w+h,tl:0}[pass.corner];
  const p=pass.after/(pass.before+pass.after), mix=p*p*(3-2*p), s1=CLOCKWISE[pass.first], s2=CLOCKWISE[pass.second];
  root.style.setProperty('--cross',(s1===s2?0:clamp(1-Math.abs(1-2*p)*2.2,0,1)).toFixed(3));
  for(const el of items){
    el.style.transform='';
    const cx=px+el.offsetLeft+el.offsetWidth/2, cy=py+el.offsetTop+el.offsetHeight/2;
    const a=(vertical?el.offsetTop+el.offsetHeight/2:el.offsetLeft+el.offsetWidth/2)-L/2;
    const t=position+(s1+(s2-s1)*mix)*a, [tx,ty]=trackPoint(t);
    el.style.transform=`translate(${(tx-cx).toFixed(1)}px,${(ty-cy).toFixed(1)}px)`;
    // The line in from the border is shorter round the bend than the border, so rings would crowd there:
    // each goes through the bend inside the black instead, fading out and back as it passes the corner
    let off=((t-cornerAt)%total+total)%total; if(off>total/2) off-=total;
    const f=clamp((Math.abs(off)-30)/50,0,1); el.style.setProperty('--bend',(1-f*f*(3-2*f)).toFixed(3));
  }
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
  const vertical=edge==='left'||edge==='right';
  const L=vertical?ph:pw, len=vertical?h:w, at=vertical?y:x;
  /* A corner being rounded: the notch's middle within half its length of one. It is drawn there as two
     parts running together (shape.js), and the rings are carried round the corner on a curve. At rest it
     never sits here (restingAlong); only while the shortcut carries it round. */
  let pass=null;
  for(const [corner,at0,first,second] of [['tr',w,'top','right'],['br',w+h,'right','bottom'],['bl',2*w+h,'bottom','left'],['tl',0,'left','top']]){
    let d=((at0-position)%total+total)%total; if(d>total/2) d-=total;
    if(Math.abs(d)<L/2){ pass={corner,first,second,before:d+L/2,after:L/2-d}; break; }
  }
  // The handles and arms step back as the notch's end nears a corner, where they would leave the screen
  const reach=Math.min(at,len-at), near=pass?1:clamp(1-(reach-L/2)/CORNER,0,1);
  const start=pass?clamp(at-L/2,0,len-L):at-L/2;
  const along=pixel(start), across=vertical?(edge==='left'?0:w-pw):(edge==='top'?0:h-ph);
  const px=vertical?across:along, py=vertical?along:across;
  pill.style.left='0';pill.style.top='0';pill.style.right='auto';pill.style.bottom='auto';
  pill.style.transform=`translate(${px}px,${py}px)`;
  setShapePassage(pass,near,pill.style.transform);drawShape();
  carryItems(pass,px,py,vertical,L);
  const root=document.getElementById('root');
  root.style.setProperty('--hf',near.toFixed(3));
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
