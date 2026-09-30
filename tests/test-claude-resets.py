"""No network: Claude reset eligibility, expiry and normalized account wiring."""
import runpy
import time
from pathlib import Path
from unittest.mock import patch
m=runpy.run_path(str(Path(__file__).resolve().parents[1]/'scripts/agent-usage'))
parse=m['_claude_reset_credits']
future='2099-10-22T16:00:00Z'
grant={'id':'redemption-handle','resets_left':1,'usable_now':True,'paused':False,'ends_at':future}
assert parse({})==(None,None)
assert parse({'cedar_ember':{'eligible':False,'grants':[grant]}})==(None,None)
assert parse({'cedar_ember':{'eligible':True,'grants':[]}})==(0,[])
block={'eligible':True,'grants':[grant,{**grant,'paused':True},{**grant,'usable_now':False},{**grant,'resets_left':0},{**grant,'ends_at':'2000-01-01T00:00:00Z'},None]}
count,details=parse({'cedar_ember':block})
assert count==1 and len(details)==1 and details[0]['expirationKnown']
assert 'redemption-handle' not in str(details)
assert parse({'cedar_ember':{'eligible':True,'grants':[{**grant,'ends_at':None}]}})==(1,[{'expiresAt':None,'expirationKnown':False}])
query=m['_query_claude_uncached']
with patch.dict(query.__globals__,{'_claude_token':lambda:('test-token','pro',False),'_claude_fetch':lambda *_:{'five_hour':{'utilization':10},'cedar_ember':block}}):
 account=query(1)
 assert account['resetCredits']==1 and account['resetCreditDetails']==details
 assert 'redemption-handle' not in str(account)
print('PASS: available Claude resets, expiry, eligibility, no redemption handles, account wiring')
