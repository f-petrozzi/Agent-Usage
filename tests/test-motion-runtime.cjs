'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {spring,scheduler}=require('../desktop/ui/runtime.js');
test('spring trajectories agree at 60, 120 and 144 Hz, including a reversed target',()=>{
  for(const damping of [.56,.78,1,1.2]){
    const trajectories=[60,120,144].map(hz=>{let x=0,v=0;for(let i=0;i<hz;i++)[x,v]=spring(x,v,i<hz/2?1:0,12,damping,1/hz);return [x,v];});
    for(const [x,v] of trajectories){assert.ok(Math.abs(x-trajectories[0][0])<1e-10);assert.ok(Math.abs(v-trajectories[0][1])<1e-10);}
    const whole=spring(.3,2,1,12,damping,.08);let steps=[.3,2];for(let i=0;i<8;i++)steps=spring(...steps,1,12,damping,.01);
    assert.ok(Math.abs(whole[0]-steps[0])<1e-10);assert.ok(Math.abs(whole[1]-steps[1])<1e-10);
    assert.ok(spring(.3,2,1,12,damping,60).every(Number.isFinite));
  }
});
test('all simulation updates precede one ordered paint; cancellation and next-frame work remain reliable',()=>{
  let callback,requests=0;const result=[];
  const motion=scheduler(fn=>{callback=fn;return ++requests;},()=>{},error=>{throw error;});
  motion.frame(()=>{result.push('first');motion.paint('shape',()=>result.push('shape'),10);motion.frame(()=>result.push('next'));});
  const canceled=motion.frame(()=>result.push('canceled'));motion.cancel(canceled);
  motion.frame(()=>{result.push('second');motion.paint('hot',()=>result.push('hot'),50);motion.paint('shape',()=>result.push('latest shape'),10);});
  assert.equal(requests,1);callback(16);
  assert.deepEqual(result,['first','second','latest shape','hot']);assert.equal(requests,2);callback(32);
  assert.equal(result.at(-1),'next');assert.equal(requests,2);
});

test('a mutation after an earlier paint queues the latest geometry for the next frame',()=>{
 let callback;const result=[];const motion=scheduler(fn=>{callback=fn;return 1;},()=>{},error=>{throw error;});
 motion.frame(()=>{motion.paint('shape',()=>result.push(1),10);motion.paint('late',()=>motion.paint('shape',()=>result.push(2),10),20);});
 callback(16);assert.deepEqual(result,[1]);assert.equal(motion.pending,1);
 callback(32);assert.deepEqual(result,[1,2]);assert.equal(motion.pending,0);
});
