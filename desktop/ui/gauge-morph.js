'use strict';
// A shared ribbon preserves the reading as a ring unrolls into its corresponding bar.
// Each account owns a spring, so a handoff retracts and arrives concurrently.
const gaugeMorphSvg=document.createElementNS(SVG_NS,'svg');
gaugeMorphSvg.id='gauge-morph';gaugeMorphSvg.setAttribute('aria-hidden','true');
gaugeMorphSvg.innerHTML=`<defs><filter id="ribbon-goo" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
  <feGaussianBlur stdDeviation=".8"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -7.5"/>
</filter><clipPath id="ribbon-ink" clipPathUnits="userSpaceOnUse"><path/><path/><path/></clipPath></defs>`;
document.getElementById('root').append(gaugeMorphSvg);
const gaugeMorphs=new Map();
let gaugeMorphFrame=0,gaugeMorphLast=0;
function gaugeMorphTrack(p){
  const head=headlineOf(p.snap,p.base);
  return head&&head.count==null?[...card.querySelectorAll('.w-track')].find(t=>t.dataset.window===head.id):null;
}
function syncGaugeMorph(instant=false){
  const reduced=reducedDetails(),active=card.classList.contains('show')&&!window.agentTracking&&!carrying&&shown;
  card.querySelectorAll('.morph-track').forEach(t=>t.classList.remove('morph-track'));
  for(const p of providers()){
    const cell=[...pill.querySelectorAll('.cell')].find(c=>c.dataset.p===p.id);
    if(!cell)continue;
    const track=active&&p.id===hoverId?gaugeMorphTrack(p):null;
    let m=gaugeMorphs.get(p.id);
    if(!m&&track){
      const group=document.createElementNS(SVG_NS,'g');
      group.setAttribute('clip-path','url(#ribbon-ink)');
      group.innerHTML='<path class="ribbon-track"/><g filter="url(#ribbon-goo)"><path class="ribbon-fill"/><circle class="ribbon-drop"/></g>';
      gaugeMorphSvg.append(group);
      m={p,cell,group,t:0,v:0,target:0,bar:null};gaugeMorphs.set(p.id,m);
    }
    if(!m)continue;
    m.p=p;m.cell=cell;m.track=track;m.target=track&&!reduced?1:0;
    if(track&&!reduced)track.classList.add('morph-track');
    if(instant||reduced){m.t=m.target;m.v=0;}
  }
  // Removed accounts cannot leave a detached ribbon behind.
  for(const [id,m] of gaugeMorphs)if(!m.cell.isConnected){m.group.remove();gaugeMorphs.delete(id);}
  drawGaugeMorphs();
  if(!gaugeMorphFrame)gaugeMorphFrame=requestAnimationFrame(gaugeMorphStep);
}
function drawGaugeMorphs(){
  const rootBox=document.getElementById('root').getBoundingClientRect();
  gaugeMorphSvg.setAttribute('width',innerWidth);gaugeMorphSvg.setAttribute('height',innerHeight);
  // The ribbon is revealed by the same live ink that grows around the detailed view.
  // Copy full transforms so this remains correct on every edge and during parking.
  [...gaugeMorphSvg.querySelectorAll('#ribbon-ink path')].forEach((clip,i)=>{
    const source=[partA,partB,detailPath][i],matrix=source.getScreenCTM();
    clip.setAttribute('d',source.getAttribute('d')||'');
    if(matrix)clip.setAttribute('transform',`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e-rootBox.left} ${matrix.f-rootBox.top})`);
  });
  for(const m of gaugeMorphs.values()){
    const r=m.cell.querySelector('.ringwrap').getBoundingClientRect();
    if(m.track?.isConnected){
      const b=m.track.getBoundingClientRect();
      m.bar={x:b.left-rootBox.left,y:b.top+b.height/2-rootBox.top,w:b.width};
    }
    const unrolled=m.t>.001&&m.bar&&!reducedDetails();
    const traveling=m.target===0||m.t!==1||detailOpen!==1;
    // Once settled, hand the bar back to normal HTML scrolling and clipping.
    if(m.track?.isConnected)m.track.classList.toggle('morph-track',!!unrolled&&traveling);
    m.group.style.display=unrolled&&traveling?'':'none';
    m.cell.style.setProperty('--gauge-source',unrolled?0:1);
    if(!unrolled)continue;
    const cx=r.left+r.width/2-rootBox.left,cy=r.top+r.height/2-rootBox.top,radius=r.width*25/56;
    const t=Math.max(0,Math.min(1,m.t))*Math.max(0,Math.min(1,detailOpen)),used=Math.max(0,Math.min(1,headlineOf(m.p.snap,m.p.base)?.used||0));
    const point=s=>{
      const angle=-Math.PI/2+2*Math.PI*s;
      // Curl relaxes at both ends. Spring velocity gives the moving ribbon a restrained ripple.
      const wave=Math.sin(Math.PI*s)*Math.sin(2*Math.PI*s+t*3)*Math.sin(Math.PI*t)*Math.max(-7,Math.min(7,m.v*1.2));
      return [cx+(m.bar.x+s*m.bar.w-cx)*t+Math.cos(angle)*radius*(1-t),
        cy+(m.bar.y-cy)*t+Math.sin(angle)*radius*(1-t)+wave];
    };
    const path=end=>Array.from({length:65},(_,i)=>{
      const q=point(end*i/64);return `${i?'L':'M'}${q[0].toFixed(3)},${q[1].toFixed(3)}`;
    }).join(' ');
    m.group.style.opacity=getComputedStyle(m.cell).opacity;
    m.group.querySelector('.ribbon-track').setAttribute('d',path(1));
    const fill=m.group.querySelector('.ribbon-fill');fill.setAttribute('d',path(used));
    const color=tone(used);fill.setAttribute('stroke',color);
    m.group.querySelectorAll('path').forEach(p=>p.setAttribute('stroke-width',String(5*r.width/56*(1-t)+4*t)));
    const drop=m.group.querySelector('.ribbon-drop'),tip=point(used);
    drop.setAttribute('cx',tip[0]);drop.setAttribute('cy',tip[1]);drop.setAttribute('r',String(2+Math.sin(Math.PI*t)*1.6));drop.setAttribute('fill',color);
    fill.style.display=drop.style.display=used>0?'':'none';
  }
}
function gaugeMorphStep(now){
  const dt=Math.min(.032,(now-(gaugeMorphLast||now-16))/1000);gaugeMorphLast=now;
  let moving=false;
  for(const m of gaugeMorphs.values()){
    const omega=m.target?12:15;
    m.v+=(-omega*omega*(m.t-m.target)-2*.8*omega*m.v)*dt;m.t+=m.v*dt;
    if(Math.abs(m.t-m.target)<.001&&Math.abs(m.v)<.015){m.t=m.target;m.v=0;}else moving=true;
  }
  drawGaugeMorphs();
  if(moving){gaugeMorphFrame=requestAnimationFrame(gaugeMorphStep);return;}
  gaugeMorphFrame=0;gaugeMorphLast=0;
}

card.addEventListener('scroll',drawGaugeMorphs,{passive:true});
