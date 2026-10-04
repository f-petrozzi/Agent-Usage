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

    def test_usage_probes_are_hidden_without_hiding_real_home_directory_chats(self):
        path=self.claude / 'projects/home' / f'{ID}.jsonl'
        probe={'type':'user','cwd':'/home/fab','entrypoint':'sdk-cli','userType':'external',
               'message':{'role':'user','content':'<command-name>/usage</command-name>\n <command-message>usage</command-message>\n <command-args></command-args>'}}
        self.write(path,[{'type':'user','isMeta':True,'message':{'content':'CLI metadata'}},probe,{'type':'system','subtype':'local_command'}])
        self.assertEqual(self.history(),[])
        for additional in [
            {'type':'user','cwd':'/home/fab','message':{'content':'Fix my project'}},
            {'type':'assistant','message':{'content':'A substantive conversation'}},
            {'type':'custom-title','customTitle':'My usage investigation'},
        ]:
            self.write(path,[probe,additional]);self.assertEqual(len(self.history()),1)
        self.write(path,[{**probe,'entrypoint':'cli'}]);self.assertEqual(len(self.history()),1)
        self.write(path,[{**probe,'message':{'content':'/usage extra text'}}]);self.assertEqual(len(self.history()),1)
        self.write(path,[probe,{'type':'progress','data':'x'*70000}]);self.assertEqual(len(self.history()),1,'partial reads cannot identify disposable probes')

    def test_cli_usage_queries_do_not_persist_sessions(self):
        from types import SimpleNamespace
        with patch.object(usage,'_claude_cli',return_value=('/bin/claude',(2,1,0))), patch.object(usage.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout='{"result":"Usage reading"}')) as run:
            self.assertEqual(usage._claude_cli_usage(30),'Usage reading')
        self.assertEqual(run.call_args.args[0],['/bin/claude','-p','/usage','--output-format','json','--no-session-persistence'])

    def test_empty_claude_launches_are_hidden_but_real_named_and_live_chats_remain(self):
        path=self.claude / 'projects/homelab' / f'{ID}.jsonl'
        startup=[{'type':'mode'}, {'type':'system','subtype':'informational','cwd':'/srv/homelab'},
                 {'type':'cost-state','modelUsage':{},'totalCostUSD':0}, {'type':'last-prompt'}]
        self.write(path,startup)
        self.assertEqual(self.history(),[])
        for extra in [{'type':'user','message':{'content':'Real chat'}},
                      {'type':'assistant'}, {'type':'ai-title','aiTitle':'Named launch'},
                      {'type':'future-format'}, {'type':'cost-state','modelUsage':{'model':{'costUSD':1}}},
                      {'type':'system','subtype':'compact_boundary'}, {'type':'progress','data':'x'*70000}]:
            self.write(path,[*startup,extra]);self.assertEqual(len(self.history()),1)
        self.write(path,startup)
        with patch.object(usage,'claude_sessions',return_value=[{'sessionId':ID,'account':'claude','name':'homelab','state':'waiting'}]):
            self.assertTrue(self.history()[0]['live'])

    def test_probe_archive_preserves_real_recent_and_active_sessions(self):
        archive_loader=importlib.machinery.SourceFileLoader('probe_archive',str(Path(__file__).parents[1] / 'scripts/archive-claude-usage-probes.py'))
        archive_spec=importlib.util.spec_from_loader(archive_loader.name,archive_loader)
        archive=importlib.util.module_from_spec(archive_spec);archive_loader.exec_module(archive)
        probe={'type':'user','cwd':'/home/fab','entrypoint':'sdk-cli','userType':'external','message':{'content':'/usage'}}
        paths=[self.claude / 'projects/home' / f'{i:08x}-1234-5678-abcd-123456789012.jsonl' for i in range(4)]
        for path in paths:self.write(path,[probe],age=600)
        self.write(paths[1],[probe,{'type':'user','message':{'content':'Real work'}}],age=600)
        self.write(paths[2],[probe],age=5)
        backup=self.root / 'backup'
        with patch.object(archive.usage,'claude_sessions',return_value=[{'sessionId':paths[3].stem}]):
            plan=archive.archive_probes(self.claude,backup,now=self.now)
            self.assertEqual(len(plan),1);self.assertTrue(paths[0].exists());self.assertFalse(backup.exists())
            raw=paths[0].read_bytes();done=archive.archive_probes(self.claude,backup,apply=True,now=self.now)
        self.assertEqual(len(done),1);self.assertFalse(paths[0].exists())
        self.assertTrue(all(path.exists() for path in paths[1:]))
        self.assertEqual(Path(done[0]['backup']).read_bytes(),raw)
        manifest=json.loads((backup / 'manifest.jsonl').read_text())
        self.assertEqual(manifest['original'],str(paths[0]))
        with patch.object(archive.usage,'claude_sessions',return_value=[{'sessionId':paths[3].stem}]):
            self.assertEqual(archive.archive_probes(self.claude,backup,apply=True,now=self.now),[])

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
