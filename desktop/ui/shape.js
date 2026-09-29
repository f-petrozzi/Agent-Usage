'use strict';
/* The notch's black, drawn as one SVG outline instead of a CSS box with gradient fillets, so its shape can
   move: it wells out of the edge on a spring when it appears, and closes up square into a corner when it
   is carried round one. The #pill box stays for layout and hit testing, transparent; this draws under it.

   The outline is worked out in edge space, u along the screen edge and v in from it, then turned onto the
   edge the notch is on. Measures are the notch's own: 70 deep, 20 round at its far corners, and flares of
   38.7 that meet the screen edge at a tangent (the Mac's NotchLayout). */
const SHAPE={depth:70,flare:38.7,corner:20,bleed:40};
const SVG_NS='http://www.w3.org/2000/svg';
const shapeSvg=document.createElementNS(SVG_NS,'svg');
shapeSvg.id='shape';shapeSvg.setAttribute('aria-hidden','true');
shapeSvg.innerHTML=`<defs><filter id="goo" filterUnits="userSpaceOnUse" x="-400" y="-400" width="2000" height="2000" color-interpolation-filters="sRGB">
  <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="b"/>
  <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -12"/></filter></defs><path/>`;
const shapePath=shapeSvg.querySelector('path'), gooBlur=shapeSvg.querySelector('feGaussianBlur');
pill.before(shapeSvg);

// How far open (0 closed against the edge, 1 open; a spring takes it a little past), and the corner squeeze
let openness=1, openVelocity=0, openFrame=0, openLast=0;
let squeezeLength=null, squeezeNearStart=true, squeezeAmount=0;

function drawShape(){
  const w=pill.offsetWidth, h=pill.offsetHeight;
  if(!w||!h) return;
  const vertical=notchEdge==='left'||notchEdge==='right', L=vertical?h:w;
  const d=Math.max(0,SHAPE.depth*openness), grown=Math.min(1,d/SHAPE.depth), sq=squeezeAmount;
  // Opening, it spreads along the edge a little as well as out from it, so it swells like a drop
  const spread=Math.min(1.02,.75+.25*openness);
  const Ls=(squeezeLength==null?L:Math.min(L,squeezeLength))*spread, u0=(L-Ls)/2, u1=u0+Ls;
  // Squeezed toward a corner the flares draw in and the corner end closes up square, so at the corner itself
  // it is the same box on both edges, round only at its inside corner
  const flare=SHAPE.flare*grown*(1-sq);
  const nearCorner=SHAPE.corner*grown*(1-sq), farCorner=SHAPE.corner*grown;
  const r0=sq>0&&squeezeNearStart?nearCorner:farCorner, r1=sq>0&&!squeezeNearStart?nearCorner:farCorner;
  const b=-SHAPE.bleed, n=v=>+v.toFixed(2);
  shapePath.setAttribute('d',[
    `M${n(u0-flare)} ${b}V0`,
    `A${n(flare)} ${n(flare)} 0 0 1 ${n(u0)} ${n(flare)}`,
    `V${n(d-r0)}A${n(r0)} ${n(r0)} 0 0 0 ${n(u0+r0)} ${n(d)}`,
    `H${n(u1-r1)}A${n(r1)} ${n(r1)} 0 0 0 ${n(u1)} ${n(d-r1)}`,
    `V${n(flare)}A${n(flare)} ${n(flare)} 0 0 1 ${n(u1+flare)} 0V${b}Z`].join(''));
  // Edge space onto the page: u runs down or across, v in from the edge
  const m=notchEdge==='right'?[0,1,-1,0,w,0]:notchEdge==='left'?[0,1,1,0,0,0]:notchEdge==='bottom'?[1,0,0,-1,0,h]:[1,0,0,1,0,0];
  shapePath.setAttribute('transform',`matrix(${m.join(' ')})`);
  shapeSvg.setAttribute('width',w);shapeSvg.setAttribute('height',h);
  // A little goo while it squeezes, so the closing-up reads as liquid; none at rest or in the corner itself
  const goo=sq>0&&sq<1?6*4*sq*(1-sq):0;
  gooBlur.setAttribute('stdDeviation',goo.toFixed(2));
  shapePath.setAttribute('filter',goo>0.3?'url(#goo)':'');
}
function setShapeSqueeze(length,nearStart,amount){ squeezeLength=amount>0?length:null; squeezeNearStart=nearStart; squeezeAmount=amount; }

/* Opening: the Mac's unfold spring (response 0.62 s, damping 0.72). The small overshoot is the whole
   effect, the notch swelling a few points past its depth and settling like a body of liquid. The rings
   ride out with it (--open in agent-usage.css). */
function setOpenness(v){ openness=v; document.getElementById('root').style.setProperty('--open',v.toFixed(4)); drawShape(); }
function openShape(){
  cancelAnimationFrame(openFrame); openFrame=0;
  if(matchMedia('(prefers-reduced-motion: reduce)').matches){ setOpenness(1); return; }
  openVelocity=0; openLast=0; setOpenness(0);
  const omega=2*Math.PI/0.62, zeta=0.72;
  const step=now=>{
    const dt=Math.min(.032,(now-(openLast||now-16))/1000); openLast=now;
    openVelocity+=(-omega*omega*(openness-1)-2*zeta*omega*openVelocity)*dt;
    const next=openness+openVelocity*dt;
    if(Math.abs(next-1)<.0015&&Math.abs(openVelocity)<.02){ openFrame=0; setOpenness(1); reportHot(); return; }
    setOpenness(next); openFrame=requestAnimationFrame(step);
  };
  openFrame=requestAnimationFrame(step);
}
new ResizeObserver(drawShape).observe(pill);
