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
shapeSvg.id='shape';uiMotion.attr(shapeSvg,'aria-hidden','true');
const gooDefinition=id=>`<filter id="${id}" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="0"/>
  <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -12"/></filter>`;
shapeSvg.innerHTML=`<defs>${gooDefinition('goo')}${gooDefinition('goo-start')}${gooDefinition('goo-end')}
  <clipPath id="start-band"><rect/></clipPath><clipPath id="end-band"><rect/></clipPath></defs>
  <g id="shape-gravity"><g id="shape-body"><path class="part"/><path class="part"/>
    <g class="liquid"><path class="band" clip-path="url(#start-band)"/><path class="neck"/><path class="arm"/></g>
    <g class="liquid"><path class="band" clip-path="url(#end-band)"/><path class="neck"/><path class="arm"/></g></g></g>`;
const gooFilter=shapeSvg.querySelector('#goo');
// A goo filter's blur and its cut-back, set together. The cut-back keeps the half-alpha line, which is where shapes meet
// and part, and makes the edge about a pixel soft at any blur. A fixed 24x cut left only a fraction of a pixel there at
// small blurs, so edges stepped like pixels while anything moved.
function setGooBlur(filter,sigma){
  uiMotion.attr(filter.querySelector('feGaussianBlur'),'stdDeviation',n(sigma));
  const k=Math.max(1,Math.min(24,sigma*2.6));
  uiMotion.attr(filter.querySelector('feColorMatrix'),'values',`1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${n(k)} ${n(.5-k/2)}`);
}
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
// swap: how far a handle is out of its pocket while it changes what it holds (1 out, 0 flowed back into the notch)
const handles=[{el:pinHandle,ink:armStart,value:0,target:0,velocity:0,frame:0,swap:1,swapping:false,swapFrame:0},{el:orb,ink:armEnd,value:0,target:0,velocity:0,frame:0,swap:1,swapping:false,swapFrame:0}];
// The material takes time to stretch and rejoin; hit targets and native pointer tracking stay immediate.
const ARM_MOTION={hoverResponse:.74,returnResponse:.82,emerge:.66,absorb:.26};
// The unread dot's bell (drawSprout): its own goo, a band of the notch round the corner it leaves, a strand and a drop
shapeSvg.querySelector('defs').insertAdjacentHTML('beforeend',`${gooDefinition('goo-sprout')}<clipPath id="sprout-clip"><rect/></clipPath>`);
shapeBody.insertAdjacentHTML('beforeend','<g class="sprout-liquid"><path class="sprout-band" clip-path="url(#sprout-clip)"/><path class="sprout-neck"/><path class="sprout-drop"/></g>');
const sproutInk={group:shapeSvg.querySelector('.sprout-liquid'),band:shapeSvg.querySelector('.sprout-band'),neck:shapeSvg.querySelector('.sprout-neck'),
  drop:shapeSvg.querySelector('.sprout-drop'),clip:shapeSvg.querySelector('#sprout-clip rect'),filter:shapeSvg.querySelector('#goo-sprout')};
// value: how far the bell is out of the corner (0 the dot at rest, 1 the bell out; the spring takes it a little past)
const sprout={value:0,target:0,velocity:0,frame:0,snapAt:0,available:false,focused:false,geo:null};

// A round-ended stroke rolls up from the arc's midpoint into the disc. Reversing the same
// drawing spreads the disc back into its arc, without swapping HTML and SVG silhouettes.
// A pocket mid-swap keeps its drop out until the new glyph is home and has swung, then melts back like any other.
function morphHandles(){
  for(const h of handles){
    const to=!absorbing&&shown&&!carrying&&h.el.classList.contains('hover')?1:0;
    if(absorbing||h.swapping||to===h.target) continue;
    uiMotion.cancel(h.frame);h.target=to;
    if(matchMedia('(prefers-reduced-motion: reduce)').matches){h.value=to;h.velocity=0;drawShape();continue;}
    let last=performance.now();
    const step=now=>{
      const dt=Math.min(.1,(now-last)/1000);last=now;
      const omega=2*Math.PI/(to?ARM_MOTION.hoverResponse:ARM_MOTION.returnResponse),damping=to?.86:.9;
      [h.value,h.velocity]=uiMotion.spring(h.value,h.velocity,to,omega,damping,dt);
      const settled=Math.abs(h.value-to)<.002&&Math.abs(h.velocity)<.025;
      if(settled){h.value=to;h.velocity=0;}
      drawShape();h.frame=settled?0:uiMotion.frame(step);
    };
    h.frame=uiMotion.frame(step);
  }
  morphSprout();
}
// The bell under the unread dot: out on a lively spring that pops a little past, back on a quick, nearly flat one.
// It keeps its frames while the bell still swings from the snap.
function morphSprout(){
  const to=sprout.available&&shown&&!carrying&&!absorbing&&!passage&&(hovered==='sprout'||sprout.focused)?1:0;
  if(to===sprout.target)return;
  uiMotion.cancel(sprout.frame);sprout.target=to;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){sprout.value=to;sprout.velocity=0;sprout.frame=0;drawShape();reportHot();return;}
  let last=performance.now();
  const step=now=>{
    const dt=Math.min(.1,(now-last)/1000);last=now;
    const omega=2*Math.PI/(to?.78:.56),damping=to?.6:.9;
    [sprout.value,sprout.velocity]=uiMotion.spring(sprout.value,sprout.velocity,to,omega,damping,dt);
    const settled=Math.abs(sprout.value-to)<.002&&Math.abs(sprout.velocity)<.025;
    if(settled){sprout.value=to;sprout.velocity=0;}
    drawShape();
    if(sprout.target!==to)return; // turned round while drawing: the new spring has the frames now
    sprout.frame=!settled||sprout.snapAt&&now-sprout.snapAt<1200?uiMotion.frame(step):0;
    if(!sprout.frame){sprout.snapAt=0;drawShape();reportHot();}
  };
  sprout.frame=uiMotion.frame(step);
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
  setGooBlur(gooFilter,blur);
  for(const [k,v] of Object.entries({x,y,width:w,height:h})) uiMotion.attr(gooFilter,k,n(v));
  if(blur>0.3) uiMotion.attr(shapeBody,'filter','url(#goo)'); else shapeBody.removeAttribute('filter');
}

function drawShape(){uiMotion.paint('shape',paintShape,10);}
function paintShape(){ if(passage) drawPassage(); else drawStraight(); if(typeof paintAttachmentGravity==='function')paintAttachmentGravity(); if(typeof placeUnreadDot==='function')placeUnreadDot(); if(typeof notificationRim!=='undefined')notificationRim.refresh(); }

/* On an edge: one part the length of the pill, and an arm off each end. At 0 an arm lies a full stroke
   past its flare, inside the black; going out it swells from the flare on a neck of goo and lets go. */
function drawStraight(){
  const w=pill.offsetWidth, h=pill.offsetHeight, hgt=h;
  const origin=document.getElementById('root').getBoundingClientRect();
  const translation=pillTransform.match(/translate\(([-.\d]+)px,\s*([-.\d]+)px\)/);
  const matrix=edgeMatrix(notchEdge,w,h);matrix[4]+=origin.left+Number(translation?.[1]||0);matrix[5]+=origin.top+Number(translation?.[2]||0);
  if(!w||!h) return;
  const vertical=notchEdge==='left'||notchEdge==='right', L=vertical?h:w;
  const proportions=handleMetrics(),depth=edgeDepth(notchEdge),pull=typeof notchEffects==='undefined'?0:notchEffects.dock.value;
  const stretch=typeof materialStretch==='number'?materialStretch:0;
  const d=Math.max(0,(depth*openness+pull)/(1+stretch)), grown=Math.min(1,d/depth);
  const spread=Math.min(1.02,.75+.25*openness); // opening, it spreads along the edge a little too
  const Ls=L*spread*(1+stretch)+pull*.8, u0=(L-Ls)/2, u1=u0+Ls, F=proportions.flare*grown, r=SHAPE.corner*grown;
  shapeSvg.style.transform=pillTransform;
  uiMotion.attr(shapeSvg,'width',w);uiMotion.attr(shapeSvg,'height',h);
  uiMotion.attr(shapeBody,'transform',`matrix(${edgeMatrix(notchEdge,w,h).join(' ')})`);
  // Passage parts have page-space transforms. Clear them before applying the local edge matrix
  // to their parent, otherwise left/bottom parts rotate or reflect a second time after a corner.
  partA.removeAttribute('transform');partB.removeAttribute('transform');
  const flares=handles.map(h=>F*(1+(matchMedia('(prefers-reduced-motion: reduce)').matches?0:Math.max(-.035,Math.min(.035,h.velocity/80)))));
  uiMotion.attr(partA,'d',partPath(u0,u1,d,r,flares[0],r,flares[1])); partB.removeAttribute('d');
  partA.rimPart=[u0,u1,d,r,flares[0],r,flares[1],-SHAPE.bleed];
  // Arms: drawn in with the notch as it nears a corner, and each gives way to its button under the pointer
  const detailRetreat=typeof detailArm==='number'?1-smooth(Math.max(0,Math.min(1,detailArm))):1;
  const mergingAll=absorbing||(typeof detailTarget==='number'&&detailTarget===1&&detailRetreat<1);
  const armsOutAll=armsOut*(1-cornerNear)*smooth((grown-.6)/.4)*detailRetreat;
  const stroke=proportions.stroke*grown;
  setGoo(0,-300,-300,L+600,d+600);
  handles.forEach((h,i)=>{
    const cx=i?u1+F:u0-F, mid=(i?225:-45)*Math.PI/180, disc=Math.max(0,Math.min(1,h.value));
    const filter=handleFilters[i], group=liquids[i];
    // A handle changing what it holds takes the same way home and back out as the arms do when absorbed
    const out=armsOutAll*h.swap, merging=mergingAll||h.swapping;
    uiMotion.attr(bands[i],'d',partA.getAttribute('d'));
    for(const [key,value] of Object.entries({x:cx-90,y:-60,width:180,height:190}))uiMotion.attr(bandClips[i],key,value);
    necks[i].removeAttribute('d');
    if((!i&&!showPin)||grown<.5){h.ink.removeAttribute('d');bands[i].removeAttribute('d');group.removeAttribute('filter');return;}
    if(h.swapping){drawPull(h,i,cx,F,stroke,proportions,mid,filter,group,disc,detailRetreat,w,hgt);return;}
    drawArm(h,i,cx,F,stroke,proportions,mid,filter,group,disc,out,merging,detailRetreat,w,hgt,grown);
  });
  drawSprout(u0,d,r,proportions,grown,matrix);
}

/* The unread dot's own way to the log. The dot rests in the notch's leading front corner, on the bisector of its
   rounding. Under the pointer the corner swells and a drop of the notch's ink is drawn out along that bisector on a
   strand that pinches and parts; the bell sharpens on the drop and swings from the snap, and the dot rides out with
   it to settle on the bell's shoulder. Let go, the notch reaches out a strand, swallows the drop and the dot slides
   home. Where the screen's corner is close, the way out turns toward the notch's front so the bell stays on screen.
   notify.js offers it (an unread dot in the corner) and places the dot from `sprout.geo`. */
const SPROUT={rest:10,gap:4,snap:.72};
function clearSprout(){
  for(const el of [sproutInk.band,sproutInk.neck,sproutInk.drop])el.removeAttribute('d');
  sproutInk.group.removeAttribute('filter');sprout.geo=null;
}
function drawSprout(u0,d,r,proportions,grown,matrix){
  if(grown<.5){clearSprout();return;}
  const page=([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]];
  const s=sprout.value,Rb=proportions.disc*.4,stroke=proportions.stroke*grown,len=r+SPROUT.gap+Rb,C=[u0+r,d-r];
  // Along the edge, page space runs the same way as u, so the room before the screen's corner is one subtraction
  const along=p=>page(p)[edgeIsVertical()?1:0], room=along(C)-Rb-6;
  const theta=Math.asin(Math.max(0,Math.min(Math.SQRT1_2,room/len)));
  const nv=[-Math.sin(theta),Math.cos(theta)], at=k=>[C[0]+nv[0]*k,C[1]+nv[1]*k];
  const rho0=Rb*.28, rho=Rb*(.28+.72*smooth(s)), k0=r-rho0-1, D=at(k0+(len-k0)*s);
  const P0=at(Math.max(0,r-SPROUT.rest)), P1=at(len);
  sprout.geo={P0:page(P0),P1:page(P1),D:page(D),rho,Rb,s,glyph:proportions.glyph*.84};
  if(s<.004){for(const el of [sproutInk.band,sproutInk.neck,sproutInk.drop])el.removeAttribute('d');sproutInk.group.removeAttribute('filter');return;}
  uiMotion.attr(sproutInk.drop,'d',`M${n(D[0]-rho)} ${n(D[1])}a${n(rho)} ${n(rho)} 0 1 0 ${n(2*rho)} 0a${n(rho)} ${n(rho)} 0 1 0 ${n(-2*rho)} 0Z`);
  uiMotion.attr(sproutInk.band,'d',partA.getAttribute('d'));
  for(const [key,value] of Object.entries({x:u0-4,y:d-r-14,width:r+44,height:r+28}))uiMotion.attr(sproutInk.clip,key,n(value));
  // The strand: joined while the drop is drawn off; going out, past the snap its tail whips back into the corner;
  // coming home, the corner reaches out to take the drop before it is swallowed
  const outward=sprout.target===1, joined=s<=SPROUT.snap, src=at(r-stroke*1.1);
  let tip=1, end=D;
  if(!joined){if(outward){tip=1-smooth((s-SPROUT.snap)/.16);end=at(k0+(len-k0)*SPROUT.snap);}else tip=smooth((1-Math.min(1,s))/(1-SPROUT.snap));}
  if(tip>.02){
    const thin=1-smooth((s-.3)/(SPROUT.snap-.3));
    const base=stroke*1.35,pinch=Math.max(.5,stroke*.95*thin),tail=joined?rho*.78:Math.max(.5,stroke*.35);
    const half=f=>f<.55?base+(pinch-base)*smooth(f/.55):pinch+(tail-pinch)*smooth((f-.55)/.45);
    const dx=end[0]-src[0],dy=end[1]-src[1],l=Math.hypot(dx,dy)||1,g=[dx/l,dy/l],left=[],right=[];
    for(let k=0;k<=20;k++){const f=k/20,t=f*tip,q=[src[0]+dx*t,src[1]+dy*t],hw=half(f);
      left.push(`${n(q[0]-g[1]*hw)} ${n(q[1]+g[0]*hw)}`);right.push(`${n(q[0]+g[1]*hw)} ${n(q[1]-g[0]*hw)}`);}
    uiMotion.attr(sproutInk.neck,'d',`M${left.join('L')}L${right.reverse().join('L')}Z`);
  }else sproutInk.neck.removeAttribute('d');
  // Liquid while it moves, sharp once it is out or home
  if(outward&&s>SPROUT.snap&&!sprout.snapAt)sprout.snapAt=performance.now();
  if(!outward||s<.5)sprout.snapAt=0;
  const blur=stroke*.72*Math.pow(Math.sin(Math.PI*Math.min(1,s)),.7);
  setGooBlur(sproutInk.filter,blur);
  for(const [key,value] of Object.entries({x:C[0]-100,y:C[1]-100,width:200,height:200}))uiMotion.attr(sproutInk.filter,key,n(value));
  if(blur>.3)uiMotion.attr(sproutInk.group,'filter','url(#goo-sprout)');else sproutInk.group.removeAttribute('filter');
}

/* The resting arm is an inset of the notch's own outline round its pocket: a leg along the screen edge, a corner
   concentric with the flare, a leg along the notch's side, at one even gap all the way round, so it follows the
   notch's angle rather than bending tighter than it. It speaks the same goo as the swap (drawPull):
   - out, from the notch opening or closing (or a card widening it): the arm peels out of the flare, joined to it
     by goo while they are close, and sinks back into it the same way;
   - under the pointer: the arm gathers into a bead, which is drawn off the flare along a bowed path on a strand
     that pinches and parts short of the pocket; it swells into the disc there and its glyph swings from the snap.
     Let go, the notch reaches out a strand, draws the drop back and it spreads along the flare into the arm. */
const HOVER_SNAP=.82;
function drawArm(h,i,cx,F,stroke,proportions,mid,filter,group,disc,out,merging,detailRetreat,w,hgt,grown){
  const scale=proportions.scale,R=proportions.disc/2,dir=[Math.cos(mid),Math.sin(mid)],side=i?-1:1,O=[cx,F];
  const gap=stroke/2+5*scale*grown, rho=F-gap, leg=9*scale*grown, arcHalf=rho*Math.PI/4, H=arcHalf+leg;
  // Out of the notch: the contour rises from inside the flare to its place, lengthening as it comes
  const risen=smooth(out), radius=F+stroke*.9+(rho-F-stroke*.9)*(1-Math.pow(1-out,2));
  const contour=(sigma,rad)=>{
    const arc=rad*Math.PI/4, t=Math.max(-arc,Math.min(arc,sigma)), th=mid+side*t/rad;
    const p=[O[0]+rad*Math.cos(th),O[1]+rad*Math.sin(th)], over=Math.abs(sigma)-arc;
    if(over<=0)return p;
    const sg=Math.sign(sigma),tan=[side*sg*-Math.sin(th),side*sg*Math.cos(th)];
    return [p[0]+tan[0]*over,p[1]+tan[1]*over];
  };
  // Under the pointer: gather, then lift off the flare to the pocket's centre along a bowed path. At rest the bead is
  // the arm's own middle, so the arm sits exactly on its inset; the bow only shows once it lifts.
  const gather=smooth(Math.min(1,disc/.42)), lift=smooth(Math.max(0,Math.min(1,(disc-.28)/.72)));
  const len=F+stroke*.3, src=[O[0]+len*dir[0],O[1]+len*dir[1]];
  let perp=[-dir[1],dir[0]];if(perp[1]<0)perp=[-perp[0],-perp[1]];
  const bow=(p0,p1,k)=>{const l=Math.hypot(p1[0]-p0[0],p1[1]-p0[1]);return [(p0[0]+p1[0])/2+perp[0]*l*k,(p0[1]+p1[1])/2+perp[1]*l*k];};
  const quad=(p0,c,p1,t)=>[(1-t)*(1-t)*p0[0]+2*(1-t)*t*c[0]+t*t*p1[0],(1-t)*(1-t)*p0[1]+2*(1-t)*t*c[1]+t*t*p1[1]];
  const mid0=contour(0,radius);
  let bead=quad(mid0,bow(mid0,O,.3),O,lift);
  if(merging&&disc)bead=[src[0]+(bead[0]-src[0])*out,src[1]+(bead[1]-src[1])*out]; // taken back into the flare
  const shift=[bead[0]-mid0[0],bead[1]-mid0[1]], sc=bow(src,bead,.22);
  const at=t=>quad(src,sc,bead,t);
  const along=t=>{const x=2*(1-t)*(sc[0]-src[0])+2*t*(bead[0]-sc[0]),y=2*(1-t)*(sc[1]-src[1])+2*t*(bead[1]-sc[1]),l=Math.hypot(x,y)||1;return [x/l,y/l];};
  const extent=H*(.45+.55*risen)*(1-gather);
  const pts=[];for(let k=0;k<=40;k++){const q=contour(-extent+2*extent*k/40,radius);pts.push(`${k?'L':'M'}${n(q[0]+shift[0])} ${n(q[1]+shift[1])}`);}
  uiMotion.attr(h.ink,'d',pts.join(''));
  const beadR=(stroke*.75+(R-stroke*.75)*smooth(lift))*(merging&&disc?.3+.7*out:1);
  let width=stroke*(1+.5*gather)+(2*beadR-stroke*(1+.5*gather))*smooth(lift);
  if(merging&&!disc)width*=.6+.4*smooth(out/.35);
  // The strand between the flare and the bead: joined while it is drawn off, parting short of the pocket, its tail
  // whipping back; letting go, the notch reaches out for the drop before it is drawn home
  // Taken back (the notch closing, grabbed, or widening round a card), a disc stays joined by a strand that fattens
  // as the notch swallows it, as the swap's old drop does
  const sucked=merging&&disc>.01, returning=h.target===0, joined=sucked||lift<=HOVER_SNAP;
  // One reversible contour: changing the target must not swap the strand's shape mid-frame.
  // The tail gradually shortens all the way to the pocket instead of vanishing before arrival.
  const tip=sucked?1:1-smooth((lift-HOVER_SNAP)/(1-HOVER_SNAP));
  if(!returning&&!joined&&!h.hoverSnapAt&&disc>.5){h.hoverSnapAt=performance.now();swayFor(h);}
  if(returning||lift<.5)h.hoverSnapAt=0;
  if(tip>.02&&lift>.01&&out>.05){
    const thin=sucked?1-.7*out:1-smooth((lift-.25)/(HOVER_SNAP-.25));
    const base=stroke*1.3,pinch=Math.max(.5,stroke*.95*thin),tail=Math.max(.5,stroke*.35);
    const end=tail+(beadR*.78-tail)*tip;
    const half=f=>f<.55?base+(pinch-base)*smooth(f/.55):pinch+(end-pinch)*smooth((f-.55)/.45);
    const left=[],right=[];
    for(let k=0;k<=20;k++){const f=k/20,t=f*tip,q=at(t),g=along(t),hw=half(f);left.push(`${n(q[0]-g[1]*hw)} ${n(q[1]+g[0]*hw)}`);right.push(`${n(q[0]+g[1]*hw)} ${n(q[1]-g[0]*hw)}`);}
    uiMotion.attr(necks[i],'d',`M${left.join('L')}L${right.reverse().join('L')}Z`);
  }
  // Goo: peeling out of or into the flare, and through the lift; nothing at rest
  const peel=stroke*.62*(1-smooth((out-.25)/.6))*smooth(out/.06);
  const blur=Math.max(peel,stroke*.72*Math.pow(Math.sin(Math.PI*lift),.55));
  uiMotion.attr(h.ink,'stroke-width',n(width+blur*.4));
  // The glyph rides the bead at its size, sharpening as it arrives, swinging from the snap
  const [a,b,c,e]=edgeMatrix(notchEdge,w,hgt),du=bead[0]-O[0],dv=bead[1]-O[1];
  h.el.style.setProperty('--glyph-x',`${n(a*du+c*dv)}px`);h.el.style.setProperty('--glyph-y',`${n(b*du+e*dv)}px`);
  h.el.style.setProperty('--swell',n(beadR/R));h.el.style.setProperty('--glyph-blur',n(2.2*(1-smooth(lift/.9))));
  h.el.style.setProperty('--disc-glyph',smooth((lift-.45)/.4)*smooth((detailRetreat-.5)/.5)*smooth(out/.6));
  const since=h.hoverSnapAt?(performance.now()-h.hoverSnapAt)/1000:9;
  h.el.style.setProperty('--sway',since<1.2?`${n(side*14*Math.exp(-since/.26)*Math.sin(2*Math.PI*since/.38))}deg`:'0deg');
  setGooBlur(filter,blur);
  for(const [key,value] of Object.entries({x:cx-100,y:-80,width:200,height:230}))uiMotion.attr(filter,key,value);
  if(blur>.3)uiMotion.attr(group,'filter',`url(#${filter.id})`);else group.removeAttribute('filter');
}
// The swing from the snap outlives the spring that caused it, so it keeps its own frames until it dies away
function swayFor(h){
  uiMotion.cancel(h.swayFrame);
  const step=()=>{drawShape();h.swayFrame=h.hoverSnapAt&&performance.now()-h.hoverSnapAt<1200?uiMotion.frame(step):0;};
  h.swayFrame=uiMotion.frame(step);
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
  uiMotion.attr(shapeSvg,'width',W);uiMotion.attr(shapeSvg,'height',H);
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
    uiMotion.attr(el,'d',d); uiMotion.attr(el,'transform',`matrix(${edgeMatrix(edge,W,H).join(' ')})`);
  };
  // Where the corner is along each edge: at its start (u = 0) or its end
  const atStart={tr:{top:false,right:true},br:{right:false,bottom:false},bl:{bottom:true,left:false},tl:{left:true,top:true}}[corner];
  part(partA,first,before,after,atStart[first]);
  part(partB,second,after,before,atStart[second]);
  armStart.removeAttribute('d'); armEnd.removeAttribute('d');
  for(const el of [...necks,...bands]) el.removeAttribute('d');
  clearSprout();
  const share=Math.min(1,4*Math.min(before,after)/L), blur=D*.22*share*share*(3-2*share);
  const cx=corner==='tr'||corner==='br'?W:0, cy=corner==='br'||corner==='bl'?H:0;
  setGoo(blur,cx-L-120,cy-L-120,2*L+240,2*L+240);
}
function setShapePassage(p,near,transform){ passage=p; cornerNear=near; pillTransform=transform; }

/* Opening: the Mac's unfold spring (response 0.62 s, damping 0.72). The small overshoot is the whole
   effect, the notch swelling a few points past its depth and settling like a body of liquid. The rings
   ride out with it (--open in agent-usage.css), and the arms divide from the flares once it is open. */
function setOpenness(v){ openness=v; document.getElementById('root').style.setProperty('--open',v.toFixed(4)); drawShape(); }
// Monitor transfers discard every arm/open/pocket tween while the renderer's whole surface is masked.
function stowShape(){
  if(typeof notificationRim!=='undefined')notificationRim.clear();
  uiMotion.cancel(openFrame);uiMotion.cancel(armsFrame);openFrame=armsFrame=0;
  openVelocity=openLast=0;armsOut=0;absorbing=false;
  for(const h of handles){
    uiMotion.cancel(h.frame);uiMotion.cancel(h.swapFrame);h.frame=h.swapFrame=0;
    h.value=h.target=h.velocity=0;h.swap=1;h.swapping=false;h.snapAt=0;
    h.el.classList.remove('hover','swapping');
  }
  uiMotion.cancel(sprout.frame);sprout.frame=0;sprout.value=sprout.target=sprout.velocity=0;sprout.snapAt=0;
  setOpenness(0);
}
function openShape(){
  uiMotion.cancel(openFrame); openFrame=0;
  uiMotion.cancel(armsFrame); armsOut=0;
  absorbing=false;
  for(const h of handles){uiMotion.cancel(h.frame);h.frame=0;h.value=0;h.target=0;h.velocity=0;}
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){ armsOut=1; setOpenness(1); return; }
  openVelocity=0; openLast=0; setOpenness(0);
  const omega=2*Math.PI/0.62, zeta=0.72;
  let armsStarted=false;
  const step=now=>{
    const dt=Math.min(.1,(now-(openLast||now-16))/1000); openLast=now;
    const [next,velocity]=uiMotion.spring(openness,openVelocity,1,omega,zeta,dt);openVelocity=velocity;
    if(!armsStarted&&next>.78){ armsStarted=true; moveArms(1,ARM_MOTION.emerge,smooth); }
    if(Math.abs(next-1)<.0015&&Math.abs(openVelocity)<.02){ openFrame=0; setOpenness(1); reportHot(); return; }
    setOpenness(next); openFrame=uiMotion.frame(step);
  };
  openFrame=uiMotion.frame(step);
}
// Arms out to `to` over `seconds`: out easing off as they arrive, back in accelerating as they are taken in
function moveArms(to,seconds,ease=t=>t*t){
  uiMotion.cancel(armsFrame);
  absorbing=to===0;
  if(absorbing) for(const h of handles){uiMotion.cancel(h.frame);h.frame=0;}
  else morphHandles();
  const finish=()=>{
    if(absorbing){for(const h of handles){h.value=0;h.target=0;h.velocity=0;}absorbing=false;}
    morphHandles();drawShape();
  };
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){ armsOut=to;finish();return; }
  const from=armsOut, t0=performance.now();
  const step=now=>{
    const t=Math.min(1,(now-t0)/(seconds*1000)); armsOut=from+(to-from)*ease(t); drawShape();
    armsFrame=t<1?uiMotion.frame(step):0;
    if(t===1) finish();
  };
  armsFrame=uiMotion.frame(step);
}
/* Goo pulled out of the notch. While a pocket changes what it holds, its drop travels a bowed path between the
   pocket and just inside the notch's flare, on a strand of the notch's own ink: wide where it leaves the black,
   pinched in the middle, swelling into the drop. Going out, the strand thins as the drop is drawn away and parts
   short of the pocket; its tail whips back into the notch and the drop coasts home at its own size, the glyph
   swinging from the snap. Coming in, the notch reaches out a strand, takes hold and swallows the drop. */
const PULL_SNAP=.8;
function drawPull(h,i,cx,F,stroke,proportions,mid,filter,group,disc,detailRetreat,w,hgt){
  const s=Math.max(0,Math.min(1,h.swap)),R=proportions.disc/2,dir=[Math.cos(mid),Math.sin(mid)];
  const home=[cx,F],len=F+stroke,src=[cx+len*dir[0],F+len*dir[1]];
  // Bowed away from the screen edge, so the pull reads as a curve rather than a slide
  let perp=[-dir[1],dir[0]];if(perp[1]<0)perp=[-perp[0],-perp[1]];
  const ctl=[(src[0]+home[0])/2+perp[0]*len*.5,(src[1]+home[1])/2+perp[1]*len*.5];
  const at=t=>[(1-t)*(1-t)*src[0]+2*(1-t)*t*ctl[0]+t*t*home[0],(1-t)*(1-t)*src[1]+2*(1-t)*t*ctl[1]+t*t*home[1]];
  const along=t=>{const x=2*(1-t)*(ctl[0]-src[0])+2*t*(home[0]-ctl[0]),y=2*(1-t)*(ctl[1]-src[1])+2*t*(home[1]-ctl[1]),l=Math.hypot(x,y)||1;return [x/l,y/l];};
  const drop=at(s),r=R*(.26+.74*smooth(s));
  uiMotion.attr(h.ink,'d',`M${n(drop[0])} ${n(drop[1])}L${n(drop[0])} ${n(drop[1])}`);
  uiMotion.attr(h.ink,'stroke-width',n(2*r));
  // How far along the path the strand reaches: to the drop while they are joined; after the snap its tail whips
  // back into the notch; coming in, it reaches out from the notch to take the drop
  const outward=h.swapDir>0;let tip=s,joined=s<=PULL_SNAP;
  if(!joined)tip=outward?PULL_SNAP*(1-smooth((s-PULL_SNAP)/.14)):s*smooth((1-s)/(1-PULL_SNAP));
  if(tip>.02){
    const thin=1-smooth((s-.3)/(PULL_SNAP-.3)); // drawn out, the middle thins until it parts
    const base=stroke*1.35,pinch=Math.max(.5,stroke*.95*thin),end=joined?r*.78:Math.max(.5,stroke*.35);
    const half=t=>t<.55?base+(pinch-base)*smooth(t/.55):pinch+(end-pinch)*smooth((t-.55)/.45);
    const left=[],right=[];
    for(let k=0;k<=24;k++){
      const f=k/24,t=f*tip,p=at(t),g=along(t),hw=half(f);
      left.push(`${n(p[0]-g[1]*hw)} ${n(p[1]+g[0]*hw)}`);right.push(`${n(p[0]+g[1]*hw)} ${n(p[1]-g[0]*hw)}`);
    }
    uiMotion.attr(necks[i],'d',`M${left.join('L')}L${right.reverse().join('L')}Z`);
  }
  // The glyph rides the drop at its size, sharpening as it arrives, and swings from the snap until it dies away
  const [a,b,c,e]=edgeMatrix(notchEdge,w,hgt),du=drop[0]-home[0],dv=drop[1]-home[1];
  h.el.style.setProperty('--glyph-x',`${n(a*du+c*dv)}px`);h.el.style.setProperty('--glyph-y',`${n(b*du+e*dv)}px`);
  h.el.style.setProperty('--swell',n(r/R));h.el.style.setProperty('--glyph-blur',n(2.4*(1-smooth(s/.9))));
  h.el.style.setProperty('--disc-glyph',smooth((disc-.65)/.35)*smooth((s-.45)/.4)*smooth((detailRetreat-.5)/.5));
  const since=h.snapAt?(performance.now()-h.snapAt)/1000:0;
  h.el.style.setProperty('--sway',h.snapAt?`${n(21*Math.exp(-since/.28)*Math.sin(2*Math.PI*since/.4))}deg`:'0deg');
  // Liquid through the pull, sharp once the drop is home
  const blur=stroke*.72*Math.pow(Math.sin(Math.PI*s),.7);
  setGooBlur(filter,blur);
  for(const [key,value] of Object.entries({x:cx-100,y:-80,width:200,height:230}))uiMotion.attr(filter,key,value);
  if(blur>.3)uiMotion.attr(group,'filter',`url(#${filter.id})`);else group.removeAttribute('filter');
}

/* Scrolling over a handle changes what it holds: the disc flows back into the notch along the arm's own way
   home, accelerating, then the next one buds out of the flare and settles. `onHome` swaps the glyph while it
   is inside the black. A second scroll mid-swap is ignored rather than queued. */
function swapHandle(i,onHome,onSettled){
  const h=handles[i];
  if(h.swapping)return false;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){onHome();drawShape();onSettled?.();return true;}
  h.swapping=true;uiMotion.cancel(h.swapFrame);
  const leg=(to,seconds,ease,done)=>{
    const from=h.swap,t0=performance.now();
    const step=now=>{const t=Math.min(1,(now-t0)/(seconds*1000));h.swap=from+(to-from)*ease(t);drawShape();
      if(t<1)h.swapFrame=uiMotion.frame(step);else{h.swapFrame=0;done();}};
    h.swapFrame=uiMotion.frame(step);
  };
  // In, accelerating as the notch takes it; out, slow while the goo resists, quick once it gives, easing home. The
  // swing from the snap outlasts the pull a little, then everything is at rest together.
  h.el.classList.add('swapping');h.snapAt=0;h.swapDir=-1;
  // Out in three beats, each where it can be seen: the bulge swells from the flare at once, the drop is drawn out
  // while its strand stretches (the slow part), then after the snap it coasts home. It starts before the old drop
  // is quite swallowed, so the notch never sits still between them.
  const ease=(a,b)=>t=>a+(b-a)*t, outQ=t=>1-(1-t)*(1-t), inOutS=t=>-(Math.cos(Math.PI*t)-1)/2;
  const pullAt=t=>t<.2?ease(0,.3)(outQ(t/.2)):t<.64?ease(.3,PULL_SNAP)(inOutS((t-.2)/.44)):ease(PULL_SNAP,1)(outQ((t-.64)/.36));
  leg(.08,.3,t=>t*t*t,()=>{
    onHome();h.swapDir=1;h.swap=0;
    const t0=performance.now();
    const step=now=>{
      const t=Math.min(1,(now-t0)/580);
      h.swap=pullAt(t);
      if(!h.snapAt&&h.swap>PULL_SNAP)h.snapAt=now;
      drawShape();
      if(t<1||now-h.snapAt<720){h.swapFrame=uiMotion.frame(step);return;}
      h.swap=1;h.swapping=false;h.snapAt=0;h.swapFrame=0;h.el.classList.remove('swapping');
      h.el.style.setProperty('--sway','0deg');h.el.style.setProperty('--swell','1');h.el.style.setProperty('--glyph-blur','0');
      drawShape();morphHandles();onSettled?.();
    };
    h.swapFrame=uiMotion.frame(step);
  });
  return true;
}
new ResizeObserver(()=>drawShape()).observe(pill);
