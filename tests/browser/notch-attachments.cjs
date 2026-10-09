'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const UI=path.resolve(__dirname,'../../desktop/ui'),OUT=process.argv[2]||'/tmp/agent-usage-drop-browser';fs.mkdirSync(OUT,{recursive:true});
const now=Date.now(),accounts=['codex-a','codex-b','claude','agy'].map((id,i)=>({id,base:id==='agy'?'gemini':id.startsWith('codex')?'codex':'claude',name:['Codex A','Codex B','Claude','AGY'][i],originalName:['Codex A','Codex B','Claude','AGY'][i],glyph:'C',snap:{status:'ok',windows:[{id:'session',label:'Five hours',used:.35,resets_at:now+3600e3}],fetched_at:now,details:[],note:''}}));
const glyphs=Object.fromEntries(['codex','claude','gemini'].map(base=>[base,{kind:'svg',svg:fs.readFileSync(path.join(UI,'glyphs',base+'.svg'),'utf8')} ]));
(async()=>{
 const browser=await chromium.launch();try{
  const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(({accounts,glyphs,now})=>{
   const listeners={},calls=[];window.__calls=calls;
   const answers={get_agent_accounts:accounts,get_state:{sessions:[],agg:'idle',counts:{},lang_resolved:'en'},get_activity:[],get_notch_slots:[],get_notch_edge:'top',get_glyphs:glyphs,get_ui_flags:{notch_visible:false,notch_on_hover:true},get_update_state:{status:'current'},get_session_pins:[],get_session_library:['a','b','claude','agy'].map(id=>({id,account:['a','b'].includes(id)?'codex-b':id,provider:id==='claude'?'claude':id==='agy'?'antigravity':'codex',accountName:id==='claude'?'Claude':id==='agy'?'AGY':'Codex B',workspace:'/srv/project',name:'Review '+id,sessionId:id,live:true,canOpen:true}))};
   window.agentUsage={filePath:()=>'/tmp/design.png',invoke:async(c,a)=>{calls.push([c,a]);return c==='deliver_attachments'?{queued:a.queue,copied:!a.queue}:answers[c]??null;},on:(n,cb)=>{(listeners[n]??=[]).push(cb);return()=>{};}};
   window.__emit=(n,p)=>(listeners[n]||[]).forEach(cb=>cb(p));
   window.__drag=(selector,type='dragover')=>{const dt=new DataTransfer();dt.items.add(new File(['design'],'design.png',{type:'image/png'}));document.querySelector(selector).dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:dt}));};
  },{accounts,glyphs,now});
  await page.goto('file://'+UI+'/notch.html');await page.addStyleTag({content:'html{background:#52667d}'});await page.waitForTimeout(400);
  for(const edge of ['top','right','bottom','left']){
   await page.evaluate(edge=>{__emit('layout',{width:innerWidth,height:innerHeight,scale:1,edge,along:.5,visible:true,tracking:false,pinned:false});__emit('appear',{edge});},edge);await page.waitForTimeout(750);
   if(edge==='top'){const r=await page.locator('#pill').boundingBox();await page.screenshot({path:path.join(OUT,'icon-rims.png'),clip:{x:Math.max(0,r.x-85),y:0,width:r.width+170,height:r.height+30}});}
   const originalTargets=await page.locator('.cell').evaluateAll(cells=>cells.map(c=>{const r=c.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round);}));
   await page.evaluate(()=>__drag('.cell[data-p="codex-b"]'));await page.waitForTimeout(160);
   assert.ok(await page.locator('#gravity-ink path').count()>0,'material is deformed as contours');
   const direction=await page.evaluate(()=>{
    const saved=window.agentDropGravity.amount;
    const sample=amount=>{window.agentDropGravity.amount=amount;paintAttachmentGravity();const values=document.querySelector('#gravity-ink path').getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number),m=shapeSvg.getScreenCTM();return Array.from({length:values.length/2},(_,i)=>new DOMPoint(values[i*2],values[i*2+1]).matrixTransform(m));};
    const original=sample(.0000001),depth=p=>notchEdge==='top'?p.y:notchEdge==='bottom'?innerHeight-p.y:notchEdge==='left'?p.x:innerWidth-p.x;
    const lip=original.reduce((best,p,i)=>depth(p)>depth(original[best])?i:best,0),early=sample(.25),late=sample(.8);
    const distance=(points,i)=>Math.hypot(points[i].x-original[i].x,points[i].y-original[i].y);
    window.agentDropGravity.amount=saved;paintAttachmentGravity();return {rearEarly:distance(early,0),lipEarly:distance(early,lip),rearLate:distance(late,0)};
   });
   assert.ok(direction.rearEarly<.1,'the screen boundary stays anchored initially');
   assert.ok(direction.lipEarly>5,'the screen-facing inner lip is absorbed first');
   assert.ok(direction.rearLate>5,'the screen boundary releases later');
   const firstContour=await page.locator('#gravity-ink path').first().getAttribute('d');
   if(edge==='top'){const r=await page.locator('#pill').boundingBox();await page.screenshot({path:path.join(OUT,'gravity-absorbing.png'),clip:{x:Math.max(0,r.x-85),y:0,width:r.width+170,height:r.height+80}});}
   await page.waitForTimeout(300);
   assert.notEqual(await page.locator('#gravity-ink path').first().getAttribute('d'),firstContour,'material flows toward the horizon');
   assert.deepEqual(await page.locator('.cell').evaluateAll(cells=>cells.map(c=>{const r=c.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round);})),originalTargets,'drop hit targets stay fixed');
   assert.equal(await page.locator('.gravity-well').count(),1);assert.equal(await page.locator('.drop-target').getAttribute('data-p'),'codex-b');
   assert.ok(await page.locator('.gravity-well').evaluate(e=>parseFloat(getComputedStyle(e).opacity))>.9);
   assert.ok(await page.locator('.cell[data-p="codex-a"] .ringwrap').evaluate(e=>getComputedStyle(e).transform!=='none'));
   assert.equal(await page.evaluate(()=>__calls.filter(([c])=>c==='prepare_attachments'||c==='deliver_attachments').length),0,'hover never sends or stages');
   await page.screenshot({path:path.join(OUT,edge+'-gravity.png')});
   if(edge==='top'){const r=await page.locator('#pill').boundingBox();await page.screenshot({path:path.join(OUT,'gravity-closeup.png'),clip:{x:Math.max(0,r.x-85),y:0,width:r.width+170,height:r.height+30}});}
   await page.evaluate(()=>document.dispatchEvent(new Event('dragend')));await page.waitForTimeout(700);
   assert.equal(await page.locator('.gravity-well').count(),0);assert.equal(await page.evaluate(()=>window.agentDropActive),false);
   assert.equal(await page.locator('#gravity-ink').count(),0);assert.equal(await page.locator('#shape-body').evaluate(e=>e.style.visibility),'','cancelling restores original contours');
  }
  await page.evaluate(()=>{__drag('.cell[data-p="codex-a"]');__drag('.cell[data-p="claude"]');__drag('.cell[data-p="claude"]','drop');});await page.waitForTimeout(700);
  const prepared=await page.evaluate(()=>__calls.filter(([c])=>c==='prepare_attachments'));assert.equal(prepared.length,1);assert.deepEqual(prepared[0][1],{account:'claude',paths:['/tmp/design.png']});
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>__drag('.cell[data-p="codex-b"]'));
  assert.equal(await page.locator('.gravity-well').evaluate(e=>getComputedStyle(e).opacity),'1');assert.equal(await page.locator('.gravity-stream').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  await page.evaluate(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));assert.equal(await page.locator('.gravity-well').count(),0);
  assert.equal(await page.locator('.gravity-beads').count(),0,'particle animation is removed on cancellation');
  assert.deepEqual(errors,[]);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{window.agentTracking=true;});
  await page.evaluate(preview=>__emit('attachment_draft',{token:'fixture',account:'codex-b',files:[{name:'design.png',size:10,preview}]}),'data:image/png;base64,'+fs.readFileSync(path.resolve(UI,'../../docs/images/agent-identity-glow.png')).toString('base64'));
  await page.evaluate(()=>__emit('release'));
  await page.waitForTimeout(800);
  assert.equal(await page.locator('.attachment-preview').count(),1);assert.equal(await page.locator('.attachment-send').isDisabled(),true,'explicit selection is required');
  assert.equal(await page.locator('.attachment-close').count(),0,'Escape closes the existing frame without extra chrome');
  assert.equal(await page.locator('.session-result').count(),2);assert.equal(await page.locator('.session-filter-row').isVisible(),false);
  await page.locator('.session-open').nth(1).click();await page.locator('.attachment-message').fill('Compare this design');
  await page.screenshot({path:path.join(OUT,'attachment-review-ready.png')});
  await page.locator('.attachment-send').click();
  assert.deepEqual(await page.evaluate(()=>__calls.filter(([c])=>c==='deliver_attachments').at(-1)[1]),{token:'fixture',id:'b',message:'Compare this design',queue:true});
  await page.screenshot({path:path.join(OUT,'attachment-review.png')});
  await page.keyboard.press('Escape');await page.waitForTimeout(650);assert.equal(await page.evaluate(()=>window.attachmentReviewDraft),null);
  await page.evaluate(()=>__emit('attachment_draft',{token:'formats',account:'codex-b',files:[{name:'Budget.xlsx',size:12288},{name:'Proposal.docx',size:204800},{name:'Brief.pdf',size:1456128},{name:'Assets.zip',size:32768},{name:'<img onerror=alert(1)>.txt',size:1024}]}));await page.waitForTimeout(750);
  assert.deepEqual(await page.locator('.attachment-file').evaluateAll(items=>items.map(i=>i.dataset.kind)),['sheet','document','pdf','archive','text']);
  assert.equal(await page.locator('.attachment-file-name').last().innerText(),'<img onerror=alert(1)>.txt');
  assert.equal(await page.locator('.attachment-file-meta').first().innerText(),'Spreadsheet · 12 KB');
  assert.equal(await page.locator('.attachment-preview img').count(),0,'documents use format illustrations, not fabricated contents');
  await page.screenshot({path:path.join(OUT,'attachment-file-types.png')});await page.keyboard.press('Escape');await page.waitForTimeout(650);
  for(const account of ['claude','agy']){
   await page.evaluate(account=>__emit('attachment_draft',{token:account,account,files:[{name:'Notes.docx',size:1024}]}),account);await page.waitForTimeout(750);
   assert.equal(await page.locator('.attachment-send').isVisible(),false);assert.equal(await page.locator('.attachment-copy').isDisabled(),true);
   await page.locator('.session-open').click();await page.locator('.attachment-copy').click();
   assert.deepEqual(await page.evaluate(()=>__calls.filter(([c])=>c==='deliver_attachments').at(-1)[1]),{token:account,id:account,message:'',queue:false});
   assert.equal(await page.locator('.attachment-status').innerText(),'Chat opened. Paste the copied prompt into the chat and send.');
   await page.keyboard.press('Escape');await page.waitForTimeout(650);
  }
  await page.evaluate(()=>requestSessionSwitcher(true));await page.waitForTimeout(700);assert.equal(await page.locator('.session-head>span').innerText(),'Sessions');assert.equal(await page.locator('.session-filter-row').isVisible(),true);await page.keyboard.press('Escape');
  await page.evaluate(()=>__drag('.cell[data-p="codex-a"]'));await page.waitForTimeout(100);await page.evaluate(()=>__emit('disappear'));await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.agentDropActive),false,'hiding never leaves a frozen drag state');assert.equal(await page.locator('#shape-gravity').getAttribute('transform'),null);
  assert.deepEqual(errors,[]);
  console.log('Passed attachment drag targets, four edges, reversal, cancellation, reduced motion, explicit session picker and send.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
