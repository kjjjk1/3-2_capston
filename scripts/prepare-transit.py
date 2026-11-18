"""Build ordered directed route data from official-export CSV, without merging names.
Input CSV columns (normalise vendor fields explicitly before this step):
route_id,direction,sequence,source_stop_id,stop_name,latitude,longitude,headway_minutes
Optional exact mapping CSV: source_stop_id,stop_id. Unknown/ambiguous rows break a route.
"""
import argparse,csv,json,math,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[1]
def distance(a,b):
    return math.hypot((a[0]-b[0])*111195,(a[1]-b[1])*111195*math.cos(math.radians(36.35)))
def main():
    p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('--mapping');p.add_argument('--source',required=True);p.add_argument('--output',default=str(ROOT/'data/transit-network.json'));a=p.parse_args()
    stops=list(csv.DictReader((ROOT/'data/stops_clean.csv').open(encoding='utf-8-sig')));by_id={s['stop_id']:s for s in stops};mapping={}
    if a.mapping:
        for row in csv.DictReader(open(a.mapping,encoding='utf-8-sig')):
            if row['source_stop_id'] in mapping and mapping[row['source_stop_id']]!=row['stop_id']:raise SystemExit('Ambiguous explicit mapping')
            if row['stop_id'] not in by_id:raise SystemExit('Explicit mapping references unknown stop')
            mapping[row['source_stop_id']]=row['stop_id']
    groups={};unmapped=[];seen=set()
    for row in csv.DictReader(open(a.input,encoding='utf-8-sig')):
        route,direction=row['route_id'].strip(),row['direction'].strip();seq=int(row['sequence']);identity=(route,direction,seq)
        if not route or not direction or identity in seen:raise SystemExit('Route id/direction required, sequence must be unique per direction')
        seen.add(identity);source=row['source_stop_id'];stop_id=mapping.get(source)
        # No implicit cross-API id equality. Coordinate+name mapping must be unique within 50m.
        if not stop_id:
            try:
                lat,lon=float(row['latitude']),float(row['longitude'])
                matches=[s for s in stops if s['stop_name'].strip()==row['stop_name'].strip() and distance((lat,lon),(float(s['latitude']),float(s['longitude'])))<=50]
                if len(matches)==1:stop_id=matches[0]['stop_id']
            except (ValueError,KeyError):pass
        if not stop_id:unmapped.append({'route':route,'direction':direction,'sequence':seq,'source_stop_id':source})
        headway=None
        try:
            n=float(row.get('headway_minutes',''));headway=n if math.isfinite(n) and n>=0 else None
        except ValueError:pass
        groups.setdefault((route,direction),[]).append((seq,stop_id,headway))
    routes=[]
    for (route,direction),rows in groups.items():
        segment=[];previous=None;part=0
        def flush():
            nonlocal segment,part
            if len(segment)>=2:
                routes.append({'id':route,'direction':direction,'segment':part,'stops':[r[1] for r in segment],'headwayMinutes':next((r[2] for r in segment if r[2] is not None),None)})
            segment=[];part+=1
        for row in sorted(rows):
            if row[1] is None or (previous is not None and row[0]!=previous+1):flush()
            if row[1] is not None:segment.append(row)
            previous=row[0]
        flush()
    if not routes:raise SystemExit('No trustworthy route segments; existing network was not changed.')
    from datetime import datetime,timezone
    payload={'source':a.source,'updatedAt':datetime.now(timezone.utc).isoformat(),'routes':routes,'unmappedCount':len(unmapped)}
    out=pathlib.Path(a.output);temp=out.with_suffix('.tmp');temp.write_text(json.dumps(payload,ensure_ascii=False),encoding='utf-8');temp.replace(out)
    (out.parent/'transit-mapping-report.json').write_text(json.dumps({'unmapped':unmapped},ensure_ascii=False,indent=2),encoding='utf-8')
    print(f'{len(routes)} directed segments, {len(unmapped)} unmapped rows. Rebuild with node build.mjs.')
if __name__=='__main__':main()
