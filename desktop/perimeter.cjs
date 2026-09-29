'use strict';
// A pointer crosses a corner through a continuous blend, rather than switching between
// two edge projections at their distance threshold. Points on the bezel retain 1:1 travel.
function pointerPlacement(x,y,width,height){
  x=Math.max(0,Math.min(width,x));y=Math.max(0,Math.min(height,y));
  const right=x>width/2,bottom=y>height/2;
  const horizontal=right?width-x:x, vertical=bottom?height-y:y;
  const difference=horizontal-vertical, span=Math.min(180,Math.max(horizontal,vertical));
  const t=span?Math.min(1,Math.abs(difference)/span):0, blend=t*t*(3-2*t);
  const offset=(difference>=0?horizontal:-vertical)*blend;
  const corner=bottom?(right?width+height:2*width+height):(right?width:0);
  const clockwise=right!==bottom?-offset:offset;
  const total=2*(width+height), position=(corner+clockwise+total)%total;
  if(position<width)return {position,edge:'top',along:position/width};
  if(position<width+height)return {position,edge:'right',along:(position-width)/height};
  if(position<2*width+height)return {position,edge:'bottom',along:(2*width+height-position)/width};
  return {position,edge:'left',along:(total-position)/height};
}
module.exports={pointerPlacement};
