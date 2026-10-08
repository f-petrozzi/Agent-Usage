'use strict';
(()=>{
  let target=null,well=null,amount=0,velocity=0,goal=0,frame=0,last=0,leaveTimer=0,dragTimer=0,nativeAt=0;
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');
  const supported=cell=>cell&&agentAccounts.some(a=>a.id===cell.dataset.p&&['codex','claude','gemini'].includes(a.base));
  const isFiles=event=>Array.from(event.dataTransfer?.types||[]).includes('Files');
  function paint(){
    if(!target)return;
    target.style.setProperty('--drop-open',Math.max(0,Math.min(1.08,amount)).toFixed(4));
    const ring=target.querySelector('.ringwrap'),at=ring.getBoundingClientRect();
    const phase=amount*Math.PI;
    target.style.setProperty('--hole-radius',`${48+Math.sin(phase)*10}% ${52-Math.sin(phase)*10}% 46% 54% / 56% ${43+Math.sin(phase)*12}% 57% 44%`);
    for(const cell of pill.querySelectorAll('.cell')){
      if(cell===target)continue;
      const r=cell.querySelector('.ringwrap').getBoundingClientRect(),dx=at.left-r.left,dy=at.top-r.top,d=Math.hypot(dx,dy)||1;
      cell.style.setProperty('--pull-x',`${(dx/d*amount*8).toFixed(3)}px`);cell.style.setProperty('--pull-y',`${(dy/d*amount*8).toFixed(3)}px`);
    }
  }
  function clear(){
    if(frame)uiMotion.cancel(frame);frame=0;last=0;amount=velocity=0;
    well?.remove();well=null;target?.classList.remove('drop-target');
    for(const cell of pill.querySelectorAll('.cell'))for(const property of ['--drop-open','--pull-x','--pull-y','--hole-radius'])cell.style.removeProperty(property);
    target=null;document.body.classList.remove('drop-hover');window.agentDropActive=false;reportHot();
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
    clear();target=cell;cell.classList.add('drop-target');well=document.createElement('div');well.className='gravity-well';well.setAttribute('aria-hidden','true');
    well.innerHTML='<i class="gravity-orbit"></i><i class="gravity-orbit"></i><i class="gravity-stream"></i><i class="gravity-stream"></i><i class="gravity-stream"></i>';
    const account=agentAccounts.find(a=>a.id===cell.dataset.p),light=window.accountLight(account,agentAccounts);
    well.style.setProperty('--gravity-color',{'codex-a':'#74a9ff','codex-b':'#be99ff',claude:'#d97757',agy:'#7fabfa'}[light]||'#74a9ff');
    cell.querySelector('.ringwrap').append(well);document.body.classList.add('drop-hover');window.agentDropActive=true;
    clearTimeout(showTimer);clearTimeout(hideTimer);clearTimeout(foldTimer);hideCard();animate(1);reportHot();
  }
  function end(){clearTimeout(leaveTimer);clearTimeout(dragTimer);nativeAt=0;invoke('attachment_drag',{on:false}).catch(()=>{});animate(0);}
  document.addEventListener('dragover',event=>{
    if(!isFiles(event))return;
    event.preventDefault();clearTimeout(leaveTimer);clearTimeout(dragTimer);dragTimer=setTimeout(end,800);
    const cell=event.target.closest?.('.cell');
    if(supported(cell)){event.dataTransfer.dropEffect='copy';if(Date.now()-nativeAt>400){nativeAt=Date.now();invoke('attachment_drag',{on:true}).catch(()=>{});}select(cell);}
    else{event.dataTransfer.dropEffect='none';end();}
  });
  document.addEventListener('dragleave',event=>{if(!event.relatedTarget)leaveTimer=setTimeout(end,60);});
  document.addEventListener('dragend',end);
  document.addEventListener('drop',async event=>{
    if(!isFiles(event))return;event.preventDefault();
    const cell=event.target.closest?.('.cell'),account=supported(cell)?cell.dataset.p:null;
    end();if(!account)return;
    try{const paths=Array.from(event.dataTransfer.files).map(file=>window.agentUsage.filePath(file));await invoke('prepare_attachments',{account,paths});}
    catch(error){notice(error.message||'The attachment could not be prepared.');}
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape')end();
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='v'){
      const cell=document.activeElement.closest?.('.cell');if(!supported(cell))return;
      event.preventDefault();invoke('paste_attachment',{account:cell.dataset.p}).catch(error=>notice(error.message));
    }
  });
  reduced.addEventListener('change',()=>{if(reduced.matches){if(frame)uiMotion.cancel(frame);frame=0;amount=goal;velocity=0;if(!goal)clear();else paint();}});
  window.addEventListener('blur',end);
})();
