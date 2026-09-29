'use strict';
// Account details are a lobe of the notch, with broad concave shoulders instead of a tooltip point.
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
  const cell=pill.querySelector(`.cell[data-p="${hoverId}"] .ringwrap`)||pill,ring=cell.getBoundingClientRect();
  const horizontal=!edgeIsVertical(),box={x:card.offsetLeft,y:card.offsetTop,w:card.offsetWidth,h:card.offsetHeight};
  const matrix=edgeMatrix(notchEdge,innerWidth,innerHeight);
  // Invert the edge's orthogonal matrix; these are root-local coordinates, so the hide slide cancels.
  const local=(x,y)=>[matrix[0]*(x-matrix[4])+matrix[1]*(y-matrix[5]),matrix[2]*(x-matrix[4])+matrix[3]*(y-matrix[5])];
  const a=local(box.x,box.y),b=local(box.x+box.w,box.y+box.h);
  const centre=local(ring.x-origin.x+ring.width/2,ring.y-origin.y+ring.height/2)[0];
  const along=horizontal?r.left-origin.left:r.top-origin.top,length=horizontal?r.width:r.height;
  return {u0:Math.min(a[0],b[0]),u1:Math.max(a[0],b[0]),v0:Math.min(a[1],b[1]),v1:Math.max(a[1],b[1]),
    a0:Math.max(along+12,centre-46),a1:Math.min(along+length-12,centre+46),depth:edgeDepth(notchEdge),edge:notchEdge};
}
function drawDetails(){
  if(!detailBox||detailOpen<.001){detailPath.removeAttribute('d');return;}
  detailSvg.setAttribute('width',innerWidth);detailSvg.setAttribute('height',innerHeight);
  detailPath.setAttribute('transform',`matrix(${edgeMatrix(detailBox.edge,innerWidth,innerHeight).join(' ')})`);
  const {a0,a1,depth}=detailBox,t=Math.max(0,detailOpen),mid=(a0+a1)/2;
  const matrix=edgeMatrix(detailBox.edge,innerWidth,innerHeight);
  const point=(u,v)=>[matrix[0]*u+matrix[2]*v+matrix[4],matrix[1]*u+matrix[3]*v+matrix[5]];
  const first=point(detailBox.u0,detailBox.v0),last=point(detailBox.u1,detailBox.v1);
  card.style.setProperty('--detail-offset-x',`${Math.min(first[0],last[0])-card.offsetLeft}px`);
  card.style.setProperty('--detail-offset-y',`${Math.min(first[1],last[1])-card.offsetTop}px`);
  const u0=mid+(detailBox.u0-mid)*Math.min(1,t),u1=mid+(detailBox.u1-mid)*Math.min(1,t);
  const v0=depth+(detailBox.v0-depth)*t,v1=depth+(detailBox.v1-depth)*t;
  const radius=Math.min(26,(u1-u0)/2,Math.max(0,(v1-depth)/2)),base=depth-8;
  const shoulder=v0+radius;
  detailPath.setAttribute('d',`M${n(a0)} ${n(base)}C${n(a0)} ${n(shoulder)} ${n(u0)} ${n(v0-radius)} ${n(u0)} ${n(shoulder)}`
    +`V${n(v1-radius)}Q${n(u0)} ${n(v1)} ${n(u0+radius)} ${n(v1)}H${n(u1-radius)}Q${n(u1)} ${n(v1)} ${n(u1)} ${n(v1-radius)}`
    +`V${n(shoulder)}C${n(u1)} ${n(v0-radius)} ${n(a1)} ${n(shoulder)} ${n(a1)} ${n(base)}Z`);
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
