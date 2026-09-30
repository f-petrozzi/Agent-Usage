// Rasterize the 2c LLM spark vector independently at each Windows icon size.
// PLAYWRIGHT_MODULE=/path/to/playwright node scripts/build-icons.cjs [/tmp/preview]
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const resources=path.resolve(__dirname,'../desktop/resources');
const out=process.argv[2]||'/tmp/agent-usage-spark-icons';fs.mkdirSync(out,{recursive:true});
const sizes=[16,20,24,32,40,48,64,96,128,256];
function spark(small){
 const ring=small?11:6,glow=small?'':`<filter id="glow" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="4"/></filter>`;
 const star='M128 48 C133 110 146 123 208 128 C146 133 133 146 128 208 C123 146 110 133 48 128 C110 123 123 110 128 48Z';
 return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs>
 <linearGradient id="tile" x2=".7" y2="1"><stop stop-color="#202a36"/><stop offset="1" stop-color="#080c12"/></linearGradient>
 <linearGradient id="ring" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#00ff88"/><stop offset=".5" stop-color="#7affaa"/><stop offset="1" stop-color="#f2ff00"/></linearGradient>
 <linearGradient id="rim" x2="1" y2="1"><stop stop-color="#00ff88"/><stop offset=".4" stop-color="#91ffe8"/><stop offset=".65" stop-color="#37d9ff"/><stop offset="1" stop-color="#f2ff00"/></linearGradient>
 <radialGradient id="spark"><stop stop-color="#fff"/><stop offset="1" stop-color="#d2fff7"/></radialGradient>${glow}</defs>
 <rect x="4" y="4" width="248" height="248" rx="48" fill="url(#tile)"/>
 ${small?'':`<rect x="4.75" y="4.75" width="246.5" height="246.5" rx="47.25" fill="none" stroke="#83d9b9" stroke-opacity=".3" stroke-width="1.5"/>
 <circle cx="128" cy="128" r="100" stroke="url(#ring)" stroke-width="10" fill="none" opacity=".6" filter="url(#glow)"/>`}
 <circle cx="128" cy="128" r="100" stroke="url(#ring)" stroke-width="${ring}" fill="none"/>
 ${small?'':`<path d="${star}" fill="url(#rim)" transform="translate(128 128) scale(1.1) translate(-128 -128)" opacity=".8"/>`}
 <path d="${star}" fill="url(#spark)"${small?'':' stroke="url(#rim)" stroke-width="1.5"'}/></svg>`.replace(/^[ \t]+$/gm,'');
}
(async()=>{
 const browser=await chromium.launch();try{
 const page=await browser.newPage({deviceScaleFactor:1});const blobs=[];
 fs.writeFileSync(path.join(resources,'icon.svg'),spark(false));fs.writeFileSync(path.join(resources,'icon-small.svg'),spark(true));
 for(const size of sizes){
  await page.setViewportSize({width:size,height:size});
  await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(spark(size<=32)).toString('base64')}">`);
  await page.locator('img').evaluate(i=>i.decode());
  blobs.push(await page.screenshot({path:path.join(out,`${size}.png`),omitBackground:true}));
 }
 const head=Buffer.alloc(6+16*sizes.length);head.writeUInt16LE(1,2);head.writeUInt16LE(sizes.length,4);let offset=head.length;
 sizes.forEach((size,i)=>{const e=6+i*16;head[e]=head[e+1]=size%256;head.writeUInt16LE(1,e+4);head.writeUInt16LE(32,e+6);head.writeUInt32LE(blobs[i].length,e+8);head.writeUInt32LE(offset,e+12);offset+=blobs[i].length;});
 const ico=Buffer.concat([head,...blobs]);fs.writeFileSync(path.join(resources,'icon.ico'),ico);
 fs.writeFileSync(path.resolve(__dirname,'../windows/assets/agent-usage.ico'),ico);
 await page.setViewportSize({width:1024,height:1024});
 await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${spark(false)}`);
 const png=await page.screenshot({path:path.join(out,'1024.png'),omitBackground:true});
 for(const target of ['../docs/agent-usage.png','../windows/assets/agent-usage.png'])fs.writeFileSync(path.resolve(__dirname,target),png);
 // Show native pixel sizes on both taskbar colours; no magnification of the small variants.
 await page.setViewportSize({width:800,height:360});
 const strip=colour=>`<div style="background:${colour};display:flex;align-items:center;gap:24px;padding:24px">${sizes.filter(s=>s<=64).map(s=>`<div><img width="${s}" height="${s}" src="data:image/png;base64,${blobs[sizes.indexOf(s)].toString('base64')}"><div style="margin-top:8px;color:#888;font:12px sans-serif">${s}px</div></div>`).join('')}</div>`;
 await page.setContent(`<style>body{margin:0;background:#888}img{display:block}</style>${strip('#202020')}${strip('#eee')}`);await page.screenshot({path:path.join(out,'windows-sizes.png')});
 console.log('Generated PNG-in-ICO entries:',sizes.join(', '));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
