// Run with PLAYWRIGHT_MODULE pointing to an installed Playwright module; frames go to /tmp.
const assert = require('node:assert/strict');
// Real-browser regression checks for corner transport and liquid handles with a stubbed bridge.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('fs'), path = require('path');
const UI = path.resolve(__dirname, '../../desktop/ui');
const OUT = process.argv[2] || '/tmp/agent-usage-motion';
const EDGE = process.argv[3] || 'right', ALONG = Number(process.argv[4] || .5);
fs.mkdirSync(OUT, { recursive: true });
const now = Date.now();
const win = (id, used, h) => ({ id, label: id, used, resets_at: now + h * 3600e3, count: null, derived: false });
const accounts = [
  { id: 'claude', base: 'claude', name: 'Claude', glyph: 'C', snap: { status: 'ok', windows: [win('session', .42, 3), win('seven_day', .71, 90)], fetched_at: now, note: '', details: ['Plan: Max'] } },
  { id: 'codex', base: 'codex', name: 'Codex', glyph: 'Cx', snap: { status: 'ok', windows: [win('primary', .18, 2), win('secondary', .33, 100)], fetched_at: now, note: '', details: [] } },
];
const glyphs = {};
for (const p of ['claude', 'codex']) glyphs[p] = { kind: 'svg', svg: fs.readFileSync(path.join(UI, 'glyphs', p + '.svg'), 'utf8') };
const answers = {
  get_agent_accounts: accounts, get_glyphs: { ...glyphs }, get_ui_flags: { notch_visible: false, notch_on_hover: true, tray_visible: false },
  get_notch_edge: process.env.INITIAL || EDGE, get_state: { sessions: [], agg: 'idle', counts: {}, lang_resolved: 'en', clock_24h: false },
  get_usage: accounts[0].snap, get_codex: accounts[1].snap, get_move_handle: true, get_weekly_ring: 'outside',
  get_color_transition: 'ramp', get_theme_resolved: 'dark', get_update_state: { status: 'current' }, get_notch_slots: [],
  get_activity: [], get_antigravity_prefs: { limit: 'automatic', model: 'gemini' },
};
(async () => {
  const browser = await chromium.launch();
  try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(process.env.DPR || 1) });
  await page.addInitScript(({ answers }) => {
    const listeners = {};window.__calls=[];
    window.agentUsage = {
      invoke: (c,a={}) => { window.__calls.push([c,a]); return Promise.resolve(c in answers ? answers[c] : c.startsWith('get_') ? { status: 'absent', windows: [], fetched_at: 0, note: '' } : null); },
      on: (n, cb) => { (listeners[n] = listeners[n] || []).push(cb); return () => {}; },
    };
    window.__emit = (n, p) => (listeners[n] || []).forEach(cb => cb(p));
  }, { answers });
  const errors=[];page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
  await page.goto('file://' + UI + '/notch.html');
  await page.addStyleTag({ content: 'html{background:linear-gradient(135deg,#5a6f8a,#9aa9bb)}' });
  await page.waitForTimeout(300);
  await page.evaluate(({ EDGE, ALONG }) => {
    __emit('layout', { width: innerWidth, height: innerHeight, scale: 1, edge: EDGE, along: ALONG, visible: true, tracking: false, pinned: false });
    __emit('appear', { edge: EDGE });
  }, { EDGE, ALONG });

  await page.waitForTimeout(1200);
  const sample=async t=>page.evaluate(t=>{
    uiMotion.cancel(frame);frame=0;uiMotion.cancel(armsFrame);armsOut=1;
    window.agentTracking=true;
    position=target=(t+2*(innerWidth+innerHeight))%(2*(innerWidth+innerHeight));
    animate(performance.now());
    return {pass:passage,edge:notchEdge,clip:getComputedStyle(pill).clipPath,
      transforms:[partA,partB].map(p=>p.getAttribute('transform'))};
  },t);
  const cornerFades=new Map();
  await page.addStyleTag({content:'#pill .cell{transition:none!important}'});
  for(const [corner,at] of [['tl',0],['tr',1280],['br',2080],['bl',3360]]){
    for(const direction of [1,-1]){
      for(const offset of [-300,-160,-110,-80,-60,-20,0,20,60,80,110,160,300]){
        const result=await sample(at+direction*offset);
        assert.equal(result.clip,'none');
        const fades=await page.evaluate(()=>[...pill.querySelectorAll('.cell')].map(el=>+getComputedStyle(el).opacity));
        const key=direction+':'+offset;
        if(cornerFades.has(key))for(let i=0;i<fades.length;i++)assert.ok(Math.abs(fades[i]-cornerFades.get(key)[i])<.01,JSON.stringify({corner,direction,offset,fades,expected:cornerFades.get(key)}));
        else cornerFades.set(key,fades);
        if(offset===0)assert.ok(fades.every(opacity=>opacity>.05),'all gauges retain the same visible bend fade at each corner');
        if(!result.pass) assert.deepEqual(result.transforms,[null,null],corner+' leaves no page transform on a straight part');
        else assert.equal(result.pass.corner,corner);
        // Check the actual rendered black behind every visible ring, including those outside the pill.
        const coverage=await page.evaluate(async()=>{
          const clone=shapeSvg.cloneNode(true);
          clone.setAttribute('xmlns','http://www.w3.org/2000/svg');clone.setAttribute('width',innerWidth);clone.setAttribute('height',innerHeight);
          clone.style.overflow='visible';clone.style.fill='#000';
          for(const el of clone.querySelectorAll('.arm,.neck')){el.style.fill='none';el.style.stroke='#000';el.style.strokeLinecap='round';}
          const originalTransform=shapeSvg.style.transform;
          clone.style.transform='none';
          const svg=new XMLSerializer().serializeToString(clone), img=new Image();
          const url='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
          await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url;});
          const canvas=document.createElement('canvas');canvas.width=innerWidth;canvas.height=innerHeight;
          const ctx=canvas.getContext('2d');
          if(originalTransform!=='none'){
            const match=originalTransform.match(/translate\(([-.\d]+)px,\s*([-.\d]+)px\)/);
            if(match)ctx.translate(+match[1],+match[2]);
          }
          ctx.drawImage(img,0,0);
          return [...pill.querySelectorAll('.cell')].filter(el=>+getComputedStyle(el).opacity>.25).map(el=>{
            const r=el.querySelector('.ringwrap').getBoundingClientRect();
            const x=Math.round(r.x+r.width/2),y=Math.round(r.y+r.height/2);
            return {x,y,alpha:ctx.getImageData(x,y,1,1).data[3]};
          });
        });
        for(const ring of coverage)assert.ok(ring.alpha>240,JSON.stringify({corner,direction,offset,ring}));
        await page.screenshot({path:path.join(OUT,`${corner}-${direction}-${offset}.png`)});
      }
    }
  }
  // Hover and reverse both handles on every edge; the disc must align with its HTML glyph.
  for(const t of [640,1680,2720,3760]){
    await sample(t);
    const spacing=await page.evaluate(()=>{
      const r=pill.getBoundingClientRect(),ring=pill.querySelector('.ringwrap').getBoundingClientRect(),num=pill.querySelector('.pct').getBoundingClientRect();
      const horizontal=['top','bottom'].includes(notchEdge);
      return {horizontal,depth:horizontal?r.height:r.width,ring:ring.width,gap:num.y-ring.bottom,padding:horizontal?ring.y-r.y:ring.x-r.x};
    });
    assert.equal(spacing.depth,spacing.horizontal?90:70);assert.equal(spacing.ring,44);assert.equal(spacing.gap,6);assert.equal(spacing.padding,spacing.horizontal?11:13);
    assert.equal(await page.locator('.ctl').count(),0);
    // Reversing hover changes the spring target, never the already-rendered liquid contour.
    const reversals=await page.evaluate(()=>handles.map((h,i)=>{
      const saved={value:h.value,target:h.target,velocity:h.velocity,hoverSnapAt:h.hoverSnapAt};
      const capture=()=>({arm:h.ink.getAttribute('d'),neck:necks[i].getAttribute('d'),width:h.ink.getAttribute('stroke-width'),
        blur:handleFilters[i].querySelector('feGaussianBlur').getAttribute('stdDeviation'),
        x:h.el.style.getPropertyValue('--glyph-x'),y:h.el.style.getPropertyValue('--glyph-y')});
      const samples=[.3,.6,.85,.94,.985].map(value=>{
        h.value=value;h.velocity=1.5;h.target=1;h.hoverSnapAt=performance.now();drawShape();const outward=capture();
        h.target=0;drawShape();return {value,outward,returning:capture()};
      });
      Object.assign(h,saved);uiMotion.cancel(h.swayFrame);h.swayFrame=0;drawShape();return samples;
    }));
    for(const samples of reversals)for(const result of samples){
      assert.deepEqual(result.returning,result.outward,'hover reversal preserves the arm, strand and glyph on every edge');
    }
    for(const which of ['pin','orb']){
      await page.evaluate(which=>setHovered(which),which);await page.waitForTimeout(1600);
      const disc=await page.evaluate(which=>{
        const h=handles.find(h=>h.el.id===(which==='pin'?'pin-handle':which)),p=h.ink.getPointAtLength(h.ink.getTotalLength()/2);
        const at=new DOMPoint(p.x,p.y).matrixTransform(h.ink.getScreenCTM());
        const box=h.el.getBoundingClientRect();
        return {value:h.value,width:+h.ink.getAttribute('stroke-width'),distance:Math.hypot(at.x-box.x-box.width/2,at.y-box.y-box.height/2)};
      },which);
      assert.equal(disc.value,1);assert.ok(Math.abs(disc.width-await page.evaluate(()=>handleMetrics().disc))<.01);assert.ok(disc.distance<.1,JSON.stringify(disc));
      await page.screenshot({path:path.join(OUT,`hover-${t}-${which}.png`)});
      const forming=await page.evaluate(which=>{
        const h=handles.find(h=>h.el.id===(which==='pin'?'pin-handle':which));h.value=.85;drawShape();
        const p=h.ink.getPointAtLength(h.ink.getTotalLength()/2),at=new DOMPoint(p.x,p.y).matrixTransform(h.ink.getScreenCTM());
        const glyph=h.el.querySelector('.h-glyph').getBoundingClientRect();
        return Math.hypot(at.x-glyph.x-glyph.width/2,at.y-glyph.y-glyph.height/2);
      },which);
      assert.ok(forming<.15,'glyph follows its disc during the morph');
      await page.evaluate(()=>setHovered(null));await page.waitForTimeout(1600);
      assert.ok(await page.evaluate(()=>handles.every(h=>h.value===0)));
    }
  }
  // Under the pointer the arm gathers along its groove, then its bead is drawn off the flare to the pocket's centre
  await sample(640);
  const partial=await page.evaluate(()=>{
    const h=handles[1],saved=h.value,box=h.el.getBoundingClientRect();
    const gather=[.1,.2,.3].map(value=>{h.value=value;drawShape();return h.ink.getTotalLength();});
    const lift=[.5,.7,.9,1].map(value=>{h.value=value;drawShape();const p=h.ink.getPointAtLength(0),q=new DOMPoint(p.x,p.y).matrixTransform(h.ink.getScreenCTM());return Math.hypot(q.x-box.x-box.width/2,q.y-box.y-box.height/2);});
    h.value=saved;drawShape();return {gather,lift};
  });
  assert.ok(partial.gather.every((length,i)=>length>1&&(!i||length<partial.gather[i-1])),'the arm shortens along its groove as it gathers');
  assert.ok(partial.lift.every((distance,i)=>!i||distance<partial.lift[i-1]),'then its bead travels to the pocket centre');
  const emerging=await page.evaluate(()=>{const saved=armsOut;const lengths=[.2,.4,.6,.8].map(out=>{armsOut=out;drawShape();return handles[0].ink.getTotalLength();});armsOut=saved;drawShape();return lengths;});
  assert.ok(emerging.every(length=>length>1),'an emerging arm never waits in a dot stage');
  assert.ok(emerging.every((length,i)=>!i||length>emerging[i-1]),'the emerging contour extends throughout the motion');
  // Compact, tall and long notches scale their arms, discs, glyphs and click targets together.
  for(const t of [640,3760]){
    await sample(t);
    const sizes=await page.evaluate(()=>{
      const saved=pill.style.getPropertyValue('--length');handles[1].el.classList.add('hover');
      const results=[104,186,350].map(length=>{
        pill.style.setProperty('--length',length+'px');handles[1].value=1;drawShape();placeHandles();
        const h=handles[1],box=h.el.getBoundingClientRect(),glyph=getComputedStyle(h.el.querySelector('.h-glyph'));
        const p=h.ink.getPointAtLength(h.ink.getTotalLength()/2),point=new DOMPoint(p.x,p.y).matrixTransform(h.ink.getScreenCTM());
        return {disc:+h.ink.getAttribute('stroke-width'),target:box.width,glyph:parseFloat(glyph.width),centering:Math.hypot(point.x-box.x-box.width/2,point.y-box.y-box.height/2)};
      });
      pill.style.setProperty('--length',saved);handles[1].value=0;handles[1].el.classList.remove('hover');drawShape();placeHandles();return results;
    });
    assert.ok(sizes[0].disc<sizes[1].disc&&sizes[1].disc<sizes[2].disc,'longer notches have proportionally larger buttons');
    for(const size of sizes){assert.ok(size.centering<.1);assert.ok(size.target>size.disc);assert.ok(size.disc>=40,'buttons remain substantial in compact notches');assert.ok(Math.abs(size.glyph/size.disc-23/48)<.002);}
  }
  // Hovering the bottom-right button must leave the opposite arm's rendered pixels untouched.
  await sample(2720);
  const opposite=await page.evaluate(()=>{
    const r=pinHandle.getBoundingClientRect();return {x:Math.floor(r.x-12),y:Math.floor(r.y-12),width:82,height:82};
  });
  const before=await page.screenshot({clip:opposite});
  await page.evaluate(()=>{handles[1].value=.5;drawShape();});
  const after=await page.screenshot({clip:opposite});assert.deepEqual(after,before);
  assert.ok(await page.evaluate(()=>!!necks[1].getAttribute('d')),'hover draws the bead off the flare on a strand');
  await page.evaluate(()=>{handles[1].value=0;drawShape();});
  await page.evaluate(()=>setHovered('pin'));await page.waitForTimeout(1600);
  await page.evaluate(()=>__emit('move_begin'));await page.waitForTimeout(90);
  assert.ok(await page.evaluate(()=>absorbing&&necks.some(n=>n.hasAttribute('d'))));
  await page.screenshot({path:path.join(OUT,'grab-absorb.png')});
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>armsOut===0&&handles.every(h=>h.value===0)));
  await page.evaluate(()=>__emit('move_end'));await page.waitForTimeout(1000);
  await page.evaluate(()=>setHovered('orb'));await page.waitForTimeout(1600);
  await page.evaluate(()=>__emit('disappear'));await page.waitForTimeout(90);
  assert.ok(await page.evaluate(()=>absorbing&&necks.some(n=>n.hasAttribute('d'))));
  assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('root')).translate),'0px');
  await page.screenshot({path:path.join(OUT,'close-absorb.png')});
  await page.waitForTimeout(1600);
  assert.ok(await page.evaluate(()=>armsOut===0&&handles.every(h=>h.value===0)));
  // Interrupted close/open and reduced motion must settle without stale discs or arms.
  await page.evaluate(()=>__emit('appear'));await page.waitForTimeout(100);
  await page.evaluate(()=>__emit('disappear'));await page.waitForTimeout(50);
  await page.evaluate(()=>__emit('appear'));await page.waitForTimeout(1500);
  assert.ok(await page.evaluate(()=>armsOut===1&&openness===1));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>setHovered('pin'));
  assert.equal(await page.evaluate(()=>handles[0].value),1);
  await page.evaluate(()=>__emit('disappear'));
  assert.ok(await page.evaluate(()=>armsOut===0&&handles.every(h=>h.value===0)));
  // A monitor change can resize asynchronously. Never acknowledge the old layout or travel from its position.
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(()=>{
    __emit('layout',{width:1440,height:900,scale:1,edge:'left',along:.3,visible:true,tracking:false,placement:10});
  });
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>shown),false,'destination is prepared hidden');
  assert.equal(await page.evaluate(()=>__calls.filter(c=>c[0]==='monitor_placed').length),0,'wait for the native resize');
  // A second switch supersedes the first while it is still waiting for resize.
  await page.evaluate(()=>__emit('layout',{width:2000,height:1250,scale:1.25,edge:'bottom',along:.65,visible:true,tracking:false,placement:11}));
  await page.setViewportSize({width:1600,height:1000});
  await page.waitForFunction(()=>__calls.some(c=>c[0]==='monitor_placed'));
  assert.deepEqual(await page.evaluate(()=>__calls.filter(c=>c[0]==='monitor_placed')), [['monitor_placed',{placement:11}]],'only the newest destination is acknowledged');
  const destination=await page.evaluate(()=>{const r=pill.getBoundingClientRect(),root=document.getElementById('root').getBoundingClientRect();return {edge:notchEdge,x:r.x-root.x,y:r.y-root.y,w:r.width,h:r.height,pass:passage,shown};});
  assert.equal(destination.edge,'bottom');assert.equal(destination.shown,true);assert.equal(destination.pass,null);
  assert.ok(Math.abs(destination.x+destination.w/2-1600*.65)<1&&Math.abs(destination.y+destination.h-1000)<1,'snapped to the new edge before acknowledgment');
  await page.evaluate(()=>__emit('appear',{edge:'bottom'}));
  const first=await page.locator('#pill').boundingBox();
  assert.ok(Math.abs(first.x+first.width/2-1600*.65)<1&&Math.abs(first.y+first.height-1000)<1,'first visible layout is already in position');
  await page.waitForTimeout(1200);
  const settled=await page.locator('#pill').boundingBox();assert.deepEqual(settled,first,'opening grows at the destination without flying across the screen');
  // Same-sized monitors also complete; no resize event is required.
  await page.evaluate(()=>__emit('layout',{width:2000,height:1250,scale:1.25,edge:'right',along:.5,visible:true,tracking:false,placement:12}));
  await page.waitForFunction(()=>__calls.some(c=>c[0]==='monitor_placed'&&c[1].placement===12));
  assert.equal(await page.evaluate(()=>notchEdge),'right');
  assert.equal(await page.evaluate(()=>frame),0,'no old perimeter motion remains');
  // A hidden right-edge notch spawned under the pointer on the left never opens on the old edge.
  await page.evaluate(()=>__emit('appear',{edge:'right'}));await page.waitForTimeout(1200);
  await page.evaluate(()=>{__emit('disappear');__emit('layout',{width:2000,height:1250,scale:1.25,edge:'left',along:.3,visible:true,tracking:false,placement:13});});
  await page.waitForFunction(()=>__calls.some(c=>c[0]==='monitor_placed'&&c[1].placement===13));
  assert.equal(await page.evaluate(()=>shown),true);assert.equal(await page.evaluate(()=>notchEdge),'left');
  await page.evaluate(()=>__emit('appear',{edge:'left'}));
  assert.equal((await page.locator('#pill').boundingBox()).x,0,'first visible frame spawns on the cursor edge');
  await page.waitForTimeout(1200);
  assert.equal((await page.locator('#pill').boundingBox()).x,0,'no intermediate old-side frame or perimeter travel');
  // Transfer only after the notch and its arms have fully settled, then return to different previous positions.
  let serial=100;
  for(const [edge,along] of [['right',.7],['left',.25],['right',.35],['top',.65],['bottom',.4]]){
    await page.waitForFunction(()=>openness===1&&armsOut===1);
    await page.evaluate(()=>setHovered('pin'));await page.waitForFunction(()=>handles[0].value===1);
    await page.evaluate(()=>document.getElementById('root').style.opacity='0');
    const blank=await page.screenshot();
    await page.evaluate(()=>document.getElementById('root').style.opacity='');
    const token=++serial;
    const cleared=await page.evaluate(token=>{
      __emit('monitor_stow',{placement:token});
      return {opacity:getComputedStyle(document.getElementById('root')).opacity,shown,openness,armsOut,
        frames:[frame,openFrame,armsFrame,...handles.flatMap(h=>[h.frame,h.swapFrame])],values:handles.map(h=>h.value),
        early:__calls.some(c=>c[0]==='monitor_stowed'&&c[1].placement===token)};
    },token);
    assert.equal(cleared.opacity,'0');assert.equal(cleared.shown,false);
    assert.equal(cleared.openness,0);assert.equal(cleared.armsOut,0);
    assert.ok(cleared.frames.every(v=>v===0)&&cleared.values.every(v=>v===0),'settled arms, discs and their tweens are discarded');
    assert.equal(cleared.early,false,'clearing acknowledgment waits for a painted frame');
    assert.deepEqual(await page.screenshot(),blank,'the entire old notch/arm surface is transparent before a native move');
    await page.waitForFunction(token=>__calls.some(c=>c[0]==='monitor_stowed'&&c[1].placement===token),token);
    await page.evaluate(()=>{__emit('appear');__emit('edge_cursor',{edge:'right',perimeter:2400,tracking:true});});
    assert.equal(await page.evaluate(()=>shown),false,'late old-screen events cannot reopen the cleared surface');
    await page.evaluate(({edge,along,token})=>{
      window.__placementFrames=[];window.__sampling=true;
      const sample=()=>{
        const root=document.getElementById('root');
        if(shown&&getComputedStyle(root).opacity==='1'){
          const r=pill.getBoundingClientRect();__placementFrames.push({edge:notchEdge,x:r.x,y:r.y,w:r.width,h:r.height});
        }
        if(__sampling)requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      __emit('layout',{width:2000,height:1250,scale:1.25,edge,along,visible:true,tracking:false,placement:token});
    },{edge,along,token});
    await page.waitForFunction(token=>__calls.some(c=>c[0]==='monitor_placed'&&c[1].placement===token),token);
    await page.waitForTimeout(120);
    const paints=await page.evaluate(()=>{__sampling=false;return __placementFrames;});
    assert.ok(paints.length>=2,'destination has been drawn before native unmasking');
    for(const p of paints){
      assert.equal(p.edge,edge,'every new painted frame belongs to the destination edge');
      if(edge==='left')assert.equal(p.x,0);
      else if(edge==='right')assert.ok(Math.abs(p.x+p.w-1600)<1);
      else if(edge==='top')assert.equal(p.y,0);
      else assert.ok(Math.abs(p.y+p.h-1000)<1);
      assert.ok(Math.abs((['left','right'].includes(edge)?p.y+p.h/2:p.x+p.w/2)-along*(['left','right'].includes(edge)?1000:1600))<1,'no frame at the previous along-edge position');
    }
  }
  assert.deepEqual(errors,[]);
  console.log('Passed: four corners in both directions, visible rings over black, pin/settings morphs on every edge, grab/close absorption, interrupted opening, reduced motion, monitor resize and superseded placement.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
