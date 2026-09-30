// Render the canonical ribbon SVG independently at every Windows icon size.
// PLAYWRIGHT_MODULE=/path/to/playwright node scripts/build-icons.cjs [/tmp/preview]
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const resources=path.resolve(__dirname,'../desktop/resources');
const out=process.argv[2]||'/tmp/agent-usage-ribbon-icons';fs.mkdirSync(out,{recursive:true});
const sizes=[16,20,24,32,40,48,64,96,128,256];
const source=fs.readFileSync(path.join(resources,'icon.svg'),'utf8');
if(/<image\b|data:image|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i.test(source))throw new Error('The icon must contain self-contained vector artwork');
(async()=>{
 const browser=await chromium.launch();try{
 const page=await browser.newPage({deviceScaleFactor:1});const blobs=[];
 // Measure the vector itself; preserve its aspect ratio and optical center.
 await page.setContent(source);
 const bounds=await page.locator('svg').evaluate(svg=>{const b=svg.getBBox();return{x:b.x,y:b.y,width:b.width,height:b.height};});
 const side=Math.max(bounds.width,bounds.height),cx=bounds.x+bounds.width/2,cy=bounds.y+bounds.height/2;
 function framed(size){
  // One clear pixel on all four sides at each native resolution. At 256 px the
  // mark uses 99.2% of the canvas height; its original proportions stay intact.
  const extent=side*size/(size-2);
  const box=[cx-extent/2,cy-extent/2,extent,extent].map(n=>Number(n.toFixed(5))).join(' ');
  return source.replace(/viewBox="[^"]+"/,`viewBox="${box}"`);
 }
 fs.writeFileSync(path.join(resources,'icon.svg'),framed(256));
 fs.writeFileSync(path.join(resources,'icon-small.svg'),framed(16));
 for(const size of sizes){
  await page.setViewportSize({width:size,height:size});
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(framed(size)).toString('base64')}">`);
  await page.locator('img').evaluate(i=>i.decode());
  // Check the rendered alpha, including clipping and antialiasing, rather than
  // assuming that an SVG's viewBox equals its painted bounds.
  const painted=await page.locator('img').evaluate(img=>{
   const size=img.width,canvas=document.createElement('canvas');canvas.width=canvas.height=size;
   const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,size,size);
   const pixels=ctx.getImageData(0,0,size,size).data;
   let left=size,top=size,right=-1,bottom=-1,border=0;
   for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(pixels[(y*size+x)*4+3]){
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    if(x===0||y===0||x===size-1||y===size-1)border++;
   }
   return{left,top,right,bottom,border};
  });
  if(painted.border||painted.right<0)throw new Error(`${size}px icon is empty or touches the crop boundary: ${JSON.stringify(painted)}`);
  if(painted.bottom-painted.top+1<size-4)throw new Error(`${size}px icon has unnecessary vertical padding`);
  blobs.push(await page.screenshot({path:path.join(out,`${size}.png`),omitBackground:true}));
  console.log(`${size}px painted bounds: ${painted.left},${painted.top}–${painted.right},${painted.bottom}; clear border`);
 }
 const head=Buffer.alloc(6+16*sizes.length);head.writeUInt16LE(1,2);head.writeUInt16LE(sizes.length,4);let offset=head.length;
 sizes.forEach((size,i)=>{const e=6+i*16;head[e]=head[e+1]=size%256;head.writeUInt16LE(1,e+4);head.writeUInt16LE(32,e+6);head.writeUInt32LE(blobs[i].length,e+8);head.writeUInt32LE(offset,e+12);offset+=blobs[i].length;});
 const ico=Buffer.concat([head,...blobs]);fs.writeFileSync(path.join(resources,'icon.ico'),ico);
 fs.writeFileSync(path.resolve(__dirname,'../windows/assets/agent-usage.ico'),ico);
 await page.setViewportSize({width:1024,height:1024});
 await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${framed(1024)}`);
 const png=await page.screenshot({path:path.join(out,'1024.png'),omitBackground:true});
 for(const target of ['../docs/agent-usage.png','../windows/assets/agent-usage.png'])fs.writeFileSync(path.resolve(__dirname,target),png);
 // Native Windows sizes on both light and dark taskbar backgrounds.
 await page.setViewportSize({width:800,height:360});
 const strip=colour=>`<div style="background:${colour};display:flex;align-items:center;gap:24px;padding:24px">${sizes.filter(s=>s<=64).map(s=>`<div><img width="${s}" height="${s}" src="data:image/png;base64,${blobs[sizes.indexOf(s)].toString('base64')}"><div style="margin-top:8px;color:#888;font:12px sans-serif">${s}px</div></div>`).join('')}</div>`;
 await page.setContent(`<style>body{margin:0;background:#888}img{display:block}</style>${strip('#202020')}${strip('#eee')}`);await page.screenshot({path:path.join(out,'windows-sizes.png')});
 console.log('Generated PNG-in-ICO entries:',sizes.join(', '));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
