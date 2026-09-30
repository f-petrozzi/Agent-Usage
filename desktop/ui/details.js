'use strict';
// Account details deepen and widen the notch itself, retaining its edge flares.
// Its ink grows first; readable HTML follows once there is black underneath it.
const detailSvg=document.createElementNS(SVG_NS,'svg');
detailSvg.id='detail-shape';detailSvg.setAttribute('aria-hidden','true');
const detailPath=document.createElementNS(SVG_NS,'path');detailSvg.append(detailPath);pill.before(detailSvg);
let detailOpen=0,detailVelocity=0,detailFrame=0,detailLast=0,detailTarget=0;
let detailBox=null,detailAim=null;
let detailReading=1;
let detailArm=0,detailArmVelocity=0;
function changeDetailAccount(){
  setExtraShown(false,true);
  if(!reducedDetails())detailVelocity-=1.1;
  detailReading=reducedDetails()?1:.65;card.style.setProperty('--detail-reading',detailReading);
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
  const spread=t*smooth(Math.max(0,Math.min(1,detailArm)));
  const u0=a0+(Math.min(a0,detailBox.u0)-a0)*spread;
  const u1=a1+(Math.max(a1,detailBox.u1)-a1)*spread;
  const expandedDepth=depth+(detailBox.v1-depth)*t;
  // One outline starts at the bezel, grows around the readings, and returns to the bezel.
  // There is no second rectangle or narrow connector beneath the original notch.
  const radius=SHAPE.corner+(26-SHAPE.corner)*Math.min(1,t);
  detailPath.setAttribute('d',partPath(u0,u1,expandedDepth,radius,handleMetrics().flare,radius,handleMetrics().flare));
  if(typeof extraTarget==='number'&&extraTarget)placeExtraCard();
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
  const omega=2*Math.PI/(detailTarget?.74:.38),damping=detailTarget?.78:1;
  detailVelocity+=(-omega*omega*(detailOpen-detailTarget)-2*damping*omega*detailVelocity)*dt;
  detailOpen+=detailVelocity*dt;
  let settled=Math.abs(detailOpen-detailTarget)<.002&&Math.abs(detailVelocity)<.025;
  if(settled){detailOpen=detailTarget;detailVelocity=0;}
  const spring=(value,velocity,target,frequency,damping)=>{
    velocity+=(-frequency*frequency*(value-target)-2*damping*frequency*velocity)*dt;
    value+=velocity*dt;
    if(Math.abs(value-target)<.001&&Math.abs(velocity)<.015)return [target,0];
    settled=false;return [value,velocity];
  };
  [detailArm,detailArmVelocity]=spring(detailArm,detailArmVelocity,detailTarget,8,.86);
  if(detailAim){
    const mix=1-Math.exp(-dt/.075);
    for(const key of ['u0','u1','v0','v1','a0','a1']){
      detailBox[key]+=(detailAim[key]-detailBox[key])*mix;
      if(Math.abs(detailBox[key]-detailAim[key])>.1)settled=false;
    }
  }
  detailReading=Math.min(1,detailReading+dt/.12);card.style.setProperty('--detail-reading',detailReading);
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
  syncAccountFocus(on);
  if(on)syncDetails();
  if(instant||reducedDetails()){
    cancelAnimationFrame(detailFrame);detailFrame=0;detailLast=0;detailVelocity=0;detailOpen=detailTarget;detailArm=detailTarget;detailArmVelocity=0;
    card.style.setProperty('--detail-open',detailOpen);drawDetails();
    if(!on)card.classList.remove('closing');return;
  }
  if(!detailFrame)detailFrame=requestAnimationFrame(detailStep);
}

// Account metadata and secondary model quotas unfold as their own frame; it never changes the main notch outline.
const extraCard=document.createElement('div');extraCard.id='extra-card';extraCard.setAttribute('aria-hidden','true');
card.parentElement.append(extraCard);
const extraPath=document.createElementNS(SVG_NS,'path');detailSvg.append(extraPath);
detailSvg.insertAdjacentHTML('afterbegin',`<defs>${gooDefinition('extra-goo')}</defs>`);
const extraFilter=detailSvg.querySelector('#extra-goo');
let extraOpen=0,extraTarget=0,extraVelocity=0,extraFrame=0,extraLast=0;
function setExtraContent(rows,windows=[]){
  extraCard.innerHTML=rows.map(row=>`<div class="extra-row">${esc(row)}</div>`).join('')+renderUsageWindows(windows);
  if(!rows.length&&!windows.length)setExtraShown(false,true);
  placeExtraCard();
}
function placeExtraCard(){
  const gap=12,origin=document.getElementById('root').getBoundingClientRect(),c=card.getBoundingClientRect();
  extraCard.style.width=c.width+'px';
  extraCard.style.maxHeight=Math.max(48,innerHeight-c.height-32)+'px';
  const h=extraCard.offsetHeight;
  let y=notchEdge==='bottom'?c.top-h-gap:c.bottom+gap;
  if(y+h>innerHeight-8)y=c.top-h-gap;
  y=Math.max(8,Math.min(innerHeight-h-8,y));
  extraCard.style.left=c.left-origin.left+'px';extraCard.style.top=y-origin.top+'px';
  drawExtra();
}
function drawExtra(){
  extraCard.style.setProperty('--extra-open',Math.max(0,extraOpen));
  extraCard.classList.toggle('show',extraTarget===1);extraCard.classList.toggle('closing',extraTarget===0&&extraOpen>.001);
  if(extraOpen<.001){extraPath.removeAttribute('d');return;}
  const x=extraCard.offsetLeft,y=extraCard.offsetTop,w=extraCard.offsetWidth,h=extraCard.offsetHeight;
  const above=y<card.offsetTop,anchor=above?card.offsetTop:card.offsetTop+card.offsetHeight;
  const t=Math.max(0,extraOpen),near=anchor+((above?y+h:y)-anchor)*t;
  const far=anchor+((above?y:y+h)-anchor)*t,top=Math.min(near,far),bottom=Math.max(near,far);
  const mid=x+w/2,left=mid-w/2*Math.min(1,t),right=mid+w/2*Math.min(1,t),r=Math.min(22,(bottom-top)/2,(right-left)/2);
  const rect=`M${n(left+r)} ${n(top)}H${n(right-r)}Q${n(right)} ${n(top)} ${n(right)} ${n(top+r)}V${n(bottom-r)}Q${n(right)} ${n(bottom)} ${n(right-r)} ${n(bottom)}H${n(left+r)}Q${n(left)} ${n(bottom)} ${n(left)} ${n(bottom-r)}V${n(top+r)}Q${n(left)} ${n(top)} ${n(left+r)} ${n(top)}Z`;
  // The bridge rounds and thins as the growing frame separates from the usage view.
  const neck=32*(1-smooth((t-.25)/.65));
  const bridge=neck>.1?`M${n(mid-neck)} ${n(anchor)}Q${n(mid-neck*.35)} ${n((anchor+near)/2)} ${n(mid-neck)} ${n(near)}H${n(mid+neck)}Q${n(mid+neck*.35)} ${n((anchor+near)/2)} ${n(mid+neck)} ${n(anchor)}Z`:'';
  extraPath.setAttribute('d',rect+bridge);
  const blur=3*Math.sin(Math.PI*Math.min(1,t));
  extraFilter.querySelector('feGaussianBlur').setAttribute('stdDeviation',n(blur));
  for(const [key,value] of Object.entries({x:left-24,y:Math.min(top,anchor)-24,width:right-left+48,height:Math.max(bottom,anchor)-Math.min(top,anchor)+48}))extraFilter.setAttribute(key,n(value));
  if(blur>.2)extraPath.setAttribute('filter','url(#extra-goo)');else extraPath.removeAttribute('filter');
  extraCard.style.setProperty('--extra-rise',`${(anchor-(above?y+h:y))*(1-Math.min(1,t))}px`);
}
function extraBridgeRect(){
  const c=card.getBoundingClientRect(),e=extraCard.getBoundingClientRect(),above=e.top<c.top;
  return [c.left+c.width/2-36,above?e.bottom:c.bottom,72,Math.max(0,above?c.top-e.bottom:e.top-c.bottom)];
}
function extraContains(x,y){
  const r=extraBridgeRect();return x>=r[0]&&x<=r[0]+r[2]&&y>=r[1]&&y<=r[1]+r[3];
}
function setExtraShown(on,instant=false){
  extraTarget=on&&extraCard.textContent?1:0;extraCard.setAttribute('aria-hidden',String(!extraTarget));
  card.querySelector('.metadata-trigger')?.setAttribute('aria-expanded',String(!!extraTarget));
  placeExtraCard();
  if(instant||reducedDetails()){
    cancelAnimationFrame(extraFrame);extraFrame=0;extraLast=0;extraVelocity=0;extraOpen=extraTarget;drawExtra();reportHot();return;
  }
  if(extraFrame)return;
  const step=now=>{
    const dt=Math.min(.032,(now-(extraLast||now-16))/1000);extraLast=now;
    const omega=2*Math.PI/.58,damping=extraTarget?.78:1;
    extraVelocity+=(-omega*omega*(extraOpen-extraTarget)-2*damping*omega*extraVelocity)*dt;
    extraOpen+=extraVelocity*dt;
    const settled=Math.abs(extraOpen-extraTarget)<.002&&Math.abs(extraVelocity)<.025;
    if(settled){extraOpen=extraTarget;extraVelocity=0;}
    drawExtra();reportHot();
    if(settled){extraFrame=0;extraLast=0;}else extraFrame=requestAnimationFrame(step);
  };
  extraFrame=requestAnimationFrame(step);
}
extraCard.addEventListener('mouseenter',()=>{clearTimeout(hideTimer);});
extraCard.addEventListener('mouseleave',()=>{setTimeout(()=>{if(!extraCard.matches(':hover')&&!card.matches(':hover'))setExtraShown(false);},220);});
