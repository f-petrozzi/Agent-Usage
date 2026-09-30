const {test}=require('node:test');
const assert=require('node:assert/strict');
const {normalize,enrollAntigravity}=require('../desktop/collector.cjs');
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

test('First Antigravity discovery extends an existing saved selection once',()=>{
  const cfg={slots:[{provider:'codex_a'},{provider:'codex_b'},{provider:'claude'}]};
  const accounts=[{base:'gemini',id:'gemini_agy'}];
  assert.equal(enrollAntigravity(cfg,[]),false);
  assert.equal(enrollAntigravity(cfg,accounts),true);
  assert.equal(cfg.slots.length,4);assert.equal(cfg.slots[3].provider,'gemini_agy');
  cfg.slots.pop(); // Explicitly disabling it later must stick.
  assert.equal(enrollAntigravity(cfg,accounts),false);assert.equal(cfg.slots.length,3);
});
test('Automatic account selection stays automatic when Antigravity arrives',()=>{
  const cfg={slots:[]};
  assert.equal(enrollAntigravity(cfg,[{base:'gemini',id:'gemini_agy'}]),true);
  assert.deepEqual(cfg.slots,[]);
});

test('Claude replaces plan with available resets and preserves expiry',()=>{
  const [a]=normalize({schema:2,accounts:[{provider:'claude',plan:'pro',resetCredits:1,
    resetCreditDetails:[{expiresAt:4070908800,expirationKnown:true}],limits:[]}]});
  assert.equal(a.snap.details[0],'1 reset available');
  assert.match(a.snap.details[1],/^Reset expires /);
  assert.ok(!a.snap.details.includes('pro'));
  const [unknown]=normalize({schema:2,accounts:[{provider:'claude',plan:'pro',resetCredits:null,limits:[]}]});
  assert.deepEqual(unknown.snap.details,[],'unknown reset count is not fabricated');
});
