"""Convert real raw exports to explicit ordered CSV; never infer cross-provider ID equality."""
import argparse,csv,json,pathlib,xml.etree.ElementTree as ET
COLUMNS=['route_id','direction','sequence','source_stop_id','stop_name','latitude','longitude','headway_minutes']
def raw_rows(path):
 text=pathlib.Path(path).read_text(encoding='utf-8-sig')
 if text.lstrip().startswith('<'):
  root=ET.fromstring(text)
  return [{c.tag.split('}')[-1]: (c.text or '').strip() for c in e if len(c)==0} for e in root.iter() if len(e)>0 and any(len(c)==0 for c in e)]
 obj=json.loads(text);out=[]
 def visit(x):
  if isinstance(x,dict):
   row={k:str(v).strip() for k,v in x.items() if v is not None and not isinstance(v,(list,dict))}
   if row:out.append(row)
   for v in x.values():visit(v)
  elif isinstance(x,list):
   for v in x:visit(v)
 visit(obj);return out
def normalize(rows,provider,fields=None,date=None):
 if provider=='molit':fields={'route_id':'RTE_ID','sequence':'STTN_SEQ','source_stop_id':'STTN_ID','stop_name':'STTN_NM'}
 if not fields or any(not fields.get(k) for k in ('route_id','sequence','source_stop_id','stop_name')):raise ValueError('Set explicit required field names; do not guess them.')
 output={}
 for row in rows:
  upper={k.upper():v for k,v in row.items()}
  def get(k):return upper.get(str(fields.get(k,'')).upper(),'').strip()
  if not all(get(k) for k in ('route_id','sequence','source_stop_id','stop_name')):continue
  if provider=='molit' and date and upper.get('OPR_YMD')!=date:raise ValueError('MOLIT date does not match requested snapshot')
  seq=int(get('sequence'))
  if seq<0:raise ValueError('Negative sequence')
  snapshot=upper.get('OPR_YMD','') if provider=='molit' else ''
  item=dict(route_id=provider+':'+snapshot+':'+get('route_id'),direction=get('direction') or 'source-order',sequence=str(seq),source_stop_id=provider+':'+get('source_stop_id'),stop_name=get('stop_name'),latitude=get('latitude'),longitude=get('longitude'),headway_minutes=get('headway_minutes'))
  identity=(item['route_id'],item['direction'],seq)
  if identity in output and output[identity]!=item:raise ValueError('Conflicting rows at same route/sequence. Resolve direction or snapshot conflict first.')
  output[identity]=item
 if not output:raise ValueError('No matching route rows. Inspect response fields first.')
 return sorted(output.values(),key=lambda r:(r['route_id'],r['direction'],int(r['sequence'])))
def main():
 p=argparse.ArgumentParser();p.add_argument('files',nargs='+');p.add_argument('--provider',choices=['daejeon','molit']);p.add_argument('--fields');p.add_argument('--date');p.add_argument('--output');p.add_argument('--inspect',action='store_true');p.add_argument('--metadata',nargs='+');p.add_argument('--metadata-fields');a=p.parse_args();rows=[]
 for file in a.files:rows.extend(raw_rows(file))
 if a.inspect:
  print(json.dumps(sorted({k for r in rows for k in r}),ensure_ascii=False,indent=2));return
 if not a.provider or not a.output:p.error('requires --provider and --output')
 fields=json.loads(pathlib.Path(a.fields).read_text(encoding='utf-8-sig')) if a.fields else None
 values=normalize(rows,a.provider,fields,a.date)
 if a.metadata:
  if a.provider!='daejeon' or not a.metadata_fields:p.error('metadata joining requires daejeon and --metadata-fields')
  mf=json.loads(pathlib.Path(a.metadata_fields).read_text(encoding='utf-8-sig'))
  if not mf.get('route_id') or not mf.get('headway_minutes'):p.error('metadata fields must explicitly map route_id and headway_minutes')
  metadata={}
  for file in a.metadata:
   for row in raw_rows(file):
    upper={k.upper():v for k,v in row.items()};rid=upper.get(mf['route_id'].upper());headway=upper.get(mf['headway_minutes'].upper())
    if rid and headway:
     try:n=float(headway)
     except ValueError:continue
     if 0<=n<=300:metadata[rid]=str(n)
  for item in values:item['headway_minutes']=metadata.get(item['route_id'].split(':')[-1],item['headway_minutes'])
 out=pathlib.Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
 with out.open('w',newline='',encoding='utf-8-sig') as f:w=csv.DictWriter(f,fieldnames=COLUMNS);w.writeheader();w.writerows(values)
 print(f'{len(values)} ordered rows. source-order means listed sequence only; no reverse edges generated.')
if __name__=='__main__':
 try:main()
 except (ValueError,KeyError) as e:raise SystemExit(str(e))
