"""Recorded field shapes and synthetic local streams. No provider connections."""
import copy
import datetime as dt
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
import agent_usage_service as shared
from agent_usage_live import TURN_SETTLE, codex_result, claude_row
loader = importlib.machinery.SourceFileLoader('usage_live_test', str(ROOT/'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec);loader.exec_module(usage)


class LiveTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory();self.root = Path(self.temp.name)
        self.home = self.root/'profile';self.sessions = self.home/'sessions/2025/01/01';self.sessions.mkdir(parents=True)
        self.service = shared.UsageService(usage, [('b', self.home)], include_agy=False, root=self.root)
        self.path = self.sessions/'rollout-recorded.jsonl'
        self.now = time.time()
        # Exact snake_case shape observed in actual token_count events; values fictional.
        self.rate = {'limit_id':'codex','limit_name':None,'primary':{'used_percent':12.5,'window_minutes':300,'resets_at':int(self.now)+3600},
                     'secondary':{'used_percent':40,'window_minutes':10080,'resets_at':int(self.now)+400000},
                     'credits':{'has_credits':False,'unlimited':False,'balance':'0'},'plan_type':'plus',
                     'individual_limit':None,'spend_control_reached':None,'rate_limit_reached_type':None}
    def tearDown(self): self.temp.cleanup()
    def record(self, rate=None, sampled=None):
        return {'timestamp':dt.datetime.fromtimestamp(sampled or time.time(), dt.timezone.utc).isoformat(),
                'type':'event_msg','payload':{'type':'token_count','rate_limits':rate or self.rate}}
    def append(self, record):
        with self.path.open('a') as handle: handle.write(json.dumps(record)+'\n')
    def test_resumed_old_session_incremental_append_and_partial_record(self):
        self.append(self.record());self.service.local.scan()
        row = self.service.rows['codex:b'];self.assertEqual(row['source'],'live');self.assertEqual(row['origin'],'codex-session')
        stamp = row['sampledAt']
        self.service.local.scan();self.assertEqual(self.service.rows['codex:b']['sampledAt'],stamp)
        rate = copy.deepcopy(self.rate);rate['primary']['used_percent']=35
        line = json.dumps(self.record(rate))
        with self.path.open('a') as handle: handle.write(line[:80])
        self.service.local.scan();self.assertEqual(self.service.rows['codex:b']['sampledAt'],stamp)
        with self.path.open('a') as handle: handle.write(line[80:]+'\n')
        self.service.local.scan();self.assertEqual(self.service.rows['codex:b']['limits'][0]['usedPercent'],35)
    def test_foreign_buckets_missing_limits_old_and_future_events_are_ignored(self):
        self.append(['token_count'])
        self.append({'type':'event_msg','payload':['token_count']})
        self.append(self.record({**self.rate,'limit_id':'premium','primary':None,'secondary':None}))
        self.append(self.record(sampled=time.time()-121))
        self.append(self.record(sampled=time.time()+10))
        self.service.local.scan();self.assertIsNone(self.service.rows['codex:b']['sampledAt'])
    def test_huge_tool_record_and_truncated_replaced_file(self):
        self.append(self.record());self.service.local.scan()
        with self.path.open('a') as handle:handle.write(json.dumps({'type':'response_item','output':'x'*(3*1024*1024)})+'\n')
        rate=copy.deepcopy(self.rate);rate['primary']['used_percent']=60;self.append(self.record(rate))
        self.service.local.scan();self.assertEqual(self.service.rows['codex:b']['limits'][0]['usedPercent'],60)
        self.path.write_text(json.dumps(self.record())+'\n');self.service.local.scan()
        self.assertEqual(self.service.rows['codex:b']['limits'][0]['usedPercent'],12)
    def test_claude_partial_window_keeps_weekly_age_and_rejects_invalid_percentage(self):
        row=claude_row({'five_hour':{'used_percentage':20,'resets_at':self.now+3600},'seven_day':{'used_percentage':30,'resets_at':self.now+300000}})
        self.service.accept('claude',row,self.now-599,source='live',origin='claude-statusline')
        update=claude_row({'five_hour':{'used_percentage':25,'resets_at':self.now+3600}})
        self.service.accept('claude',update,self.now,source='live',origin='claude-runtime')
        row=self.service.rows['claude'];self.assertEqual(row['sampledAt'],self.now-599)
        self.assertEqual(row['limits'][1]['source'],'live')
        self.assertTrue(shared.read_snapshot(self.root/'shared.json',now=self.now+2)['accounts'][1]['stale'])
        for used in (None,True,float('nan'),-1,101):
            with self.assertRaises(ValueError):claude_row({'five_hour':{'used_percentage':used,'resets_at':self.now+3600}})
    def test_claude_completion_coalesces_and_respects_gap_and_live_arrival(self):
        local=self.service.local
        local.observe_sessions([{'provider':'claude','id':'one','state':'busy'}])
        local.observe_sessions([{'provider':'claude','id':'one','state':'idle'}])
        due=local.pending_turn;local.observe_sessions([]);self.assertEqual(local.pending_turn,due)
        self.service.rows['claude']['pollAttemptedAt']=self.now
        self.service.due['claude']=time.monotonic()+1000
        with patch('agent_usage_live.time.time',return_value=self.now+TURN_SETTLE+1):local.finish_turn()
        self.assertGreater(self.service.due['claude']-time.monotonic(),60-TURN_SETTLE-2)
        self.assertIsNone(local.pending_turn)
        local.pending_turn=time.time()-1
        self.service.rows['claude'].update(source='live',receivedAt=time.time())
        previous=self.service.due['claude'];local.finish_turn();self.assertEqual(self.service.due['claude'],previous)
    def test_restart_retains_poll_gap_and_backoff(self):
        self.service.rows['claude'].update(pollAttemptedAt=self.now,pollRetryAt=self.now+1800)
        self.service.save()
        restored=shared.UsageService(usage,[('b',self.home)],include_agy=False,root=self.root);restored.load()
        self.assertGreater(restored.due['claude']-time.monotonic(),1799)
    def test_statusline_wrap_install_missing_fields_and_redraw_do_not_refresh_sample(self):
        script=ROOT/'scripts/agent-usage-claude-statusline'
        env={**os.environ,'AGENT_USAGE_STATE_DIR':str(self.root)}
        settings=self.root/'settings.json';settings.write_text(json.dumps({'other':True,'statusLine':{'type':'command','command':'printf previous','padding':2}}))
        for _ in range(2):subprocess.run([sys.executable,str(script),'--install','--settings',str(settings)],env=env,check=True,capture_output=True)
        saved=json.loads(settings.read_text());self.assertTrue(saved['other']);self.assertEqual(saved['statusLine']['padding'],2)
        payload={'session_id':'fictional','context_window':{'total_output_tokens':10},'rate_limits':{'five_hour':{'used_percentage':40,'resets_at':self.now+3600}}}
        def render(data):return subprocess.run([sys.executable,str(script)],input=json.dumps(data),text=True,env=env,capture_output=True,check=True).stdout
        self.assertEqual(render(payload),'previous')
        live=json.loads((self.root/'claude-live.json').read_text());stamp=live['sampledAt']
        self.assertEqual(render({}),'previous');render(payload)
        self.assertEqual(json.loads((self.root/'claude-live.json').read_text())['sampledAt'],stamp)
        self.service.local.scan();self.assertEqual(self.service.rows['claude']['limits'][0]['usedPercent'],40)
        payload['context_window']['total_output_tokens']+=10;render(payload)
        self.assertGreater(json.loads((self.root/'claude-live.json').read_text())['sampledAt'],stamp)

if __name__=='__main__':unittest.main()
