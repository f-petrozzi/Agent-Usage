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
    const listeners = {};
    window.agentUsage = {
      invoke: c => { return Promise.resolve(c in answers ? answers[c] : c.startsWith('get_') ? { status: 'absent', windows: [], fetched_at: 0, note: '' } : null); },
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
    cancelAnimationFrame(frame);frame=0;cancelAnimationFrame(armsFrame);armsOut=1;
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
    for(const which of ['pin','orb']){
      await page.evaluate(which=>setHovered(which),which);await page.waitForTimeout(1100);
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
      await page.evaluate(()=>setHovered(null));await page.waitForTimeout(1100);
      assert.ok(await page.evaluate(()=>handles.every(h=>h.value===0)));
    }
  }
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
    for(const size of sizes){assert.ok(size.centering<.1);assert.ok(size.target>size.disc);assert.ok(Math.abs(size.glyph/size.disc-18/38)<.002);}
  }
  // Hovering the bottom-right button must leave the opposite arm's rendered pixels untouched.
  await sample(2720);
  const opposite=await page.evaluate(()=>{
    const r=pinHandle.getBoundingClientRect();return {x:Math.floor(r.x-12),y:Math.floor(r.y-12),width:82,height:82};
  });
  const before=await page.screenshot({clip:opposite});
  await page.evaluate(()=>{handles[1].value=.5;drawShape();});
  const after=await page.screenshot({clip:opposite});assert.deepEqual(after,before);
  assert.ok(await page.evaluate(()=>necks[1].getAttribute('d').includes('Q')),'hover pulls a curved neck from the flare');
  await page.evaluate(()=>{handles[1].value=0;drawShape();});
  await page.evaluate(()=>setHovered('pin'));await page.waitForTimeout(1100);
  await page.evaluate(()=>__emit('move_begin'));await page.waitForTimeout(90);
  assert.ok(await page.evaluate(()=>absorbing&&necks.some(n=>n.hasAttribute('d'))));
  await page.screenshot({path:path.join(OUT,'grab-absorb.png')});
  await page.waitForTimeout(200);
  assert.ok(await page.evaluate(()=>armsOut===0&&handles.every(h=>h.value===0)));
  await page.evaluate(()=>__emit('move_end'));await page.waitForTimeout(1000);
  await page.evaluate(()=>setHovered('orb'));await page.waitForTimeout(1100);
  await page.evaluate(()=>__emit('disappear'));await page.waitForTimeout(90);
  assert.ok(await page.evaluate(()=>absorbing&&necks.some(n=>n.hasAttribute('d'))));
  assert.equal(await page.evaluate(()=>getComputedStyle(document.getElementById('root')).translate),'0px');
  await page.screenshot({path:path.join(OUT,'close-absorb.png')});
  await page.waitForTimeout(1100);
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
  assert.deepEqual(errors,[]);
  console.log('Passed: four corners in both directions, visible rings over black, pin/settings morphs on every edge, grab/close absorption, interrupted opening, reduced motion.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});
