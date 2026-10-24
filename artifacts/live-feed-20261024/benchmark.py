import importlib.machinery,importlib.util,json,os,queue,socket,subprocess,sys,tempfile,threading,time
from pathlib import Path
from http.server import ThreadingHTTPServer
import urllib.request
AU=Path('/mnt/ssd/homelab/projects/orbit-worktrees/helper-195fb996-e811-5d0e-a243-c92ee9e14d70')
ORBIT=Path('/mnt/ssd/homelab/projects/orbit-worktrees/usage-feed-20261024')
sys.path[:0]=[str(AU/'scripts'),str(ORBIT)]
import agent_usage_service as shared
from bridge.usage_source import UsageSource
from bridge.orbit_codex import CodexBridge
from bridge.gateway import handler
loader=importlib.machinery.SourceFileLoader('timing_usage',str(AU/'scripts/agent-usage'));spec=importlib.util.spec_from_loader(loader.name,loader);usage=importlib.util.module_from_spec(spec);loader.exec_module(usage)
result={}
with tempfile.TemporaryDirectory(prefix='usage-benchmark-') as work:
 root=Path(work);state=root/'state';profile=root/'accounts/profiles/b';sessions=profile/'sessions/2025/01/01';sessions.mkdir(parents=True)
 config=root/'claude';config.mkdir();now=time.time()
 native={'rateLimits':{'primary':{'usedPercent':1,'windowDurationMins':300,'resetsAt':int(now)+3600},'secondary':{'usedPercent':2,'windowDurationMins':10080,'resetsAt':int(now)+400000}}}
 service=shared.UsageService(usage,[('b',profile)],include_agy=False,root=state)
 calls=[]
 service.queries={'codex:b':lambda:calls.append('codex') or native,'claude':lambda:calls.append('claude') or {'id':'claude','provider':'claude','label':'Claude','limits':[{'label':'5 hours','windowMins':300,'usedPercent':1,'resetsAt':int(now)+3600},{'label':'Weekly','windowMins':10080,'usedPercent':2,'resetsAt':int(now)+400000}],'sampledAt':time.time()}}
 service.usage.claude_sessions=lambda *a,**kw:[]
 thread=threading.Thread(target=service.run);thread.start()
 deadline=time.monotonic()+3
 while not (state/'updates.sock').exists() and time.monotonic()<deadline:time.sleep(.01)
 env={**os.environ,'AGENT_USAGE_STATE_DIR':str(state),'CODEX_ACCOUNTS_DIR':str(root/'accounts'),'CLAUDE_CONFIG_DIR':str(config)}
 watcher=subprocess.Popen([sys.executable,str(AU/'scripts/agent-usage'),'--watch-sessions','--no-antigravity'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 lines=queue.Queue()
 def stream():
  for line in watcher.stdout:
   try:lines.put((time.time(),json.loads(line).get('usage')))
   except ValueError:pass
 reader=threading.Thread(target=stream,daemon=True);reader.start()
 source=UsageSource(state)
 bridge=CodexBridge({'a':root/'a','b':profile},'/unused','/unused',root,root);bridge.usage_source=source
 from types import SimpleNamespace
 server=ThreadingHTTPServer(('127.0.0.1',0),handler(SimpleNamespace(usage=lambda:bridge.usage(include_claude=True)),'https://usage.test','owner@test',images=object(),artifacts=object(),terminal=object()));http=threading.Thread(target=server.serve_forever,daemon=True);http.start()
 def endpoint():
  req=urllib.request.Request(f'http://127.0.0.1:{server.server_port}/api/codex/usage',headers={'Host':'usage.test','Tailscale-User-Login':'owner@test'})
  with urllib.request.urlopen(req) as reply:return json.load(reply)
 def wait_for(ident,percent,start):
  end=time.monotonic()+5
  while time.monotonic()<end:
   row=next((r for r in shared.read_snapshot(state/'shared.json')['accounts'] if r['id']==ident),{})
   if row.get('limits') and row['limits'][0]['usedPercent']==percent:
    cached=time.time()-start
    http_row=next(r for r in endpoint()['accounts'] if r['id']==ident)
    result[ident+':cache_seconds']=round(cached,3);result[ident+':orbit_http_seconds']=round(time.time()-start,3)
    assert http_row['limits'][0]['usedPercent']==percent
    break
   time.sleep(.01)
  else:raise AssertionError('cache did not update')
  while True:
   stamp,data=lines.get(timeout=5)
   if data and any(r['id']==ident and r.get('limits') and r['limits'][0]['usedPercent']==percent for r in data['accounts']):
    result[ident+':stream_seconds']=round(stamp-start,3);break
 try:
  lines.get(timeout=3)
  import datetime as dt
  start=time.time();rate={'limit_id':'codex','primary':{'used_percent':31,'window_minutes':300,'resets_at':int(now)+3600},'secondary':{'used_percent':32,'window_minutes':10080,'resets_at':int(now)+400000}}
  (sessions/'rollout-timing.jsonl').write_text(json.dumps({'timestamp':dt.datetime.fromtimestamp(start,dt.timezone.utc).isoformat(),'type':'event_msg','payload':{'type':'token_count','rate_limits':rate}})+'\n')
  wait_for('codex:b',31,start)
  start=time.time();payload={'session_id':'synthetic','context_window':{'total_output_tokens':20},'rate_limits':{'five_hour':{'used_percentage':41,'resets_at':int(now)+3600},'seven_day':{'used_percentage':42,'resets_at':int(now)+400000}}}
  subprocess.run([sys.executable,str(AU/'scripts/agent-usage-claude-statusline')],input=json.dumps(payload),text=True,env=env,capture_output=True,check=True)
  wait_for('claude',41,start)
  result['claude_terminal']={k:result.pop(k) for k in list(result) if k.startswith('claude:')}
  start=time.time()
  with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
   client.connect(str(state/'updates.sock'));client.sendall(json.dumps({'account':'claude','sampledAt':start,'result':{'five_hour':{'used_percentage':51,'resets_at':int(now)+3600},'seven_day':{'used_percentage':52,'resets_at':int(now)+400000}}}).encode()+b'\n');assert json.loads(client.recv(1024))['accepted']
  wait_for('claude',51,start)
  result['claude_sdk_socket']={k:result.pop(k) for k in list(result) if k.startswith('claude:')}
  result['provider_requests']=0;result['mock_initial_polls']=calls
  print(json.dumps(result,indent=2))
 finally:
  watcher.terminate();watcher.wait(timeout=3);watcher.stdout.close();watcher.stderr.close()
  server.shutdown();server.server_close();http.join();service.stop.set();thread.join(5)
