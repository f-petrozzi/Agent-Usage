'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPerformanceCapture}=require('../desktop/performance-capture.cjs');
test('performance recording is explicit, limited to 10 seconds and 16 MiB, and coalesces stopping',async()=>{
 const calls=[];let callback;
 const capture=createPerformanceCapture({tracing:{startRecording:async options=>calls.push(options),stopRecording:async file=>{calls.push(file);return file;}},schedule:(fn,ms)=>{callback=fn;assert.equal(ms,10000);return 1;},cancel:()=>{}});
 assert.equal(calls.length,0);await capture.start('/tmp/synthetic-trace.json');
 assert.equal(calls[0].enable_argument_filter,true);assert.equal(calls[0].trace_buffer_size_in_kb,16384);assert.equal(calls[0].recording_mode,'record-until-full');
 assert.equal(calls[0].included_categories.includes('*'),false);
 await assert.rejects(capture.start('/tmp/other.json'),/progress/);
 callback();await capture.stop();assert.equal(calls.length,2);assert.equal(capture.get().status,'saved');capture.close();
});
test('failed recording can be retried and close stops an active capture',async()=>{
 let fail=true,stops=0;
 const capture=createPerformanceCapture({tracing:{startRecording:async()=>{if(fail)throw new Error('busy');},stopRecording:async file=>{stops++;return file;}},schedule:()=>1,cancel:()=>{}});
 await assert.rejects(capture.start('/tmp/test.json'),/busy/);assert.equal(capture.get().status,'error');
 fail=false;await capture.start('/tmp/test.json');capture.close();await capture.stop();assert.equal(stops,1);
});
