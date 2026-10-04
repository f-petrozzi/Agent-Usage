'use strict';
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),directory=path.join(root,'tests');
// Enumerate explicitly so Bash, PowerShell and Node versions run exactly the same files.
const files=fs.readdirSync(directory).filter(file=>/^test-.*\.cjs$/.test(file)).sort().map(file=>path.join(directory,file));
const result=spawnSync(process.execPath,['--test','--test-timeout=45000',...files],{cwd:root,stdio:'inherit'});
if(result.error)console.error(result.error);process.exitCode=result.status===0?0:1;
