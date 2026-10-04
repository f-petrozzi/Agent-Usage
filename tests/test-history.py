"""Saved history survives closed processes and stays scoped to the owning account."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('history_usage', str(Path(__file__).parents[1] / 'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)
ID = '12345678-1234-5678-abcd-123456789012'

class HistoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.now = time.time()
        self.claude = self.root / 'claude'
        self.codex = self.root / 'profile-b'

    def write(self, path, records, age=0):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('\n'.join(json.dumps(r) for r in records) + '\n')
        os.utime(path, (self.now - age, self.now - age))

    def history(self, **kwargs):
        return usage.session_history([('b', self.codex)], self.claude, self.now, include_antigravity=False, **kwargs)

    def test_closed_old_sessions_use_saved_names_and_correct_account_homes(self):
        self.write(self.codex / 'sessions/2025/01/01' / f'rollout-{ID}.jsonl', [
            {'type':'session_meta','payload':{'id':ID,'cwd':'/srv/project'}},
            {'type':'response_item','payload':{'content':'private chat body'}}])
        self.write(self.codex / 'session_index.jsonl', [{'id':ID,'thread_name':'Fix the reset dropdown'}])
        self.write(self.claude / 'projects/-srv-project' / f'{ID}.jsonl', [
            {'type':'user','cwd':'/srv/project','message':{'content':'another private chat body'}},
            {'type':'custom-title','customTitle':'Review the homepage'}], age=10)
        sessions = self.history()
        self.assertEqual([s['name'] for s in sessions], ['Fix the reset dropdown','Review the homepage'])
        self.assertEqual([s['account'] for s in sessions], ['codex:b','claude'])
        self.assertEqual(sessions[0]['agentHome'], str(self.codex))
        self.assertEqual(sessions[1]['agentHome'], str(self.claude))
        self.assertTrue(all(s['state']=='idle' and not s['live'] for s in sessions))
        self.assertNotIn('private chat body', json.dumps(sessions))

    def test_claude_ai_titles_and_explicit_names(self):
        path=self.claude / 'projects/project' / f'{ID}.jsonl'
        for kind in ['ai-title', 'aiTitle']:
            self.write(path, [{'type':'user','cwd':'/home/fab'}, {'type':kind,'aiTitle':'Fix session switching'}])
            self.assertEqual(self.history()[0]['name'], 'Fix session switching')
        self.write(path, [{'type':'user','cwd':'/home/fab'},
                          {'type':'custom-title','customTitle':'My chosen name'},
                          {'type':'ai-title','aiTitle':'New generated title'}])
        self.assertEqual(self.history()[0]['name'], 'My chosen name')

    def test_subagents_corrupt_records_and_duplicates_are_excluded(self):
        for i, payload in enumerate([{'source':{'subagent':{}}},{'parent_thread_id':ID},{'id':'bad'}]):
            self.write(self.codex / 'sessions/2026/01/01' / f'rollout-{i}-{ID}.jsonl', [{'type':'session_meta','payload':{'id':ID,'cwd':'/srv/project',**payload}}])
        self.write(self.codex / 'sessions/2026/01/01' / f'rollout-{ID}.jsonl', [{'type':'session_meta','payload':{'id':ID,'cwd':'/srv/project'}}])
        sessions = usage.session_history([('b',self.codex),('alias',self.codex)], self.claude, self.now, include_antigravity=False)
        self.assertEqual(len(sessions),1)

    def test_only_thirty_newest_conversations_per_account(self):
        for i in range(35):
            identity=f'{i:08x}-1234-5678-abcd-123456789012'
            self.write(self.codex / 'sessions/2025/01/01' / f'rollout-{identity}.jsonl', [{'type':'session_meta','payload':{'id':identity,'cwd':'/srv/project'}}], age=i)
        sessions=self.history()
        self.assertEqual(len(sessions),30)
        self.assertEqual(sessions[-1]['id'],'0000001d-1234-5678-abcd-123456789012')

    def test_live_metadata_merges_without_losing_the_saved_title(self):
        self.write(self.claude / 'projects/project' / f'{ID}.jsonl', [{'type':'user','cwd':'/srv/p'},{'type':'custom-title','customTitle':'Named chat'}])
        with patch.object(usage,'claude_sessions',return_value=[{'id':ID,'sessionId':ID,'account':'claude','state':'waiting','cwd':'/srv/p','terminalPids':[90,80],'name':'p'}]):
            sessions=self.history()
        self.assertEqual(sessions[0]['name'],'Named chat')
        self.assertEqual(sessions[0]['terminalPids'],[90,80])
        self.assertEqual(sessions[0]['state'],'waiting')
        self.assertTrue(sessions[0]['live'])

    def test_antigravity_history_uses_workspace_uris_and_excludes_subagents(self):
        database=self.root / '.gemini/antigravity-cli/conversation_summaries.db'
        database.parent.mkdir(parents=True)
        with sqlite3.connect(database) as conn:
            conn.execute('create table conversation_summaries(conversation_id text,title text,last_modified_time text,workspace_uris text,parent_conversation_id text,app_data_dir text)')
            conn.executemany('insert into conversation_summaries values(?,?,?,?,?,?)',[(ID,'AGY history','2026-10-03T12:00:00Z','["file:///srv/my%20project"]','','antigravity-cli'),
                ('23456789-1234-5678-abcd-123456789012','Child','2026-10-03T12:00:01Z','["file:///srv/p"]',ID,'antigravity-cli')])
        with patch.object(Path,'home',return_value=self.root):
            sessions=usage.session_history([],self.claude,self.now)
        self.assertEqual(len(sessions),1)
        self.assertEqual(sessions[0]['provider'],'antigravity')
        self.assertEqual(sessions[0]['sessionId'],ID)
        self.assertEqual(sessions[0]['cwd'],'/srv/my project')

    def test_agy_presence_file_maps_to_its_terminal_ancestry(self):
        proc=self.root / 'proc'
        process=proc / '101'
        (process / 'fd').mkdir(parents=True)
        (process / 'stat').write_text('101 (agy) S 1 0 0')
        executable=self.root / 'agy';executable.write_text('')
        (process / 'exe').symlink_to(executable)
        lock=self.root / 'presence' / (ID+'.lock');lock.parent.mkdir();lock.write_text('')
        (process / 'fd' / '4').symlink_to(lock)
        self.assertEqual(usage.rollout_processes(proc),{str(lock):[101]})

if __name__=='__main__':
    unittest.main()
