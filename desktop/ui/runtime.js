'use strict';
// Shared motion contract. Simulation callbacks run before keyed paints; work queued
// by a callback belongs to the next frame. Native CSS/WAAPI animations stay independent.
const uiMotion = (() => {
  /** Exact damped spring, preserving velocity when its target changes.
   * @param {number} x Position
   * @param {number} v Velocity in position units per second
   * @param {number} target
   * @param {number} omega Angular frequency in radians per second
   * @param {number} damping Damping ratio
   * @param {number} elapsed Seconds; suspension resumes with at most 100 ms
   * @returns {[number, number]} Position and velocity
   */
  function spring(x, v, target, omega, damping, elapsed) {
    const dt=Math.max(0,Math.min(.1,elapsed)), y=x-target;
    if(!dt)return [x,v];
    if(damping<1){
      const a=damping*omega,b=omega*Math.sqrt(1-damping*damping),e=Math.exp(-a*dt),c=Math.cos(b*dt),s=Math.sin(b*dt),q=(v+a*y)/b;
      return [target+e*(y*c+q*s),e*(v*c-(a*v+omega*omega*y)/b*s)];
    }
    if(Math.abs(damping-1)<1e-6){const q=v+omega*y,e=Math.exp(-omega*dt);return [target+(y+q*dt)*e,(v-omega*q*dt)*e];}
    const d=Math.sqrt(damping*damping-1),a=-omega*(damping-d),b=-omega*(damping+d),p=(v-b*y)/(a-b),q=y-p;
    return [target+p*Math.exp(a*dt)+q*Math.exp(b*dt),a*p*Math.exp(a*dt)+b*q*Math.exp(b*dt)];
  }
  /** Simulation callbacks use DOMHighResTimeStamp; paint keys identify one surface.
   * @param {(callback: FrameRequestCallback) => number} request
   * @param {(id: number) => void} cancel
   * @param {(error: unknown) => void} failure
   */
  function scheduler(request, cancel, failure=error=>setTimeout(()=>{throw error;})) {
    let next=0,native=0,phase='idle';const callbacks=new Map(),paints=new Map(),deferred=new Map(),painted=new Set();
    const safely=fn=>{try{fn();}catch(error){failure(error);}};
    function tick(now){
      native=0;phase='update';painted.clear();
      for(const [key,job] of deferred)paints.set(key,job);deferred.clear();
      const batch=[...callbacks];
      for(const [id,fn] of batch){if(!callbacks.delete(id))continue;safely(()=>fn(now));}
      phase='paint';
      while(paints.size){
        const [key,job]=[...paints].sort((a,b)=>a[1].order-b[1].order)[0];paints.delete(key);
        if(painted.has(key))continue;painted.add(key);safely(job.fn);
      }
      phase='idle';if((callbacks.size||deferred.size)&&!native)native=request(tick);
    }
    return {
      frame(fn){const id=++next;callbacks.set(id,fn);if(phase==='idle'&&!native)native=request(tick);return id;},
      cancel(id){callbacks.delete(id);if(!callbacks.size&&!deferred.size&&native){cancel(native);native=0;}},
      paint(key,fn,order=20){if(phase==='idle')fn();else (painted.has(key)?deferred:paints).set(key,{fn,order});},
      get pending(){return callbacks.size+deferred.size;},
      get phase(){return phase;}
    };
  }
  // SVG geometry writes are expensive even when Chromium already holds the value.
  function attr(el,name,value){const text=String(value);if(el.getAttribute(name)!==text)el.setAttribute(name,text);}
  const motion=typeof window==='undefined'?{}:scheduler(window.requestAnimationFrame.bind(window),window.cancelAnimationFrame.bind(window));
  return Object.defineProperties({...motion,spring,scheduler,attr},{pending:{get:()=>motion.pending||0},phase:{get:()=>motion.phase||'idle'}});
})();
if(typeof module!=='undefined')module.exports=uiMotion;
