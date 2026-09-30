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
const edgeDepth=edge=>edge==='top'||edge==='bottom'?90:70;
const SVG_NS='http://www.w3.org/2000/svg';
const shapeSvg=document.createElementNS(SVG_NS,'svg');
shapeSvg.id='shape';shapeSvg.setAttribute('aria-hidden','true');
const gooDefinition=id=>`<filter id="${id}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="0"/>
  <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -12"/></filter>`;
shapeSvg.innerHTML=`<defs>${gooDefinition('goo')}${gooDefinition('goo-start')}${gooDefinition('goo-end')}
  <clipPath id="start-band"><rect/></clipPath><clipPath id="end-band"><rect/></clipPath></defs>
  <g id="shape-body"><path class="part"/><path class="part"/>
    <g class="liquid"><path class="band" clip-path="url(#start-band)"/><path class="neck"/><path class="arm"/></g>
    <g class="liquid"><path class="band" clip-path="url(#end-band)"/><path class="neck"/><path class="arm"/></g></g>`;
const gooFilter=shapeSvg.querySelector('#goo'), gooBlur=gooFilter.querySelector('feGaussianBlur');
const shapeBody=shapeSvg.querySelector('#shape-body');
const [partA,partB]=shapeSvg.querySelectorAll('.part'), [armStart,armEnd]=shapeSvg.querySelectorAll('.arm');
const necks=[...shapeSvg.querySelectorAll('.neck')], liquids=[...shapeSvg.querySelectorAll('.liquid')];
const bands=[...shapeSvg.querySelectorAll('.band')], bandClips=[...shapeSvg.querySelectorAll('clipPath rect')];
const handleFilters=['goo-start','goo-end'].map(id=>shapeSvg.querySelector('#'+id));
pill.before(shapeSvg);

// How far open (0 closed against the edge, 1 open; a spring takes it a little past)
let openness=1, openVelocity=0, openFrame=0, openLast=0;
// How far the arms have come away from the flares (0 in the black, 1 at their place), and the tween moving it
let armsOut=0, armsFrame=0;
let absorbing=false;
const handles=[{el:pinHandle,ink:armStart,value:0,target:0,velocity:0,frame:0},{el:orb,ink:armEnd,value:0,target:0,velocity:0,frame:0}];

// A round-ended stroke rolls up from the arc's midpoint into the disc. Reversing the same
// drawing spreads the disc back into its arc, without swapping HTML and SVG silhouettes.
function morphHandles(){
  for(const h of handles){
    const to=!absorbing&&shown&&!carrying&&h.el.classList.contains('hover')?1:0;
    if(absorbing||to===h.target) continue;
    cancelAnimationFrame(h.frame);h.target=to;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){h.value=to;h.velocity=0;drawShape();continue;}
    let last=performance.now();
    const step=now=>{
      const dt=Math.min(.032,(now-last)/1000);last=now;
      const omega=2*Math.PI/.68,damping=to?.76:.88;
      h.velocity+=(-omega*omega*(h.value-to)-2*damping*omega*h.velocity)*dt;
      h.value+=h.velocity*dt;
      const settled=Math.abs(h.value-to)<.002&&Math.abs(h.velocity)<.025;
      if(settled){h.value=to;h.velocity=0;}
      drawShape();h.frame=settled?0:requestAnimationFrame(step);
    };
    h.frame=requestAnimationFrame(step);
  }
}
// A corner being rounded ({corner, first, second, before, after}), and how close to one the notch is (0 to 1)
let passage=null, cornerNear=0, pillTransform='';

const n=v=>+v.toFixed(2);
const smooth=x=>{ x=Math.max(0,Math.min(1,x)); return x*x*(3-2*x); };
// Mac's flareWalk eases curvature at both ends, rather than tracing a circle.
const flareWalk=(()=>{
  let heading=0,u=0,v=0;const points=[{u:0,v:0,heading:0}];
  for(let i=0;i<96;i++){
    const share=(i+.5)/96,before=heading;
    heading+=Math.PI*Math.min(share/.5,(1-share)/.5)/96;
    u+=Math.cos(heading)/96;v+=Math.sin(heading)/96;
    points.push({u,v,heading:(before+heading)/2});
  }
  return points.map(p=>({u:p.u/u,v:p.v/v,heading:p.heading}));
})();
function flarePoint(share,flare,gap,end){
  const at=Math.max(0,Math.min(96,share*96)),lo=Math.floor(at),hi=Math.min(96,lo+1),mix=at-lo;
  const p={};for(const key of ['u','v','heading'])p[key]=flareWalk[lo][key]+(flareWalk[hi][key]-flareWalk[lo][key])*mix;
  const sign=end?-1:1;
  return [sign*(flare*p.u-gap*Math.sin(p.heading)),
    -flare*(1-p.v)+gap*Math.cos(p.heading)];
}
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
  const proportions=handleMetrics(),depth=edgeDepth(notchEdge), d=Math.max(0,depth*openness), grown=Math.min(1,d/depth);
  const spread=Math.min(1.02,.75+.25*openness); // opening, it spreads along the edge a little too
  const Ls=L*spread, u0=(L-Ls)/2, u1=u0+Ls, F=proportions.flare*grown, r=SHAPE.corner*grown;
  shapeSvg.style.transform=pillTransform;
  shapeSvg.setAttribute('width',w);shapeSvg.setAttribute('height',h);
  shapeBody.setAttribute('transform',`matrix(${edgeMatrix(notchEdge,w,h).join(' ')})`);
  // Passage parts have page-space transforms. Clear them before applying the local edge matrix
  // to their parent, otherwise left/bottom parts rotate or reflect a second time after a corner.
  partA.removeAttribute('transform');partB.removeAttribute('transform');
  partA.setAttribute('d',partPath(u0,u1,d,r,F,r,F)); partB.removeAttribute('d');
  // Arms: drawn in with the notch as it nears a corner, and each gives way to its button under the pointer
  const detailRetreat=typeof detailArm==='number'?1-smooth(Math.max(0,Math.min(1,detailArm))):1;
  const merging=absorbing||(typeof detailTarget==='number'&&detailTarget===1&&detailRetreat<1);
  const out=armsOut*(1-cornerNear)*smooth((grown-.6)/.4)*detailRetreat;
  const stroke=proportions.stroke*grown;
  setGoo(0,-300,-300,L+600,d+600);
  handles.forEach((h,i)=>{
    const cx=i?u1+F:u0-F, mid=(i?225:-45)*Math.PI/180, disc=Math.max(0,Math.min(1,h.value));
    const filter=handleFilters[i], group=liquids[i];
    bands[i].setAttribute('d',partA.getAttribute('d'));
    for(const [key,value] of Object.entries({x:cx-90,y:-60,width:180,height:190}))bandClips[i].setAttribute(key,value);
    necks[i].removeAttribute('d');
    h.el.style.setProperty('--disc-glyph',smooth((disc-.65)/.35));
    if((!i&&!showPin)||grown<.5){h.ink.removeAttribute('d');bands[i].removeAttribute('d');group.removeAttribute('filter');return;}
    const rest=14.625*proportions.scale*grown, buried=rest+stroke*1.4;
    // Mac GooArc: a buried drop pushes past its resting place on a neck, then unrolls.
    const slide=-buried*(1-out)+rest*(merging?1.2:2.1)*Math.sin(Math.PI*Math.min(out/(merging?.85:.8),1));
    const unrolled=smooth((out-(merging?.6:.52))/(merging?.35:.43));
    const onto=smooth((1-disc)/.55), half=Math.PI/4*unrolled*smooth(((1-disc)-.08)/.82);
    const radius=proportions.arm, morphShift=radius*(1-onto);
    const home=merging?smooth(1-out):0;
    const baseMid=radius-morphShift-(1-disc)*slide;
    const centre=baseMid+(F+stroke-baseMid)*home*disc;
    const [a,b,c,e]=edgeMatrix(notchEdge,w,h), dx=centre*Math.cos(mid),dy=centre*Math.sin(mid);
    h.el.style.setProperty('--glyph-x',`${n(a*dx+c*dy)}px`);
    h.el.style.setProperty('--glyph-y',`${n(b*dx+e*dy)}px`);
    const points=[],arcMid=flarePoint(.5,F,F-radius,i);
    for(let j=0;j<=64;j++){
      const share=.5+(j/64-.5)*(half/(Math.PI/4));
      const p=flarePoint(share,F,F-radius,i);
      points.push(`${j?'L':'M'}${n(cx+p[0]-arcMid[0]+centre*Math.cos(mid))} ${n(F+p[1]-arcMid[1]+centre*Math.sin(mid))}`);
    }
    h.ink.setAttribute('d',points.join(''));
    const arcWidth=stroke*2.3+(stroke-stroke*2.3)*unrolled;
    let width=proportions.disc+(arcWidth-proportions.disc)*smooth((1-disc)/.8);
    if(merging)width*=disc?(1-.72*home):smooth(out/.35);
    const goo=merging
      ?stroke*.45*(1+.8*(1-smooth((out-.04)/.32)))*smooth((.93-out)/.15)*smooth(out/.05)
      :stroke*.4*smooth(out/.15)*(1-smooth((out-.6)/.35));
    const blur=Math.max(goo,5.5*proportions.scale*Math.sin(Math.PI*disc));
    h.ink.setAttribute('stroke-width',n(width+blur*.4));
    // A curved strand is wide at the flare and drop, pinched in the middle, then parts.
    const armNeck=merging?stroke*1.1*smooth((.94-out)/.1):stroke*1.1*(1-smooth((out-.2)/.5));
    const neckWidth=Math.max(armNeck,stroke*1.45*Math.pow(Math.sin(Math.PI*disc),.7));
    if(neckWidth>stroke*.18&&out>.01){
      const ax=cx+(F+stroke)*Math.cos(mid), ay=F+(F+stroke)*Math.sin(mid);
      const reach=merging?smooth((.92-out)/.32):1;
      const bx=ax+(cx+centre*Math.cos(mid)-ax)*reach, by=ay+(F+centre*Math.sin(mid)-ay)*reach;
      const dx=bx-ax,dy=by-ay,len=Math.max(.001,Math.hypot(dx,dy)), px=-dy/len,py=dx/len;
      const q=(x,y,half,sign)=>`${n(x+px*half*sign)} ${n(y+py*half*sign)}`;
      const mx=(ax+bx)/2,my=(ay+by)/2,base=stroke*1.3,tip=Math.max(stroke*.7,width*.35),pinch=neckWidth/2;
      necks[i].setAttribute('d',`M${q(ax,ay,base,1)}Q${q(mx,my,pinch,1)} ${q(bx,by,tip,1)}L${q(bx,by,tip,-1)}Q${q(mx,my,pinch,-1)} ${q(ax,ay,base,-1)}Z`);
    }
    filter.querySelector('feGaussianBlur').setAttribute('stdDeviation',n(blur));
    for(const [key,value] of Object.entries({x:cx-100,y:-80,width:200,height:230}))filter.setAttribute(key,value);
    if(blur>.3)group.setAttribute('filter',`url(#${filter.id})`);else group.removeAttribute('filter');
  });
}

/* Round a corner: the part still on the edge it is leaving, shortening, and the part on the edge it is
   coming onto, growing. Each keeps the notch's own rounded, flared end at its far end; its end in the
   corner closes up square only as the other part grows, and runs on past the screen edge so the goo has
   black to work with right up to the bezel. Blurred together at most half way round, they meet in the
   bend as one round body with no seam and no point (the Mac's CornerPassage). */
function notchAlongLength(){return notchEdge==='top'||notchEdge==='bottom'?pill.offsetWidth:pill.offsetHeight;}
function drawPassage(){
  const W=innerWidth, H=innerHeight, D=Math.max(edgeDepth(passage.first),edgeDepth(passage.second)), L=passage.before+passage.after;
  shapeSvg.style.transform='none';
  shapeSvg.setAttribute('width',W);shapeSvg.setAttribute('height',H);
  shapeBody.removeAttribute('transform');
  const {corner,first,second,before,after}=passage, bleed=SHAPE.bleed;
  const part=(el,edge,length,other,cornerAtStart)=>{
    if(length<1){ el.removeAttribute('d'); return; }
    const len=edge==='top'||edge==='bottom'?W:H, at=cornerAtStart?0:len;
    const depth=edgeDepth(edge), square=smooth(other/depth), size=smooth(length/depth);
    const flare=handleMetrics(edge,notchAlongLength()).flare;
    const rc=SHAPE.corner*(1-square), fc=flare*(1-square), ext=bleed*square;
    const rf=SHAPE.corner*size, ff=flare*size;
    const d=cornerAtStart
      ? partPath(at-ext,at+length,depth,rc,fc,rf,ff)
      : partPath(at-length,at+ext,depth,rf,ff,rc,fc);
    el.setAttribute('d',d); el.setAttribute('transform',`matrix(${edgeMatrix(edge,W,H).join(' ')})`);
  };
  // Where the corner is along each edge: at its start (u = 0) or its end
  const atStart={tr:{top:false,right:true},br:{right:false,bottom:false},bl:{bottom:true,left:false},tl:{left:true,top:true}}[corner];
  part(partA,first,before,after,atStart[first]);
  part(partB,second,after,before,atStart[second]);
  armStart.removeAttribute('d'); armEnd.removeAttribute('d');
  for(const el of [...necks,...bands]) el.removeAttribute('d');
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
  for(const h of handles){cancelAnimationFrame(h.frame);h.frame=0;h.value=0;h.target=0;h.velocity=0;}
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){ armsOut=1; setOpenness(1); return; }
  openVelocity=0; openLast=0; setOpenness(0);
  const omega=2*Math.PI/0.62, zeta=0.72;
  let armsStarted=false;
  const step=now=>{
    const dt=Math.min(.032,(now-(openLast||now-16))/1000); openLast=now;
    openVelocity+=(-omega*omega*(openness-1)-2*zeta*omega*openVelocity)*dt;
    const next=openness+openVelocity*dt;
    if(!armsStarted&&next>.9){ armsStarted=true; moveArms(1,.8,smooth); }
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
    if(absorbing){for(const h of handles){h.value=0;h.target=0;h.velocity=0;}absorbing=false;}
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
