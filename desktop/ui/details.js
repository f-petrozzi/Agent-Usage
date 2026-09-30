'use strict';
// Account details deepen and widen the notch itself, retaining its edge flares.
// Its ink grows first; readable HTML follows once there is black underneath it.
const detailSvg=document.createElementNS(SVG_NS,'svg');
detailSvg.id='detail-shape';detailSvg.setAttribute('aria-hidden','true');
const detailPath=document.createElementNS(SVG_NS,'path');detailSvg.append(detailPath);pill.before(detailSvg);
let detailOpen=0,detailVelocity=0,detailFrame=0,detailLast=0,detailTarget=0;
let detailBox=null,detailAim=null;
let detailReading=1;

function changeDetailAccount(){
  detailReading=reducedDetails()?1:0;card.style.setProperty('--detail-reading',detailReading);
  if(!detailFrame)detailFrame=requestAnimationFrame(detailStep);
}

function detailGeometry(){
  const origin=document.getElementById('root').getBoundingClientRect(),r=pill.getBoundingClientRect();
  const horizontal=!edgeIsVertical(),box={x:card.offsetLeft,y:card.offsetTop,w:card.offsetWidth,h:card.offsetHeight};
  const matrix=edgeMatrix(notchEdge,innerWidth,innerHeight);
  // Invert the edge's orthogonal matrix; these are root-local coordinates, so the hide slide cancels.
  const local=(x,y)=>[matrix[0]*(x-matrix[4])+matrix[1]*(y-matrix[5]),matrix[2]*(x-matrix[4])+matrix[3]*(y-matrix[5])];
  const a=local(box.x,box.y),b=local(box.x+box.w,box.y+box.h);
  const along=horizontal?r.left-origin.left:r.top-origin.top,length=horizontal?r.width:r.height;
  return {u0:Math.min(a[0],b[0]),u1:Math.max(a[0],b[0]),v0:Math.min(a[1],b[1]),v1:Math.max(a[1],b[1]),
    a0:along,a1:along+length,depth:edgeDepth(notchEdge),edge:notchEdge};
}
function drawDetails(){
  drawShape(); // The arms merge home as the widened flares grow around them.
  if(!detailBox||detailOpen<.001){detailPath.removeAttribute('d');return;}
  detailSvg.setAttribute('width',innerWidth);detailSvg.setAttribute('height',innerHeight);
  detailPath.setAttribute('transform',`matrix(${edgeMatrix(detailBox.edge,innerWidth,innerHeight).join(' ')})`);
  const {a0,a1,depth}=detailBox,t=Math.max(0,detailOpen);
  const matrix=edgeMatrix(detailBox.edge,innerWidth,innerHeight);
  const point=(u,v)=>[matrix[0]*u+matrix[2]*v+matrix[4],matrix[1]*u+matrix[3]*v+matrix[5]];
  const first=point(detailBox.u0,detailBox.v0),last=point(detailBox.u1,detailBox.v1);
  card.style.setProperty('--detail-offset-x',`${Math.min(first[0],last[0])-card.offsetLeft}px`);
  card.style.setProperty('--detail-offset-y',`${Math.min(first[1],last[1])-card.offsetTop}px`);
  const u0=a0+(Math.min(a0,detailBox.u0)-a0)*t;
  const u1=a1+(Math.max(a1,detailBox.u1)-a1)*t;
  const expandedDepth=depth+(detailBox.v1-depth)*t;
  // One outline starts at the bezel, grows around the readings, and returns to the bezel.
  // There is no second rectangle or narrow connector beneath the original notch.
  const radius=SHAPE.corner+(26-SHAPE.corner)*Math.min(1,t);
  detailPath.setAttribute('d',partPath(u0,u1,expandedDepth,radius,SHAPE.flare,radius,SHAPE.flare));
}
// Hit testing follows the same live outline, including the new space beside the gauges.
function detailHotRect(){
  if(!detailPath.hasAttribute('d'))return null;
  const b=detailPath.getBBox(),m=detailPath.getScreenCTM();
  const points=[new DOMPoint(b.x,b.y),new DOMPoint(b.x+b.width,b.y+b.height)].map(p=>p.matrixTransform(m));
  const x=Math.max(0,Math.min(...points.map(p=>p.x))),y=Math.max(0,Math.min(...points.map(p=>p.y)));
  const right=Math.min(innerWidth,Math.max(...points.map(p=>p.x))),bottom=Math.min(innerHeight,Math.max(...points.map(p=>p.y)));
  return [x,y,right-x,bottom-y];
}
function detailContains(x,y){
  if(!detailPath.hasAttribute('d'))return false;
  return detailPath.isPointInFill(new DOMPoint(x,y).matrixTransform(detailPath.getScreenCTM().inverse()));
}
function detailStep(now){
  const dt=Math.min(.032,(now-(detailLast||now-16))/1000);detailLast=now;
  const omega=2*Math.PI/(detailTarget?.62:.38),damping=detailTarget?.78:1;
  detailVelocity+=(-omega*omega*(detailOpen-detailTarget)-2*damping*omega*detailVelocity)*dt;
  detailOpen+=detailVelocity*dt;
  let settled=Math.abs(detailOpen-detailTarget)<.002&&Math.abs(detailVelocity)<.025;
  if(settled){detailOpen=detailTarget;detailVelocity=0;}
  if(detailAim){
    const mix=1-Math.exp(-dt/.075);
    for(const key of ['u0','u1','v0','v1','a0','a1']){
      detailBox[key]+=(detailAim[key]-detailBox[key])*mix;
      if(Math.abs(detailBox[key]-detailAim[key])>.1)settled=false;
    }
  }
  detailReading=Math.min(1,detailReading+dt/.22);card.style.setProperty('--detail-reading',detailReading);
  if(detailReading<1)settled=false;
  card.style.setProperty('--detail-open',Math.max(0,detailOpen));drawDetails();reportHot();
  if(!settled){detailFrame=requestAnimationFrame(detailStep);return;}
  detailFrame=0;detailLast=0;
  if(!detailTarget)card.classList.remove('closing');
}
function syncDetails(){
  if(!card.classList.contains('show'))return;
  detailAim=detailGeometry();
  if(!detailBox||detailBox.edge!==detailAim.edge)detailBox={...detailAim};
  if(reducedDetails()){
    detailBox={...detailAim};drawDetails();return;
  }
  if(!detailFrame)detailFrame=requestAnimationFrame(detailStep);
}
function reducedDetails(){return matchMedia('(prefers-reduced-motion: reduce)').matches;}
function setDetailsShown(on,instant=false){
  detailTarget=on?1:0;
  if(on)syncDetails();
  if(instant||reducedDetails()){
    cancelAnimationFrame(detailFrame);detailFrame=0;detailLast=0;detailVelocity=0;detailOpen=detailTarget;
    card.style.setProperty('--detail-open',detailOpen);drawDetails();
    if(!on)card.classList.remove('closing');return;
  }
  if(!detailFrame)detailFrame=requestAnimationFrame(detailStep);
}
