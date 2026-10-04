'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {contour,exposed}=require('../desktop/ui/rim-geometry.js');
const identity=[1,0,0,1,0,0],root={part:[400,650,90,0,0,0,0,-40],matrix:identity};
const area=p=>Math.abs(p.reduce((n,a,i)=>{const b=p[(i+1)%p.length];return n+a[0]*b[1]-a[1]*b[0];},0)/2);
const length=p=>p.reduce((n,a,i)=>n+Math.hypot(a[0]-p[(i+1)%p.length][0],a[1]-p[(i+1)%p.length][1]),0);
test('a single contour closes just inside the bezel and begins at its midpoint',()=>{
 const points=contour([root],'top',1280,800);assert.deepEqual(points[0],[525,1]);assert.equal(area(points),250*89);assert.equal(length(points),2*(250+89));
});
test('overlapping notifications form one outer boundary without an internal horizontal seam',()=>{
 const points=contour([root,{part:[400,550,80,0,0,0,0,-40],matrix:[1,0,0,1,0,70]}],'top',1280,800);
 assert.equal(area(points),250*89+150*60);assert.equal(length(points),2*(250+89)+120);
 for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];assert.ok(!(a[1]===90&&b[1]===90&&Math.min(a[0],b[0])<550),'the overlapped root is never outlined');}
});
test('removing an already absorbed sliver preserves contour length and bezel phase',()=>{
 const plain=contour([root],'top',1280,800),covered=contour([root,{part:[410,530,30,0,0,0,0,-40],matrix:[1,0,0,1,0,50]}],'top',1280,800);
 assert.equal(length(plain),length(covered));assert.equal(area(plain),area(covered));assert.deepEqual(plain[0],covered[0]);
});
test('opening a wider lobe keeps the phase anchored to the whole bezel rather than a split edge',()=>{
 const points=contour([root,{part:[360,700,180,0,0,0,0,-40],matrix:identity}],'top',1280,800);
 assert.deepEqual(points[0],[530,1]);assert.equal(area(points),340*179);
});
test('curved notification retraction retains a finite connected contour on every edge',()=>{
 for(const edge of ['top','right','bottom','left']){
  const matrix=edge==='right'?[0,1,-1,0,1280,0]:edge==='left'?[0,1,1,0,0,0]:edge==='bottom'?[1,0,0,-1,0,800]:identity;
  for(let step=0;step<80;step++){
   const offset=70,sm=matrix.slice();sm[4]+=matrix[2]*offset;sm[5]+=matrix[3]*offset;
   const p=contour([{part:[400,650,90,20,38.7,20,38.7,-40],matrix},{part:[400,540,20+step,20,0,20,0,-40],matrix:sm}],edge,1280,800);
   assert.ok(p.length>3);assert.ok(p.every(([x,y])=>Number.isFinite(x)&&Number.isFinite(y)&&x>=1-1e-5&&x<=1279+1e-5&&y>=1-1e-5&&y<=799+1e-5));
  }
 }
});
test('sliver progress follows its three exposed sides without closing across the notch',()=>{
 const segments=exposed([root,{part:[400,550,80,0,0,0,0,-40],matrix:[1,0,0,1,0,70]}],1,1280,800);
 assert.equal(segments.length,3);
 assert.equal(segments.reduce((sum,[a,b])=>sum+Math.hypot(a[0]-b[0],a[1]-b[1]),0),270);
 assert.deepEqual(segments[0][0],[550,90]);assert.deepEqual(segments.at(-1)[1],[400,90]);
 for(let i=1;i<segments.length;i++)assert.deepEqual(segments[i][0],segments[i-1][1]);
});
test('progress has no visible contour after its sliver is absorbed',()=>{
 assert.deepEqual(exposed([root,{part:[410,530,30,0,0,0,0,-40],matrix:[1,0,0,1,0,50]}],1,1280,800),[]);
});
test('sliver progress stays on the merged boundary on all four screen edges',()=>{
 for(const edge of ['top','right','bottom','left']){
  const matrix=edge==='right'?[0,1,-1,0,1280,0]:edge==='left'?[0,1,1,0,0,0]:edge==='bottom'?[1,0,0,-1,0,800]:identity;
  const sm=matrix.slice();sm[4]+=matrix[2]*70;sm[5]+=matrix[3]*70;
  const shapes=[{part:[400,650,90,20,38.7,20,38.7,-40],matrix},{part:[400,540,80,20,0,20,0,-40],matrix:sm}];
  const perimeter=contour(shapes,edge,1280,800),segments=exposed(shapes,1,1280,800);
  assert.ok(segments.length>3);
  for(let i=1;i<segments.length;i++)assert.ok(Math.hypot(segments[i][0][0]-segments[i-1][1][0],segments[i][0][1]-segments[i-1][1][1])<1e-5);
  for(const [a,b] of segments){
   const mid=[(a[0]+b[0])/2,(a[1]+b[1])/2];
   assert.ok(perimeter.some((p,i)=>{const q=perimeter[(i+1)%perimeter.length],dx=q[0]-p[0],dy=q[1]-p[1],len=Math.hypot(dx,dy);
    return len>0&&Math.abs(dx*(mid[1]-p[1])-dy*(mid[0]-p[0]))/len<1e-5&&mid[0]>=Math.min(p[0],q[0])-1e-5&&mid[0]<=Math.max(p[0],q[0])+1e-5&&mid[1]>=Math.min(p[1],q[1])-1e-5&&mid[1]<=Math.max(p[1],q[1])+1e-5;
   }),'every progress segment lies on the complete silhouette');
  }
 }
});
