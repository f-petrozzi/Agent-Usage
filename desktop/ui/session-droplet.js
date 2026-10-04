'use strict';
// A bead drawn from the same black outline, never a second popover or a filter on text.
// Only this small band is blurred; the rest of the viewport stays sharp and inexpensive.
detailSvg.querySelector('defs').insertAdjacentHTML('beforeend',`${gooDefinition('session-drop-goo')}<clipPath id="session-drop-band"><rect/></clipPath>`);
const sessionDropInk=document.createElementNS(SVG_NS,'g');
sessionDropInk.id='session-droplet';sessionDropInk.style.display='none';
sessionDropInk.innerHTML='<path clip-path="url(#session-drop-band)"/><path class="drop-neck"/><ellipse class="drop-bead"/>';
detailSvg.append(sessionDropInk);
const sessionDropFilter=detailSvg.querySelector('#session-drop-goo'),sessionDropClip=detailSvg.querySelector('#session-drop-band rect');
let sessionDrop=null,sessionDropFrame=0;
function clearSessionDroplet(){
  cancelAnimationFrame(sessionDropFrame);sessionDropFrame=0;sessionDrop=null;detailMorphUntil=0;
  sessionDropInk.style.display='none';sessionDropInk.removeAttribute('filter');
}
function startSessionDroplet(){
  clearSessionDroplet();
  if(reducedDetails()||!detailTarget||!detailBox)return;
  const start=performance.now();
  sessionDrop={start,edge:notchEdge};detailMorphUntil=start+300;
  sessionDropFrame=requestAnimationFrame(stepSessionDroplet);
}
function stepSessionDroplet(now){
  sessionDropFrame=0;drawSessionDroplet(now);
  if(sessionDrop)sessionDropFrame=requestAnimationFrame(stepSessionDroplet);
}
function drawSessionDroplet(now){
  if(!sessionDrop)return;
  const progress=(now-sessionDrop.start)/420;
  if(progress>=1||reducedDetails()||!shown||!detailTarget||window.agentTracking||carrying||notchEdge!==sessionDrop.edge){clearSessionDroplet();return;}
  const part=detailPath.rimPart;
  if(!part||detailOpen<.5)return;
  const [u0,u1,depth,radius]=part,extent=edgeIsVertical()?innerWidth:innerHeight;
  // The bead moves with the live edge. Never stretch beyond the screen on a small display.
  const swell=Math.pow(Math.sin(Math.PI*Math.max(0,progress)),1.15);
  const room=Math.max(0,extent-depth-4),pull=Math.min(22,Math.max(0,room-12));
  if(room<14||u1-u0<radius*2+28){sessionDropInk.style.display='none';return;}
  const u=Math.min(u1-radius-15,Math.max(u0+radius+15,u0+(u1-u0)*.72));
  const rx=10.5*swell,ry=12*swell,v=depth-6+pull*swell;
  sessionDropInk.style.display='';
  sessionDropInk.setAttribute('transform',detailPath.getAttribute('transform'));
  sessionDropInk.firstElementChild.setAttribute('d',detailPath.getAttribute('d'));
  for(const [key,value] of Object.entries({x:u-38,y:depth-18,width:76,height:62}))sessionDropClip.setAttribute(key,n(value));
  const neck=sessionDropInk.querySelector('.drop-neck'),bead=sessionDropInk.querySelector('.drop-bead');
  neck.setAttribute('d',`M${n(u-14*swell)} ${n(depth-8)}C${n(u-14*swell)} ${n(depth+8*swell)} ${n(u-4*swell)} ${n(v-ry*.65)} ${n(u-5*swell)} ${n(v)}L${n(u+5*swell)} ${n(v)}C${n(u+4*swell)} ${n(v-ry*.65)} ${n(u+14*swell)} ${n(depth+8*swell)} ${n(u+14*swell)} ${n(depth-8)}Z`);
  for(const [key,value] of Object.entries({cx:u,cy:v,rx,ry}))bead.setAttribute(key,n(value));
  setGooBlur(sessionDropFilter,2.8*swell);
  for(const [key,value] of Object.entries({x:u-46,y:depth-26,width:92,height:80}))sessionDropFilter.setAttribute(key,n(value));
  sessionDropInk.setAttribute('filter','url(#session-drop-goo)');
}
for(const event of ['layout','disappear','monitor_stow','grab'])listen(event,clearSessionDroplet).catch(()=>{});
addEventListener('resize',clearSessionDroplet);
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',clearSessionDroplet);
