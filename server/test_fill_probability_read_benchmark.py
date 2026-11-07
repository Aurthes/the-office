"""Offline contract tests only; none of these fixtures are live data."""
import copy, importlib.util, io, json, struct, sys, tempfile, types, unittest
from pathlib import Path
from unittest.mock import patch
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('task_benchmark',HERE/'fill-probability-read-benchmark.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
helper=importlib.util.spec_from_file_location('fixture_helpers',HERE/'test_fill_probability_probe.py');fixtures=importlib.util.module_from_spec(helper);helper.loader.exec_module(fixtures)
SHA='a'*40;NOW=50000;START=1000
class BenchmarkContracts(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.setting=self.root/'atom_setting.json';self.setting.write_text(json.dumps({'system':{'cache_redis':'redis://offline','influx':{'url':'http://offline:8086','database':'offline','username':'offline','password':'DO_NOT_EXPORT'}},'strategy':{'params':{'instance_id':'5'}}}))
  original=(HERE/'fill-probability-probe.py').read_text()+f'\nidentity=lambda root,name:(123,{SHA!r},{START})\n'
  self.req={'mode':'disk','spec':{'name':'MMRPI','setting':str(self.setting),'sourceSha':SHA,'feedbackVersion':8},'originalFillProbe':original}
  self.clock=patch.object(b.time,'time',return_value=NOW/1000);self.clock.start()
 def tearDown(self):self.clock.stop();self.temp.cleanup()
 def state(self):
  v=fixtures.state();v.update(strategy='MMRPI',symbol=b.SYMBOL,saved_at_ms=49000)
  for s in v['side_states'].values():s.update(observation_schema=1,observation={'at_ms':1500,'ready':True,'enabled':True,'skip_reason':'','actual_probability_1s':.0002,'theoretical_probability_1s':.0003,'applied_log_ca':0})
  return v
 def write_state(self,v):
  raw=json.dumps(v).encode();key='cache:mm:target_fill_feedback:MMRPI:5:symbol:'+b.SYMBOL;encoded=key.encode().hex();folder=self.root/'.deploy_runtime/mm_cpp/local-persistence/state'
  while len(encoded)>120:folder=folder/('p'+encoded[:120]);encoded=encoded[120:]
  p=folder/('k'+encoded)/'current';p.parent.mkdir(parents=True);checksum=14695981039346656037
  for x in raw:checksum=(checksum^x)*1099511628211&((1<<64)-1)
  p.write_bytes(b'FKV00001S'+struct.pack('<QQQ',0,len(raw),checksum)+raw);return len(raw)
 def test_disk_uses_original_decode_and_preserves_stale_time(self):
  size=self.write_state(self.state());out=b.read(self.req);self.assertEqual(out['sourceReadBytes'],size);self.assertEqual(out['sourceTimeMs'],1500);self.assertEqual(out['sourceAgeMs'],48500);self.assertTrue(out['quality']['ready']);self.assertEqual(len(out['fields']),6);self.assertEqual(out['fields'][-1]['value'],.0003)
 def test_schema_identity_and_missing_fail_instead_of_empty_success(self):
  with self.assertRaises(FileNotFoundError):b.read(self.req)
  v=self.state();v['version']=9;self.write_state(v)
  with self.assertRaises(ValueError):b.read(self.req)
  req={**self.req,'spec':{**self.req['spec'],'sourceSha':'b'*40}}
  with self.assertRaises(ValueError):b.read(req)
 def redis(self,nullable=False):
  p=fixtures.probe;q={k:None for k in (*p.QUOTE_NUMBERS,*p.QUOTE_BOOLS)};q.update({k:'unchanged' for k in p.QUOTE_STATES});q.update(available=True,at=49000,exportedAt=49500,baseTarget=.001,beforeNormalize=.001,afterNormalize=.0009,pmax=None if nullable else .001,normalizationScale=.9,currentCaProbability=.0009,quoted=True,finalProbability=.0008,guardReason=None)
  hb={'pid':123,'success':True,'strategy':'MMRPI','strategy_idx':'5','type':'hb','reporter_started_at_ms':1100};quote={'observation_schema':1,'strategy':'MMRPI','instance_id':'5','pid':123,'exported_at_ms':49500,'rows':[{'account':b.ACCOUNT,'symbol':b.SYMBOL,'bid':q,'ask':q}]}
  class Client:
   def mget(self,keys):self.keys=keys;return [json.dumps(hb).encode(),json.dumps(quote).encode()]
   def close(self):self.closed=True
  return Client()
 def test_redis_exact_scope_and_null_is_failure_not_zero(self):
  req={**self.req,'mode':'redis'};c=self.redis();fake=types.SimpleNamespace(Redis=types.SimpleNamespace(from_url=lambda *a,**kw:c))
  with patch.dict(sys.modules,{'redis':fake}):out=b.read(req)
  self.assertEqual(c.keys,['heartbeat:strategy:MMRPI','cache:mm:fill_probability_observation:MMRPI:5']);self.assertTrue(c.closed);self.assertEqual(out['fields'][0]['value'],.001)
  c=self.redis(nullable=True)
  with patch.dict(sys.modules,{'redis':fake}):
   with self.assertRaises(ValueError):b.read(req)
 def test_influx_exact_frozen_nonempty_point_and_no_secret_projection(self):
  columns=['time','count','sample_schema','sample_count','sample_00','bps_sum','notional_sum'];data={'results':[{'series':[{'columns':columns,'values':[[1794067854559,1,1,1,-45.5,-45.5,51.2043]]}]}]}
  class Response(io.BytesIO):
   def getheader(self,name):return None
  def get(request,timeout):
   self.assertIn('1794061842331754692',request.full_url);self.assertIn('1794067849796',request.full_url);return Response(json.dumps(data).encode())
  with patch.object(b.urllib.request,'urlopen',side_effect=get):out=b.read({**self.req,'mode':'influx'})
  self.assertEqual(out['sampleIdentity']['run'],'1794061842331754692');self.assertTrue(out['quality']['historicalFrozenPoint']);self.assertNotIn('DO_NOT_EXPORT',json.dumps(out))
  data['results'][0]['series']=[]
  with patch.object(b.urllib.request,'urlopen',side_effect=get):
   with self.assertRaises(ValueError):b.read({**self.req,'mode':'influx'})
if __name__=='__main__':unittest.main()
