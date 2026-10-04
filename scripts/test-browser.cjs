'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'tests/browser');
const output=process.env.AGENT_USAGE_BROWSER_OUTPUT||path.join(os.tmpdir(),'agent-usage-browser-checks');
fs.mkdirSync(output,{recursive:true});
const modulePath=process.env.PLAYWRIGHT_MODULE||path.join(directory,'node_modules/playwright');
const files=fs.readdirSync(directory).filter(file=>file.endsWith('.cjs')).sort();let failures=0;
// Run motion checks alone: concurrent Chromium workloads distort compositor timing.
for(const file of files){
 const name=file.slice(0,-4),started=Date.now();
 const result=spawnSync(process.execPath,[path.join(directory,file),path.join(output,name)],{
  cwd:root,env:{...process.env,PLAYWRIGHT_MODULE:modulePath},encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 const log=(result.stdout||'')+(result.stderr||'')+(result.error?String(result.error)+'\n':'');
 fs.writeFileSync(path.join(output,name+'.log'),log);
 process.stdout.write(log);console.log(`${file}: ${result.status===0?'PASS':'FAIL'} (${((Date.now()-started)/1000).toFixed(1)}s)`);
 if(result.status!==0)failures++;
}
console.log(`${files.length-failures}/${files.length} browser suites passed. Artifacts: ${output}`);process.exitCode=failures?1:0;
