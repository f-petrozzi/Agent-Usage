'use strict';
// A union of the notch's rounded profiles, clipped inside the screen. The light traces this
// contour by distance, so an expanding or retracting notification cannot rescale its sweep.
const rimGeometry=(()=>{
  const EPS=1e-5,cross=(a,b)=>a[0]*b[1]-a[1]*b[0],sub=(a,b)=>[a[0]-b[0],a[1]-b[1]],mix=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
  const area=p=>p.reduce((n,a,i)=>n+cross(a,p[(i+1)%p.length]),0)/2;
  function profile([u0,u1,depth,r0,f0,r1,f1,base]){
    const factor=r0+r1>u1-u0?(u1-u0)/(r0+r1):1;r0*=factor;r1*=factor;
    f0=Math.min(f0,Math.max(0,depth-r0));f1=Math.min(f1,Math.max(0,depth-r1));
    const points=[[u0-f0,base],[u0-f0,0]];
    const arc=(cx,cy,r,a,b)=>{if(!r){points.push([cx,cy]);return;}for(let i=1;i<=16;i++){const t=a+(b-a)*i/16;points.push([cx+Math.cos(t)*r,cy+Math.sin(t)*r]);}};
    arc(u0-f0,f0,f0,-Math.PI/2,0);points.push([u0,depth-r0]);arc(u0+r0,depth-r0,r0,Math.PI,Math.PI/2);
    points.push([u1-r1,depth]);arc(u1-r1,depth-r1,r1,Math.PI/2,0);points.push([u1,f1]);arc(u1+f1,f1,f1,Math.PI,Math.PI*1.5);
    points.push([u1+f1,base]);return points;
  }
  function clip(points,width,height){
    for(const [axis,limit,sign] of [[0,1,1],[0,width-1,-1],[1,1,1],[1,height-1,-1]]){
      const next=[];for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length],insideA=(a[axis]-limit)*sign>=0,insideB=(b[axis]-limit)*sign>=0;
        if(insideA)next.push(a);if(insideA!==insideB)next.push(mix(a,b,(limit-a[axis])/(b[axis]-a[axis])));
      }points=next;if(!points.length)break;
    }
    points=points.filter((p,i)=>Math.hypot(...sub(p,points[(i+1)%points.length]))>EPS);
    if(area(points)<0)points.reverse();return points;
  }
  function contains(p,points){
    let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[i],b=points[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }return inside;
  }
  const key=p=>p.map(n=>Math.round(n*10000)).join(',');
  function union(polygons){
    const segments=[],seen=new Set();
    for(let own=0;own<polygons.length;own++){
      const points=polygons[own];for(let i=0;i<points.length;i++){
        const a=points[i],b=points[(i+1)%points.length],ab=sub(b,a),length=Math.hypot(...ab),cuts=[0,1];if(length<EPS)continue;
        for(let other=0;other<polygons.length;other++)if(other!==own){
          const poly=polygons[other];for(let j=0;j<poly.length;j++){
            const c=poly[j],d=poly[(j+1)%poly.length];
            if(Math.max(a[0],b[0])+EPS<Math.min(c[0],d[0])||Math.min(a[0],b[0])-EPS>Math.max(c[0],d[0])||Math.max(a[1],b[1])+EPS<Math.min(c[1],d[1])||Math.min(a[1],b[1])-EPS>Math.max(c[1],d[1]))continue;
            const cd=sub(d,c),ac=sub(c,a),den=cross(ab,cd);
            if(Math.abs(den)>EPS){const t=cross(ac,cd)/den,u=cross(ac,ab)/den;if(t>EPS&&t<1-EPS&&u>=-EPS&&u<=1+EPS)cuts.push(t);}
            else if(Math.abs(cross(ac,ab))<EPS){for(const p of [c,d]){const ap=sub(p,a),t=(ap[0]*ab[0]+ap[1]*ab[1])/(length*length);if(t>EPS&&t<1-EPS)cuts.push(t);}}
          }
        }
        cuts.sort((a,b)=>a-b);
        for(let j=1;j<cuts.length;j++){
          if((cuts[j]-cuts[j-1])*length<EPS)continue;
          const first=mix(a,b,cuts[j-1]),last=mix(a,b,cuts[j]),mid=mix(first,last,.5);
          // Probe outward. Coincident bezel edges count as one boundary, interior seams disappear.
          const probe=[mid[0]+ab[1]/length*.001,mid[1]-ab[0]/length*.001];
          if(polygons.some((poly,index)=>index!==own&&contains(probe,poly)))continue;
          const identity=key(first)+'>'+key(last);if(seen.has(identity))continue;seen.add(identity);segments.push([first,last]);
        }
      }
    }
    const starts=new Map();for(const s of segments){const k=key(s[0]);if(!starts.has(k))starts.set(k,[]);starts.get(k).push(s);}
    const unused=new Set(segments),loops=[];
    while(unused.size){
      const first=unused.values().next().value,loop=[first[0]];let current=first,closed=false;
      for(let count=0;count<=segments.length;count++){
        unused.delete(current);loop.push(current[1]);if(key(current[1])===key(loop[0])){closed=true;break;}
        current=starts.get(key(current[1]))?.find(s=>unused.has(s));if(!current)break;
      }
      if(closed&&loop.length>3){loop.pop();loops.push(loop);}
    }
    return loops.sort((a,b)=>Math.abs(area(b))-Math.abs(area(a)))[0]||[];
  }
  function anchor(points,edge,width,height){
    // Start at the middle of the bezel edge, which stays stable while a sliver grows or melts home.
    const axis=['top','bottom'].includes(edge)?1:0,limit=edge==='top'||edge==='left'?1:(axis?height:width)-1;
    const bezel=[];
    for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if(Math.abs(a[axis]-limit)<.01&&Math.abs(b[axis]-limit)<.01)bezel.push(i);}
    if(!bezel.length)return points;
    const along=1-axis,ends=bezel.flatMap(i=>[points[i][along],points[(i+1)%points.length][along]]),middle=(Math.min(...ends)+Math.max(...ends))/2;
    const index=bezel.find(i=>middle>=Math.min(points[i][along],points[(i+1)%points.length][along])-EPS&&middle<=Math.max(points[i][along],points[(i+1)%points.length][along])+EPS);
    const mid=points[index].slice();mid[along]=middle;
    return [mid,...points.slice(index+1),...points.slice(0,index+1)];
  }
  function contour(shapes,edge,width,height){
    const polygons=shapes.map(({part,matrix})=>clip(profile(part).map(([x,y])=>[matrix[0]*x+matrix[2]*y+matrix[4],matrix[1]*x+matrix[3]*y+matrix[5]]),width,height)).filter(p=>p.length>2);
    return anchor(union(polygons),edge,width,height);
  }
  return {contour};
})();
if(typeof module!=='undefined')module.exports=rimGeometry;
