// Edge-attached close geometry, interrupted reveal/hide and reduced motion using the owning renderer.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../..'),out=path.resolve(process.argv[2]||fs.mkdtempSync(path.join(os.tmpdir(),'notch-close-')));
fs.mkdirSync(out,{recursive:true});
const preview=path.join(out,'preview.html');
execFileSync('python3',[path.join(root,'scripts/preview-notch-close.py'),preview]);
(async()=>{
 const browser=await chromium.launch();
 try{
  const page=await browser.newPage({viewport:{width:960,height:600}}),errors=[],timings=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto('file://'+preview);await page.waitForTimeout(1500);
  for(const viewport of [{width:960,height:600},{width:390,height:844}]){
   await page.setViewportSize(viewport);
   for(const edge of ['top','right','bottom','left']){
    await page.evaluate(edge=>previewPlace(edge),edge);await page.waitForTimeout(1400);
    await page.evaluate(()=>__emit('disappear'));await page.waitForTimeout(350);
    const partial=await page.evaluate(()=>({openness,translate:getComputedStyle(document.getElementById('root')).translate,d:partA.rimPart[2],edge:notchEdge}));
    assert.ok(partial.openness>0&&partial.openness<1,JSON.stringify(partial));
    assert.equal(partial.translate,'0px','the contour stays attached to its edge');
    assert.ok(partial.d>0&&partial.d<(edge==='top'||edge==='bottom'?90:70));
    await page.screenshot({path:path.join(out,`${viewport.width}-${edge}-closing.png`)});
    const reversal=await page.evaluate(()=>{const before=openness;__emit('appear');return {before,after:openness};});
    assert.equal(reversal.after,reversal.before,'reveal starts at the current contour');
    await page.waitForTimeout(1400);assert.equal(await page.evaluate(()=>openness),1);
    const settled=await page.evaluate(async()=>{const at=performance.now();__emit('disappear');while(openness!==0)await new Promise(requestAnimationFrame);return performance.now()-at;});
    timings.push({width:viewport.width,edge,settled});assert.ok(settled<550,'close finishes within the host grace plus one slow frame');
    assert.ok(await page.evaluate(()=>armsOut===0&&handles.every(h=>h.value===0)));
    await page.evaluate(()=>__emit('appear'));await page.waitForTimeout(50);await page.evaluate(()=>__emit('disappear'));await page.waitForTimeout(50);await page.evaluate(()=>__emit('appear'));await page.waitForTimeout(1400);
    assert.ok(await page.evaluate(()=>openness===1&&armsOut===1));
   }
  }
  // A shortcut can be released at a corner; both page-space parts must also retract.
  for(const at of [0,390,1234,1624]){
   await page.evaluate(at=>{__emit('appear');uiMotion.cancel(frame);frame=0;position=target=at;animate(performance.now());},at);
   await page.waitForTimeout(1400);
   assert.ok(await page.evaluate(()=>!!passage));
   await page.evaluate(()=>__emit('disappear'));await page.waitForTimeout(510);
   assert.equal(await page.evaluate(()=>openness),0);
   const depths=await page.evaluate(()=>[partA,partB].filter(p=>p.hasAttribute('d')).map(p=>p.getBBox().y+p.getBBox().height));
   assert.ok(depths.every(d=>Math.abs(d)<.01),'corner parts have no ink inside the viewport');
  }
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>__emit('disappear'));assert.equal(await page.evaluate(()=>openness),0);
  await page.evaluate(()=>__emit('appear'));assert.equal(await page.evaluate(()=>openness),1);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'timings.json'),JSON.stringify(timings,null,2)+'\n');
  console.log('Passed: edge-attached close on four edges at desktop/phone sizes, reversal without contour reset, rapid reveal/hide and reduced motion.',JSON.stringify(timings));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
