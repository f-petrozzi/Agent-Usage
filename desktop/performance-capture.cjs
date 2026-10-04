'use strict';
// Explicit, bounded Chromium tracing. No prompts, session labels or custom text metrics.
const TRACE_OPTIONS={enable_argument_filter:true,recording_mode:'record-until-full',trace_buffer_size_in_kb:16384,
  included_categories:['toplevel','cc','gpu','input','latencyInfo','renderer.scheduler','benchmark']};
function createPerformanceCapture({tracing,schedule=setTimeout,cancel=clearTimeout,onChange=()=>{}}){
  let state={status:'idle'},timer=null,stopping=null,closed=false;
  const update=value=>{state=value;if(!closed)onChange({...state});};
  async function stop(){
    if(stopping)return stopping;
    if(state.status!=='recording')return null;
    cancel(timer);timer=null;const file=state.file;update({status:'saving',file});
    stopping=tracing.stopRecording(file).then(path=>{update({status:'saved',file:path});return path;},error=>{update({status:'error',message:error.message});throw error;}).finally(()=>{stopping=null;});
    return stopping;
  }
  return {
    get:()=>({...state}),
    async start(file){
      if(closed||['starting','recording','saving'].includes(state.status))throw new Error('A performance recording is already in progress.');
      update({status:'starting',file});
      try{
        await tracing.startRecording(TRACE_OPTIONS);update({status:'recording',file});
        if(closed){await stop();return state;}
        timer=schedule(()=>{void stop().catch(()=>{});},10000);timer.unref?.();return {...state};
      }catch(error){update({status:'error',message:error.message});throw error;}
    },
    stop,
    close(){closed=true;cancel(timer);timer=null;if(state.status==='recording')void stop().catch(()=>{});}
  };
}
module.exports={createPerformanceCapture,TRACE_OPTIONS};
