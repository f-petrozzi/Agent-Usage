'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {contour}=require('../desktop/ui/rim-geometry.js');
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
