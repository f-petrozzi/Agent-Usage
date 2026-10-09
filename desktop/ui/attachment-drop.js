'use strict';
(()=>{
  let target=null,well=null,amount=0,velocity=0,goal=0,frame=0,last=0,leaveTimer=0,dragTimer=0,nativeAt=0,pulls=new Map();
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const supported=cell=>cell&&agentAccounts.some(a=>a.id===cell.dataset.p&&['codex','claude','gemini'].includes(a.base));
  const isFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files')||!!event.dataTransfer?.files?.length;
  function cellAt(event){
    const direct=event.target.closest?.('.cell');if(supported(direct))return direct;
    return [...pill.querySelectorAll('.cell')].find(cell=>{const r=cell.getBoundingClientRect();return event.clientX>=r.left&&event.clientX<=r.right&&event.clientY>=r.top&&event.clientY<=r.bottom;});
  }
  function paint(){
    if(!target)return;
    target.style.setProperty('--drop-open',Math.max(0,Math.min(1,amount*3.4)).toFixed(4));
    const ring=target.querySelector('.ringwrap'),at=ring.getBoundingClientRect();
    const phase=amount*Math.PI;
    target.style.setProperty('--hole-radius',`${48+Math.sin(phase)*10}% ${52-Math.sin(phase)*10}% 46% 54% / 56% ${43+Math.sin(phase)*12}% 57% 44%`);
    const pull=reduced.matches?0:Math.max(0,Math.min(1,amount));
    document.body.style.setProperty('--gravity-open',String(pull));
    window.agentDropGravity={amount:reduced.matches?0:pull,x:at.left+at.width/2,y:at.top+at.height/2};
    paintAttachmentGravity();
    for(const [cell,offset] of pulls){
      const remaining=Math.pow(1-pull,1.6),turn=pull*pull*.85,c=Math.cos(turn),s=Math.sin(turn);
      cell.style.setProperty('--pull-x',`${(offset.x-(offset.x*c-offset.y*s)*remaining).toFixed(3)}px`);cell.style.setProperty('--pull-y',`${(offset.y-(offset.x*s+offset.y*c)*remaining).toFixed(3)}px`);
      cell.style.setProperty('--pull-scale',String(Math.max(.04,remaining)));cell.style.setProperty('--pull-opacity',String(Math.min(1,remaining*5)));
    }
  }
  function clear(){
    if(frame)uiMotion.cancel(frame);frame=0;last=0;amount=velocity=0;
    well?.remove();well=null;target?.classList.remove('drop-target');
    for(const cell of pill.querySelectorAll('.cell'))for(const property of ['--drop-open','--pull-x','--pull-y','--hole-radius','--pull-scale','--pull-opacity'])cell.style.removeProperty(property);
    target=null;pulls.clear();window.agentDropGravity=null;document.body.style.removeProperty('--gravity-open');paintAttachmentGravity();document.body.classList.remove('drop-hover');window.agentDropActive=false;reportHot();
  }
  function tick(now){
    frame=0;const dt=last?(now-last)/1000:1/60;last=now;
    [amount,velocity]=uiMotion.spring(amount,velocity,goal,goal?4.8:15,.95,dt);
    uiMotion.paint('attachment-gravity',paint,45);
    if(Math.abs(amount-goal)<.002&&Math.abs(velocity)<.02){amount=goal;velocity=0;if(!goal)clear();else uiMotion.paint('attachment-gravity',paint,45);last=0;}
    else frame=uiMotion.frame(tick);
  }
  function animate(value){if(goal===value&&!frame&&amount===value)return;goal=value;if(reduced.matches){amount=value;velocity=0;if(!value)clear();else paint();return;}if(!frame)frame=uiMotion.frame(tick);}
  function select(cell){
    if(cell===target){animate(1);return;}
    clear();target=cell;const at=cell.querySelector('.ringwrap').getBoundingClientRect();for(const sibling of pill.querySelectorAll('.cell'))if(sibling!==cell){const r=sibling.querySelector('.ringwrap').getBoundingClientRect();pulls.set(sibling,{x:at.left+at.width/2-r.left-r.width/2,y:at.top+at.height/2-r.top-r.height/2});}cell.classList.add('drop-target');well=document.createElement('div');well.className='gravity-well';well.setAttribute('aria-hidden','true');
    well.innerHTML='<i class="gravity-orbit"></i><i class="gravity-orbit"></i><i class="gravity-stream"></i><i class="gravity-stream"></i><i class="gravity-stream"></i>';
    // A small local filter merges neighboring beads; only transforms animate.
    // Keep its raster bounds independent of the fullscreen transparent window.
    const particles=document.createElementNS(SVG_NS,'svg');particles.classList.add('gravity-particles');particles.setAttribute('viewBox','-50 -50 100 100');
    particles.innerHTML='<defs><filter id="attachment-particle-goo" filterUnits="userSpaceOnUse" x="-50" y="-50" width="100" height="100" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1.4"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -7"/></filter></defs><g filter="url(#attachment-particle-goo)">'+Array.from({length:8},(_,i)=>`<g class="gravity-beads" style="--particle-duration:${2.4+i*.17}s;--particle-delay:${-i*.43}s"><circle cx="${25+i%3*4}" cy="0" r="${2.6+i%3*.6}"/><circle cx="${29+i%3*4}" cy="2" r="1.8"/></g>`).join('')+'</g>';
    well.append(particles);
    const account=agentAccounts.find(a=>a.id===cell.dataset.p),light=window.accountLight(account,agentAccounts);
    well.style.setProperty('--gravity-color',{'codex-a':'#74a9ff','codex-b':'#be99ff',claude:'#d97757',agy:'#7fabfa'}[light]||'#74a9ff');
    cell.querySelector('.ringwrap').append(well);document.body.classList.add('drop-hover');window.agentDropActive=true;
    clearTimeout(showTimer);clearTimeout(hideTimer);clearTimeout(foldTimer);hideCard();animate(1);reportHot();
  }
  function end(){clearTimeout(leaveTimer);clearTimeout(dragTimer);nativeAt=0;invoke('attachment_drag',{on:false}).catch(()=>{});animate(0);}
  function dragOver(event){
    if(!isFiles(event))return;
    event.preventDefault();clearTimeout(leaveTimer);clearTimeout(dragTimer);dragTimer=setTimeout(end,800);
    if(window.attachmentReviewDraft&&card.contains(event.target)){event.dataTransfer.dropEffect=window.attachmentReviewBusy?'none':'copy';return;}
    const cell=cellAt(event);
    if(supported(cell)){event.dataTransfer.dropEffect='copy';if(Date.now()-nativeAt>400){nativeAt=Date.now();invoke('attachment_drag',{on:true}).catch(()=>{});}try{select(cell);}catch(error){clear();end();notice(error.message);}}
    else{event.dataTransfer.dropEffect='none';end();}
  }
  document.addEventListener('dragenter',dragOver);document.addEventListener('dragover',dragOver);
  document.addEventListener('dragleave',event=>{if(!event.relatedTarget)leaveTimer=setTimeout(end,60);});
  document.addEventListener('dragend',end);
  document.addEventListener('drop',async event=>{
    if(!isFiles(event))return;event.preventDefault();
    const cell=cellAt(event)||target,account=window.attachmentReviewDraft&&card.contains(event.target)?window.attachmentReviewDraft.account:supported(cell)?cell.dataset.p:null;
    end();clear();if(!account)return;
    try{await prepareDroppedFiles(account,event.dataTransfer.files);}
    catch(error){notice(error.message||'The attachment could not be prepared.');}
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')end();
    if(window.attachmentReviewDraft)return;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v'){
      const cell=document.querySelector('.cell:hover')||document.activeElement.closest?.('.cell');if(!supported(cell))return;
      event.preventDefault();invoke('paste_attachment',{account:cell.dataset.p}).catch(error=>notice(error.message));
    }
  });
  document.addEventListener('paste',event=>{
    if(!window.attachmentReviewDraft||window.attachmentReviewBusy)return;
    const images=Array.from(event.clipboardData?.files||[]).filter(file=>file.type.startsWith('image/'));if(!images.length)return;
    event.preventDefault();prepareDroppedFiles(window.attachmentReviewDraft.account,images).catch(error=>notice(error.message));
  });
  reduced.addEventListener('change',()=>{if(reduced.matches){if(frame)uiMotion.cancel(frame);frame=0;amount=goal;velocity=0;if(!goal)clear();else paint();}});
  window.agentDropCancel=()=>{end();clear();};
  for(const name of ['disappear','monitor_stow','move_begin'])listen(name,window.agentDropCancel).catch(()=>{});
  window.addEventListener('blur',window.agentDropCancel);
  window.addEventListener('error',window.agentDropCancel);
  window.addEventListener('unhandledrejection',window.agentDropCancel);
})();

// Sample the live contours, then deform their material rather than scaling the box.
// The screen-facing lip falls first, then the anchored screen edge releases.
// The radial gradient stretches a neck while angular motion curves it into the disk.
const gravityContours=new WeakMap();
let gravityInk=null,gravityField=null;
function paintAttachmentGravity(){
  const group=document.getElementById('shape-gravity'),gravity=window.agentDropGravity;
  if(!group)return;
  group.removeAttribute('transform');
  if(!gravity||!gravity.amount){shapeBody.style.removeProperty('visibility');gravityInk?.remove();gravityInk=null;gravityField=null;return;}
  if(gravity.amount>=.999){shapeBody.style.visibility='hidden';gravityInk?.remove();gravityInk=null;return;}
  const svgMatrix=shapeSvg.getScreenCTM();if(!svgMatrix)return;
  const inverse=svgMatrix.inverse(),point=new DOMPoint(gravity.x,gravity.y).matrixTransform(inverse),a=gravity.amount;
  if(!gravityInk){gravityInk=document.createElementNS(SVG_NS,'g');gravityInk.id='gravity-ink';group.append(gravityInk);}
  const contours=[];
  for(const source of shapeBody.querySelectorAll('.part,.neck,.arm,.sprout-neck,.sprout-drop')){
    const d=source.getAttribute('d');if(!d)continue;
    const matrix=source.getScreenCTM();if(!matrix)continue;
    const stroke=source.classList.contains('arm')?Number(source.getAttribute('stroke-width')||0):0;
    const key=d+'|'+[matrix.a,matrix.b,matrix.c,matrix.d,matrix.e,matrix.f,stroke,innerWidth,innerHeight].join(',');
    let contour=gravityContours.get(source);
    if(!contour||contour.key!==key){
      const points=[],locals=[];
      if(!passage&&source===partA&&source.rimPart){
        // Reuse the notch's analytic profile. SVG length queries repeatedly
        // flatten the same arcs and caused a noticeable first-hover hitch.
        const profile=rimGeometry.profile(source.rimPart);
        for(let i=0;i<profile.length;i++){
          const p=profile[i],q=profile[(i+1)%profile.length],steps=Math.max(1,Math.ceil(Math.hypot(q[0]-p[0],q[1]-p[1])/4));
          for(let j=0;j<steps;j++)locals.push({x:p[0]+(q[0]-p[0])*j/steps,y:p[1]+(q[1]-p[1])*j/steps});
        }
        locals.push(locals[0]);
      }else{
        const length=source.getTotalLength(),count=Math.max(16,Math.min(120,Math.ceil(length/4)));
        for(let i=0;i<=count;i++)locals.push(source.getPointAtLength(length*i/count));
      }
      for(const local of locals){
        const screen=new DOMPoint(local.x,local.y).matrixTransform(matrix);
        // Off-screen bleed must stay clipped before being pulled into view.
        points.push(new DOMPoint(Math.max(0,Math.min(innerWidth,screen.x)),Math.max(0,Math.min(innerHeight,screen.y))).matrixTransform(inverse));
      }
      contour={key,points,stroke,closed:/z\s*$/i.test(d)};gravityContours.set(source,contour);
    }
    contours.push(contour);
  }
  const fieldKey=notchEdge+'|'+point.x+','+point.y+'|'+contours.map(c=>c.key).join('|');
  if(gravityField?.key!==fieldKey){
    const radius=Math.max(1,...contours.flatMap(c=>c.points.map(p=>Math.hypot(p.x-point.x,p.y-point.y))));
    const depth=p=>{const s=p.matrixTransform(svgMatrix);return notchEdge==='top'?s.y:notchEdge==='bottom'?innerHeight-s.y:notchEdge==='left'?s.x:innerWidth-s.x;};
    const maxDepth=Math.max(1,...contours.flatMap(c=>c.points.map(depth)));
    gravityField={key:fieldKey,contours:contours.map(c=>c.points.map(p=>{
      const inward=Math.max(0,Math.min(1,depth(p)/maxDepth)),dx=p.x-point.x,dy=p.y-point.y,r=Math.hypot(dx,dy);
      return {r,angle:Math.atan2(dy,dx),delay:.58*Math.pow(1-inward,1.2),arrival:.52+.48*Math.pow(r/radius,.6)};
    }))};
  }
  while(gravityInk.children.length>contours.length)gravityInk.lastChild.remove();
  contours.forEach((contour,i)=>{
    let ink=gravityInk.children[i];if(!ink){ink=document.createElementNS(SVG_NS,'path');gravityInk.append(ink);}
    const warped=gravityField.contours[i].map(p=>{
      // Delay the rear boundary so a visible concave bite travels through the
      // material from the rounded inner lip, rather than peeling the screen line.
      const flow=Math.max(0,(a-p.delay)/(1-p.delay)),t=Math.min(1,flow/p.arrival);
      const distance=p.r*Math.pow(1-t,1.15),angle=p.angle+1.45*t*t;
      return `${(point.x+Math.cos(angle)*distance).toFixed(2)} ${(point.y+Math.sin(angle)*distance).toFixed(2)}`;
    });
    ink.setAttribute('d','M'+warped.join('L')+(contour.closed?'Z':''));
    if(contour.stroke){ink.setAttribute('fill','none');ink.setAttribute('stroke','var(--pill)');ink.setAttribute('stroke-width',String(contour.stroke*Math.max(.05,1-a)));ink.setAttribute('stroke-linecap','round');ink.setAttribute('stroke-linejoin','round');}
  });
  shapeBody.style.visibility='hidden';
  // Once absorbed, leave no material raster or contour work behind the hole.
  gravityInk.style.opacity=String(Math.max(0,Math.min(1,(1-a)*5)));
}
async function prepareDroppedFiles(account,fileList){
  const list=Array.from(fileList);if(!list.length||list.length>5)throw new Error('Drop up to five files at a time.');
  const files=[];
  for(const file of list){
    if(!file.size||file.size>8*1024*1024)throw new Error('Choose nonempty files up to 8 MB each.');
    const path=window.agentUsage.filePath(file);files.push(path?{path}:{name:file.name,bytes:new Uint8Array(await file.arrayBuffer())});
  }
  // Real files retain their native paths. Browser/virtual images carry bounded bytes.
  if(files.every(file=>file.path))return invoke('prepare_attachments',{account,paths:files.map(file=>file.path)});
  return invoke('prepare_attachments',{account,files});
}
