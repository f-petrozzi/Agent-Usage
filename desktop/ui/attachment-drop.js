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
    target.style.setProperty('--drop-open',Math.max(0,Math.min(1.08,amount)).toFixed(4));
    const ring=target.querySelector('.ringwrap'),at=ring.getBoundingClientRect();
    const phase=amount*Math.PI;
    target.style.setProperty('--hole-radius',`${48+Math.sin(phase)*10}% ${52-Math.sin(phase)*10}% 46% 54% / 56% ${43+Math.sin(phase)*12}% 57% 44%`);
    const pull=Math.max(0,Math.min(1,amount));
    document.body.style.setProperty('--gravity-open',String(pull));
    window.agentDropGravity={amount:reduced.matches?0:pull,x:at.left+at.width/2,y:at.top+at.height/2};
    paintAttachmentGravity();
    for(const [cell,offset] of pulls){
      cell.style.setProperty('--pull-x',`${(offset.x*pull*.94).toFixed(3)}px`);cell.style.setProperty('--pull-y',`${(offset.y*pull*.94).toFixed(3)}px`);
      cell.style.setProperty('--pull-scale',String(1-pull*.92));cell.style.setProperty('--pull-opacity',String(1-pull));
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
    [amount,velocity]=uiMotion.spring(amount,velocity,goal,15,.72,dt);
    uiMotion.paint('attachment-gravity',paint,45);
    if(Math.abs(amount-goal)<.002&&Math.abs(velocity)<.02){amount=goal;velocity=0;if(!goal)clear();else uiMotion.paint('attachment-gravity',paint,45);last=0;}
    else frame=uiMotion.frame(tick);
  }
  function animate(value){goal=value;if(reduced.matches){amount=value;velocity=0;if(!value)clear();else paint();return;}if(!frame)frame=uiMotion.frame(tick);}
  function select(cell){
    if(cell===target){animate(1);return;}
    clear();target=cell;const at=cell.querySelector('.ringwrap').getBoundingClientRect();for(const sibling of pill.querySelectorAll('.cell'))if(sibling!==cell){const r=sibling.querySelector('.ringwrap').getBoundingClientRect();pulls.set(sibling,{x:at.left+at.width/2-r.left-r.width/2,y:at.top+at.height/2-r.top-r.height/2});}cell.classList.add('drop-target');well=document.createElement('div');well.className='gravity-well';well.setAttribute('aria-hidden','true');
    well.innerHTML='<i class="gravity-orbit"></i><i class="gravity-orbit"></i><i class="gravity-stream"></i><i class="gravity-stream"></i><i class="gravity-stream"></i>';
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

function paintAttachmentGravity(){
  const group=document.getElementById('shape-gravity'),gravity=window.agentDropGravity;
  if(!group)return;
  if(!gravity||!gravity.amount){group.removeAttribute('transform');return;}
  const point=new DOMPoint(gravity.x,gravity.y).matrixTransform(shapeSvg.getScreenCTM().inverse()),a=gravity.amount;
  const horizontal=notchEdge==='top'||notchEdge==='bottom',sx=1-a*(horizontal?.91:.62),sy=1-a*(horizontal?.62:.91);
  group.setAttribute('transform',`translate(${point.x} ${point.y}) scale(${sx} ${sy}) translate(${-point.x} ${-point.y})`);
}
async function prepareDroppedFiles(account,fileList){
  const list=Array.from(fileList);if(!list.length||list.length>5)throw new Error('Drop up to five files at a time.');
  const files=[];
  for(const file of list){
    if(!file.size||file.size>8*1024*1024)throw new Error('Choose nonempty files up to 8 MB each.');
    const path=window.agentUsage.filePath(file);files.push(path?{path}:{name:file.name,bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});
  }
  // Real files retain their native paths. Browser/virtual images carry bounded bytes.
  if(files.every(file=>file.path))return invoke('prepare_attachments',{account,paths:files.map(file=>file.path)});
  return invoke('prepare_attachments',{account,files});
}
