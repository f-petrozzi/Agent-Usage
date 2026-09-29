'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {pointerPlacement}=require('../desktop/perimeter.cjs');
const W=1280,H=800,total=2*(W+H);
const delta=(a,b)=>((a-b+total*1.5)%total)-total/2;

test('bezel travel remains one pixel of perimeter per pixel of pointer travel',()=>{
  for(let p=0;p<total;p+=7){
    const [x,y]=p<W?[p,0]:p<W+H?[W,p-W]:p<2*W+H?[2*W+H-p,H]:[0,total-p];
    assert.ok(Math.abs(delta(pointerPlacement(x,y,W,H).position,p))<1e-8);
  }
});
test('all four corner boundaries respond continuously in both directions',()=>{
  for(const [cx,cy,corner]of [[0,0,0],[W,0,W],[W,H,W+H],[0,H,2*W+H]]){
    const sx=cx?-1:1,sy=cy?-1:1;
    const points=[];
    for(let i=-60;i<=60;i++)points.push(pointerPlacement(cx+sx*(80+i),cy+sy*(80-i),W,H).position);
    assert.ok(Math.abs(delta(points[60],corner))<1e-8);
    const steps=points.slice(1).map((p,i)=>delta(p,points[i]));
    assert.ok(steps.every(d=>Math.abs(d)<5),'no edge-switch jump');
    assert.ok(steps.every(d=>Math.sign(d)===Math.sign(steps[0])),'no reversal or sticky threshold');
    const small=points[61];assert.ok(Math.abs(delta(small,corner))>0&&Math.abs(delta(small,corner))<1,'fractional control at the corner');
    assert.equal(new Set(points.map(p=>p.toFixed(6))).size,points.length);
  }
});
test('points outside a monitor clamp onto its own border',()=>{
  assert.deepEqual(pointerPlacement(-20,-30,W,H),pointerPlacement(0,0,W,H));
  assert.deepEqual(pointerPlacement(W+30,H+20,W,H),pointerPlacement(W,H,W,H));
});
