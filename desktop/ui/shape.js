'use strict';
/* The notch's black, drawn as SVG instead of a CSS box with gradient fillets, so its shape can move: it
   wells out of the edge on a spring, its resting arms bud out of its flares and are drawn back in, and
   round a corner it is two parts that run together like liquid. The #pill box stays for layout and
   hit testing, transparent; this draws under it.

   Shapes are worked out in edge space, u along a screen edge and v in from it, then turned onto the page.
   Measures are the notch's own: 70 deep, 20 round at its far corners, flares of 38.7 meeting the screen
   edge at a tangent, and resting arms 28.5 out from each flare's centre (the Mac's NotchLayout).

   "Goo" is the Mac's technique: blur the black, then cut it back at half strength. Where two shapes are
   close they melt into one round body, the way two drops do; elsewhere they keep their own outline. It
   only runs while something is dividing or merging, over the notch's own area. */
const SHAPE={depth:70,flare:38.7,corner:20,bleed:40,arm:28.5,armStroke:8.8};
const SVG_NS='http://www.w3.org/2000/svg';
const shapeSvg=document.createElementNS(SVG_NS,'svg');
shapeSvg.id='shape';shapeSvg.setAttribute('aria-hidden','true');
shapeSvg.innerHTML=`<defs><filter id="goo" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="0"/>
  <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -12"/></filter></defs>
  <g id="shape-body"><path class="part"/><path class="part"/><path class="neck"/><path class="neck"/><path class="arm"/><path class="arm"/></g>`;
const gooFilter=shapeSvg.querySelector('#goo'), gooBlur=shapeSvg.querySelector('feGaussianBlur');
const shapeBody=shapeSvg.querySelector('#shape-body');
const [partA,partB]=shapeSvg.querySelectorAll('.part'), [armStart,armEnd]=shapeSvg.querySelectorAll('.arm');
const necks=[...shapeSvg.querySelectorAll('.neck')];
pill.before(shapeSvg);

// How far open (0 closed against the edge, 1 open; a spring takes it a little past)
let openness=1, openVelocity=0, openFrame=0, openLast=0;
// How far the arms have come away from the flares (0 in the black, 1 at their place), and the tween moving it
let armsOut=0, armsFrame=0;
let absorbing=false;
const handles=[{el:moveHandle,ink:armStart,value:0,target:0,frame:0},{el:orb,ink:armEnd,value:0,target:0,frame:0}];

// A round-ended stroke rolls up from the arc's midpoint into the disc. Reversing the same
// drawing spreads the disc back into its arc, without swapping HTML and SVG silhouettes.
function morphHandles(){
  for(const h of handles){
    const to=!absorbing&&shown&&!carrying&&h.el.classList.contains('hover')?1:0;
    if(absorbing||to===h.target) continue;
    cancelAnimationFrame(h.frame);h.target=to;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){h.value=to;drawShape();continue;}
    const from=h.value,t0=performance.now();
    const step=now=>{
      const t=Math.min(1,(now-t0)/360);h.value=from+(to-from)*smooth(t);drawShape();
      h.frame=t<1?requestAnimationFrame(step):0;
    };
    h.frame=requestAnimationFrame(step);
  }
}
// A corner being rounded ({corner, first, second, before, after}), and how close to one the notch is (0 to 1)
let passage=null, cornerNear=0, pillTransform='';

const n=v=>+v.toFixed(2);
const smooth=x=>{ x=Math.max(0,Math.min(1,x)); return x*x*(3-2*x); };
// One part of the notch on one edge, u0 to u1 along it, d deep, each end with its own corner and flare
function partPath(u0,u1,d,r0,f0,r1,f1){
  const room=u1-u0, k=r0+r1>room&&r0+r1>0?room/(r0+r1):1; r0*=k; r1*=k;
  f0=Math.min(f0,Math.max(0,d-r0)); f1=Math.min(f1,Math.max(0,d-r1));
  const b=-SHAPE.bleed;
  return `M${n(u0-f0)} ${b}V0A${n(f0)} ${n(f0)} 0 0 1 ${n(u0)} ${n(f0)}V${n(d-r0)}A${n(r0)} ${n(r0)} 0 0 0 ${n(u0+r0)} ${n(d)}`
    +`H${n(u1-r1)}A${n(r1)} ${n(r1)} 0 0 0 ${n(u1)} ${n(d-r1)}V${n(f1)}A${n(f1)} ${n(f1)} 0 0 1 ${n(u1+f1)} 0V${b}Z`;
}
// Edge space onto a w×h surface: u runs down or across, v in from the edge
function edgeMatrix(edge,w,h){
  return edge==='right'?[0,1,-1,0,w,0]:edge==='left'?[0,1,1,0,0,0]:edge==='bottom'?[1,0,0,-1,0,h]:[1,0,0,1,0,0];
}
function setGoo(blur,x,y,w,h){
  gooBlur.setAttribute('stdDeviation',n(blur));
  for(const [k,v] of Object.entries({x,y,width:w,height:h})) gooFilter.setAttribute(k,n(v));
  if(blur>0.3) shapeBody.setAttribute('filter','url(#goo)'); else shapeBody.removeAttribute('filter');
}

function drawShape(){ if(passage) drawPassage(); else drawStraight(); }

/* On an edge: one part the length of the pill, and an arm off each end. At 0 an arm lies a full stroke
   past its flare, inside the black; going out it swells from the flare on a neck of goo and lets go. */
function drawStraight(){
  const w=pill.offsetWidth, h=pill.offsetHeight;
  if(!w||!h) return;
  const vertical=notchEdge==='left'||notchEdge==='right', L=vertical?h:w;
  const d=Math.max(0,SHAPE.depth*openness), grown=Math.min(1,d/SHAPE.depth);
  const spread=Math.min(1.02,.75+.25*openness); // opening, it spreads along the edge a little too
  const Ls=L*spread, u0=(L-Ls)/2, u1=u0+Ls, F=SHAPE.flare*grown, r=SHAPE.corner*grown;
  shapeSvg.style.transform=pillTransform;
  shapeSvg.setAttribute('width',w);shapeSvg.setAttribute('height',h);
  shapeBody.setAttribute('transform',`matrix(${edgeMatrix(notchEdge,w,h).join(' ')})`);
  // Passage parts have page-space transforms. Clear them before applying the local edge matrix
  // to their parent, otherwise left/bottom parts rotate or reflect a second time after a corner.
  partA.removeAttribute('transform');partB.removeAttribute('transform');
  partA.setAttribute('d',partPath(u0,u1,d,r,F,r,F)); partB.removeAttribute('d');
  // Arms: drawn in with the notch as it nears a corner, and each gives way to its button under the pointer
  const out=armsOut*(1-cornerNear)*smooth((grown-.6)/.4);
  const armR=SHAPE.arm+(F+SHAPE.armStroke-SHAPE.arm)*(1-out), stroke=SHAPE.armStroke*grown;
  handles.forEach((h,i)=>{
    const cx=i?u1+F:u0-F, mid=(i?225:-45)*Math.PI/180, disc=h.value;
    necks[i].removeAttribute('d');
    if((!i&&!showMove)||grown<.5){h.ink.removeAttribute('d');return;}
    const onto=smooth((1-disc)/.55), half=Math.PI/4*smooth(((1-disc)-.08)/.82);
    const radius=armR, shift=radius*(1-onto);
    // During absorption the disc follows the flare's midpoint into solid black.
    const home=absorbing?smooth(1-out):0;
    const centreRadius=shift*(1-home)+(radius+F+SHAPE.armStroke)*home*disc;
    const sx=-centreRadius*Math.cos(mid), sy=-centreRadius*Math.sin(mid);
    const points=[];
    for(let j=0;j<=32;j++){
      const angle=mid-half+2*half*j/32;
      points.push(`${j?'L':'M'}${n(cx+radius*Math.cos(angle)+sx)} ${n(F+radius*Math.sin(angle)+sy)}`);
    }
    h.ink.setAttribute('d',points.join(''));
    const width=(38+(stroke-38)*smooth((1-disc)/.8))*(1-.72*home);
    h.ink.setAttribute('stroke-width',n(width));
    if(absorbing&&disc>.01&&home>.01&&home<.99){
      const ax=cx+(F+stroke)*Math.cos(mid), ay=F+(F+stroke)*Math.sin(mid);
      const bx=cx+radius*Math.cos(mid)+sx, by=F+radius*Math.sin(mid)+sy;
      necks[i].setAttribute('d',`M${n(ax)} ${n(ay)}L${n(bx)} ${n(by)}`);
      necks[i].setAttribute('stroke-width',n(width*smooth(home/.22)*.65));
    }
  });
  // Goo while an arm is dividing or going back in: strong on the flare, gone by the time it is at its place
  const dividing=out>.01&&out<.97?SHAPE.armStroke*.55*(1-smooth((out-.35)/.6)):0;
  const morphBlur=Math.max(...handles.map(h=>4*4*h.value*(1-h.value)));
  const mergeBlur=absorbing&&handles.some(h=>h.value>.01)?5*smooth((1-out)/.2):0;
  setGoo(Math.max(dividing,morphBlur,mergeBlur),-300,-300,L+600,d+600);
}

/* Round a corner: the part still on the edge it is leaving, shortening, and the part on the edge it is
   coming onto, growing. Each keeps the notch's own rounded, flared end at its far end; its end in the
   corner closes up square only as the other part grows, and runs on past the screen edge so the goo has
   black to work with right up to the bezel. Blurred together at most half way round, they meet in the
   bend as one round body with no seam and no point (the Mac's CornerPassage). */
function drawPassage(){
  const W=innerWidth, H=innerHeight, D=SHAPE.depth, L=passage.before+passage.after;
  shapeSvg.style.transform='none';
  shapeSvg.setAttribute('width',W);shapeSvg.setAttribute('height',H);
  shapeBody.removeAttribute('transform');
  const {corner,first,second,before,after}=passage, bleed=SHAPE.bleed;
  const part=(el,edge,length,other,cornerAtStart)=>{
    if(length<1){ el.removeAttribute('d'); return; }
    const len=edge==='top'||edge==='bottom'?W:H, at=cornerAtStart?0:len;
    const square=smooth(other/D), size=smooth(length/D);
    const rc=SHAPE.corner*(1-square), fc=SHAPE.flare*(1-square), ext=bleed*square;
    const rf=SHAPE.corner*size, ff=SHAPE.flare*size;
    const d=cornerAtStart
      ? partPath(at-ext,at+length,D,rc,fc,rf,ff)
      : partPath(at-length,at+ext,D,rf,ff,rc,fc);
    el.setAttribute('d',d); el.setAttribute('transform',`matrix(${edgeMatrix(edge,W,H).join(' ')})`);
  };
  // Where the corner is along each edge: at its start (u = 0) or its end
  const atStart={tr:{top:false,right:true},br:{right:false,bottom:false},bl:{bottom:true,left:false},tl:{left:true,top:true}}[corner];
  part(partA,first,before,after,atStart[first]);
  part(partB,second,after,before,atStart[second]);
  armStart.removeAttribute('d'); armEnd.removeAttribute('d');
  for(const neck of necks) neck.removeAttribute('d');
  const share=Math.min(1,4*Math.min(before,after)/L), blur=D*.22*share*share*(3-2*share);
  const cx=corner==='tr'||corner==='br'?W:0, cy=corner==='br'||corner==='bl'?H:0;
  setGoo(blur,cx-L-120,cy-L-120,2*L+240,2*L+240);
}
function setShapePassage(p,near,transform){ passage=p; cornerNear=near; pillTransform=transform; }

/* Opening: the Mac's unfold spring (response 0.62 s, damping 0.72). The small overshoot is the whole
   effect, the notch swelling a few points past its depth and settling like a body of liquid. The rings
   ride out with it (--open in agent-usage.css), and the arms divide from the flares once it is open. */
function setOpenness(v){ openness=v; document.getElementById('root').style.setProperty('--open',v.toFixed(4)); drawShape(); }
function openShape(){
  cancelAnimationFrame(openFrame); openFrame=0;
  cancelAnimationFrame(armsFrame); armsOut=0;
  absorbing=false;
  for(const h of handles){cancelAnimationFrame(h.frame);h.frame=0;h.value=0;h.target=0;}
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){ armsOut=1; setOpenness(1); return; }
  openVelocity=0; openLast=0; setOpenness(0);
  const omega=2*Math.PI/0.62, zeta=0.72;
  let armsStarted=false;
  const step=now=>{
    const dt=Math.min(.032,(now-(openLast||now-16))/1000); openLast=now;
    openVelocity+=(-omega*omega*(openness-1)-2*zeta*omega*openVelocity)*dt;
    const next=openness+openVelocity*dt;
    if(!armsStarted&&next>.9){ armsStarted=true; moveArms(1,.46,t=>1-Math.pow(1-t,3)); }
    if(Math.abs(next-1)<.0015&&Math.abs(openVelocity)<.02){ openFrame=0; setOpenness(1); reportHot(); return; }
    setOpenness(next); openFrame=requestAnimationFrame(step);
  };
  openFrame=requestAnimationFrame(step);
}
// Arms out to `to` over `seconds`: out easing off as they arrive, back in accelerating as they are taken in
function moveArms(to,seconds,ease=t=>t*t){
  cancelAnimationFrame(armsFrame);
  absorbing=to===0;
  if(absorbing) for(const h of handles){cancelAnimationFrame(h.frame);h.frame=0;}
  else morphHandles();
  const finish=()=>{
    if(absorbing){for(const h of handles){h.value=0;h.target=0;}absorbing=false;}
    morphHandles();drawShape();
  };
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){ armsOut=to;finish();return; }
  const from=armsOut, t0=performance.now();
  const step=now=>{
    const t=Math.min(1,(now-t0)/(seconds*1000)); armsOut=from+(to-from)*ease(t); drawShape();
    armsFrame=t<1?requestAnimationFrame(step):0;
    if(t===1) finish();
  };
  armsFrame=requestAnimationFrame(step);
}
new ResizeObserver(()=>drawShape()).observe(pill);
