"""Explicit, bounded offline collection. Never invoked by the analysis button."""
import argparse, datetime, json, os, pathlib, urllib.parse, urllib.request, xml.etree.ElementTree as ET
ROOT=pathlib.Path(__file__).resolve().parents[1]
ENDPOINTS={
 'daejeon-routes':'https://apis.data.go.kr/6300000/busRouteInfo/getRouteInfoAll',
 'daejeon-stops':'https://apis.data.go.kr/6300000/busRouteInfo/getStaionByRouteAll',
 'molit-stops':'https://apis.data.go.kr/1613000/BusRoutespecificStopInformation/getBusRoutespecificStopInformation',
 'arrivals':'https://apis.data.go.kr/6300000/arrive/getArrInfoByUid'}
def load_env():
 p=ROOT/'.env'
 if p.exists():
  for line in p.read_text(encoding='utf-8-sig').splitlines():
   if '=' in line and not line.lstrip().startswith('#'):
    k,v=line.split('=',1);os.environ.setdefault(k.strip(),v.strip().strip('\"\''))
def query(kind,page,rows,date,city,district,ars_id,key):
 params={'serviceKey':urllib.parse.unquote(key)}
 if kind.startswith('daejeon-'):params['reqPage']=str(page)
 elif kind=='molit-stops':params.update(pageNo=str(page),numOfRows=str(rows),opr_ymd=date,ctpv_cd=city,sgg_cd=district,dataType='JSON')
 else:params['arsId']=ars_id
 return ENDPOINTS[kind]+'?'+urllib.parse.urlencode(params)
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise ValueError('Redirect rejected')
def check_payload(raw):
 text=raw.decode('utf-8-sig')
 # Errors are rejected without logging the request URL or key.
 if text.lstrip().startswith('<'):
  root=ET.fromstring(text)
  for e in root.iter():
   tag=e.tag.split('}')[-1].lower();value=(e.text or '').strip()
   if tag in ('resultcode','headercd') and value not in ('0','00','000','0000','NORMAL_SERVICE'):raise ValueError('Provider returned error')
   if tag=='returnauthmsg' or (tag=='errmsg' and value):raise ValueError('Provider returned error')
 else:
  obj=json.loads(text)
  def walk(x):
   if isinstance(x,dict):
    for k,v in x.items():
     if k.lower() in ('resultcode','headercd') and str(v) not in ('0','00','000','0000','NORMAL_SERVICE'):raise ValueError('Provider returned error')
     walk(v)
   elif isinstance(x,list):
    for v in x:walk(v)
  walk(obj)
 return text.lstrip().startswith('<')
def main():
 load_env();p=argparse.ArgumentParser();p.add_argument('--kind',choices=list(ENDPOINTS),required=True);p.add_argument('--pages',type=int,default=1);p.add_argument('--start-page',type=int,default=1);p.add_argument('--rows',type=int,default=1000);p.add_argument('--date');p.add_argument('--city-code');p.add_argument('--district-code');p.add_argument('--ars-id');a=p.parse_args()
 if not 1<=a.pages<=1000 or a.start_page<1 or not 1<=a.rows<=1000:p.error('pages and rows must be 1..1000; start-page >=1')
 if a.kind=='molit-stops':
  if not a.date or not a.city_code or not a.district_code:p.error('MOLIT requires --date YYYYMMDD --city-code --district-code from approved data coverage')
  try:datetime.datetime.strptime(a.date,'%Y%m%d')
  except ValueError:p.error('invalid operation date')
 if a.kind=='arrivals' and (not a.ars_id or not a.ars_id.isdigit() or len(a.ars_id)!=5):p.error('arrivals requires official 5 digit --ars-id')
 key=os.environ.get('MOLIT_SERVICE_KEY' if a.kind=='molit-stops' else 'DAEJEON_SERVICE_KEY') or os.environ.get('DATA_GO_KR_SERVICE_KEY')
 if not key:raise SystemExit('Set the public data service key in .env. No request sent.')
 folder=ROOT/'data/raw'/datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f');folder.mkdir(parents=True)
 opener=urllib.request.build_opener(NoRedirect())
 for page in range(a.start_page,a.start_page+(1 if a.kind=='arrivals' else a.pages)):
  try:
   with opener.open(query(a.kind,page,a.rows,a.date,a.city_code,a.district_code,a.ars_id,key),timeout=30) as response:raw=response.read(20_000_001)
   if len(raw)>20_000_000:raise ValueError('Too large')
   xml=check_payload(raw);out=folder/f'{a.kind}-{page}.{"xml" if xml else "json"}';out.write_bytes(raw)
   print(f'{a.kind} page {page}: saved')
  except Exception:raise SystemExit('Collection failed. Check approval, key, parameters and remaining quota locally. Request URL/key omitted.')
 print('Saved under '+str(folder));print('Verify total page count and coverage before normalization. No automatic retries.')
if __name__=='__main__':main()
