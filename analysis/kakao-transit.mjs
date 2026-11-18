export async function verifyKakao(origin,destination,key,mode,fetcher=fetch){
 const url=new URL('https://dapi.kakao.com/v2/routing/publictraffic');
 url.search=new URLSearchParams({start_x:String(origin.lon),start_y:String(origin.lat),end_x:String(destination.lon),end_y:String(destination.lat),input_coord:'WGS84',output_coord:'WGS84'}).toString();
 const response=await fetcher(url,{headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!response.ok)throw Error('카카오 경로 요청 실패');const data=await response.json();
 if(data.status!=='OK'||!Array.isArray(data.routes))throw Error('카카오 경로 없음');
 const routes=data.routes.filter(r=>['BUS','SUBWAY','BUS_AND_SUBWAY'].includes(r.properties?.type)&&(mode!=='버스만'||r.properties.type==='BUS')&&Number.isFinite(r.properties.totalTime)&&r.properties.totalTime>=0&&Number.isInteger(r.properties.transfers)&&r.properties.transfers>=0&&Array.isArray(r.steps)&&r.steps.some(s=>['BUS','SUBWAY'].includes(s.properties?.type))&&r.steps.every(s=>s.properties&&['BUS','SUBWAY','WALKING'].includes(s.properties.type)&&Number.isFinite(s.properties.distance)&&s.properties.distance>=0)).sort((a,b)=>a.properties.totalTime-b.properties.totalTime);
 if(!routes.length)throw Error('유효한 카카오 대중교통 경로가 없습니다.');
 const r=routes[0],rides=r.steps.filter(s=>s.properties.type!=='WALKING');
 return {provider:'kakao',expectedMinutes:r.properties.totalTime/60,walkMetres:r.steps.filter(s=>s.properties.type==='WALKING').reduce((sum,s)=>sum+s.properties.distance,0),transfers:r.properties.transfers,firstStationMatch:null,segments:rides.map(s=>({type:s.properties.type==='BUS'?'bus':'subway',from:s.properties.stops?.[0]?.name||'',to:s.properties.stops?.at(-1)?.name||'',lines:(s.properties.vehicles||[]).map(v=>v.name).filter(Boolean)}))};
}
