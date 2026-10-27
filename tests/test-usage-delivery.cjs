// Synthetic quota changes reach desktop consumers through the session stream without a quota poll.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Collector,SessionFeed}=require('../desktop/collector.cjs');
test('stream delivers successive measured windows without waiting for the refresh timer',async()=>{
 const now=Date.now()/1000;
 const snapshot=used=>({schema:2,source:'shared',accounts:[{id:'codex:a',provider:'codex',sampledAt:now,receivedAt:now,source:'live',origin:'codex-runtime',limits:[{usedPercent:used,windowMins:300,sampledAt:now,source:'live',origin:'codex-runtime'}]}]});
 const lines=[23,26].map(used=>JSON.stringify({schema:1,sessions:[],usage:snapshot(used)}));
 const script=`const lines=${JSON.stringify(lines)};process.stdout.write(lines[0]+'\\n');setTimeout(()=>process.stdout.write(lines[1]+'\\n'),80);setTimeout(()=>{},10000);`;
 const feed=new SessionFeed(()=>({}),()=>[process.execPath,['-e',script]]),collector=new Collector(()=>({}));
 const values=[],started=Date.now();let polls=0;collector.refresh=()=>polls++;
 feed.on('usage',raw=>collector.acceptSnapshot(raw));
 try{
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(new Error('usage stream delivery timeout')),2000);
   collector.on('change',rows=>{values.push(rows[0].snap.windows[0].used);if(values.length===2){clearTimeout(timeout);resolve();}});
   feed.start();
  });
  assert.deepEqual(values,[.23,.26]);assert.equal(polls,0);assert.ok(Date.now()-started<1500);
  assert.equal(collector.accounts[0].snap.windows[0].sampled_at,now*1000);
 }finally{feed.close();collector.close();}
});
