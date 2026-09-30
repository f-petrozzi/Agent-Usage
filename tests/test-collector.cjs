const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalize}=require('../desktop/collector.cjs');
test('Antigravity retains family, cadence and measured usage instead of becoming Codex',()=>{
  const [a]=normalize({schema:2,generatedAt:1,accounts:[{id:'antigravity',provider:'antigravity',label:'Antigravity',limits:[
    {id:'gemini-weekly',group:'Gemini Models',label:'Weekly',usedPercent:75,windowMins:10080,resetsAt:42},
    {id:'3p-5h',group:'Claude and GPT models',label:'Five hour',usedPercent:0,windowMins:300}
  ]}]});
  assert.equal(a.base,'gemini');assert.match(a.id,/^gemini_/);assert.equal(a.name,'Antigravity');
  assert.deepEqual(a.snap.windows.map(w=>[w.id,w.group,w.used]),[['gemini-weekly','Gemini Models',.75],['3p-5h','Claude and GPT models',0]]);
  assert.equal(a.snap.windows[0].resets_at,42000);assert.equal(a.snap.status,'ok');assert.deepEqual(a.snap.details,[]);
});
test('Unsupported providers are skipped instead of appearing as Codex',()=>{
  assert.deepEqual(normalize({schema:2,accounts:[{provider:'unknown',limits:[]}]}),[]);
});
test('Unavailable Antigravity has no invented quota',()=>{
  const [a]=normalize({schema:2,accounts:[{provider:'antigravity',error:'Sign in',limits:[]}]});
  assert.equal(a.snap.status,'error');assert.deepEqual(a.snap.windows,[]);
});
