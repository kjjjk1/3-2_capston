import importlib.util,pathlib,tempfile,unittest,json,subprocess,csv
ROOT=pathlib.Path(__file__).resolve().parents[1]
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
n=module('normalize',ROOT/'scripts/normalize-public.py');c=module('collect',ROOT/'scripts/collect-public.py')
class PublicDataTests(unittest.TestCase):
 def test_exact_endpoints_and_encoding(self):
  url=c.query('daejeon-stops',2,1000,None,None,None,None,'a%2Bb%3D')
  self.assertIn('/getStaionByRouteAll?',url);self.assertIn('serviceKey=a%2Bb%3D',url);self.assertIn('reqPage=2',url)
  url=c.query('molit-stops',1,1000,'20260101','30','30110',None,'key')
  self.assertIn('getBusRoutespecificStopInformation',url);self.assertIn('opr_ymd=20260101',url)
  self.assertIn('/arrive/getArrInfoByUid?',c.query('arrivals',1,1000,None,None,None,'32350','key'))
 def test_molit_fields_preserve_order_and_require_crosswalk(self):
  rows=[{'OPR_YMD':'20260101','RTE_ID':'r','STTN_SEQ':'1','STTN_ID':'s','STTN_NM':'정류장'}]
  result=n.normalize(rows,'molit',date='20260101')[0]
  self.assertEqual(result['source_stop_id'],'molit:s');self.assertEqual(result['direction'],'source-order');self.assertEqual(result['latitude'],'')
  with self.assertRaises(ValueError):n.normalize(rows,'molit',date='20260102')
 def test_conflicts_fail_without_assuming_reverse_direction(self):
  a={'RTE_ID':'r','STTN_SEQ':'1','STTN_ID':'a','STTN_NM':'A'};b={**a,'STTN_ID':'b'}
  with self.assertRaises(ValueError):n.normalize([a,b],'molit')
 def test_xml_and_json_record_detection(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d)/'raw.xml';p.write_text('<root><item><RTE_ID>r</RTE_ID><STTN_SEQ>1</STTN_SEQ><STTN_ID>s</STTN_ID><STTN_NM>A</STTN_NM></item></root>',encoding='utf-8')
   self.assertEqual(len(n.normalize(n.raw_rows(p),'molit')),1)
   p.write_text(json.dumps({'response':{'body':{'items':[{'RTE_ID':'r','STTN_SEQ':'1','STTN_ID':'s','STTN_NM':'A'}]}}}),encoding='utf-8')
   self.assertEqual(len(n.normalize(n.raw_rows(p),'molit')),1)
 def test_api_error_payload_rejected(self):
  with self.assertRaises(ValueError):c.check_payload(b'<response><resultCode>30</resultCode></response>')
  with self.assertRaises(ValueError):c.check_payload(b'{"header":{"resultCode":"30"}}')
  self.assertTrue(c.check_payload(b'<root><headerCd>0</headerCd></root>'))
if __name__=='__main__':unittest.main()
