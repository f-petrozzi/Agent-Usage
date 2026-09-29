"""Regression: notifications and RPC replies may arrive in a single pipe read."""
import importlib.machinery
import importlib.util
from pathlib import Path
import selectors
import subprocess
import sys
import unittest

loader = importlib.machinery.SourceFileLoader('usage', str(Path(__file__).parents[1]/'scripts/agent-usage'))
spec = importlib.util.spec_from_loader(loader.name, loader)
usage = importlib.util.module_from_spec(spec)
loader.exec_module(usage)

class StreamTests(unittest.TestCase):
    def test_coalesced_notification_and_replies(self):
        code = 'import os,time;os.write(1,b\'{{"method":"notice"}}\\n{{"id":0,"result":{{"ok":true}}}}\\n{{"id":1,"result":{{"value":2}}}}\\n\');time.sleep(2)'.replace('{{','{').replace('}}','}')
        with subprocess.Popen([sys.executable,'-c',code],stdout=subprocess.PIPE,text=True) as proc:
            with selectors.DefaultSelector() as selector:
                selector.register(proc.stdout, selectors.EVENT_READ)
                try:
                    self.assertEqual(usage._wait_for_response(proc,selector,0,.8),{'ok':True})
                    self.assertEqual(usage._wait_for_response(proc,selector,1,.8),{'value':2})
                finally:
                    proc.terminate()
                    proc.wait()

if __name__=='__main__':unittest.main()
