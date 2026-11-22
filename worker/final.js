const finalStops=/*FINAL_STOPS*/ [];
async function finalMembers(db,id){return (await db.prepare('SELECT id,name,stop_id FROM room_members WHERE room_id=? ORDER BY slot').bind(id).all()).results;}
async function finalHistory(db,id){
 const meetings=(await db.prepare('SELECT h.*,a.payload AS origin_snapshot_payload FROM meeting_history h LEFT JOIN analysis_runs a ON a.id=h.run_id WHERE h.room_id=? ORDER BY h.created_at,h.id').bind(id).all()).results;
 const records=(await db.prepare('SELECT b.*,h.regular FROM burden_records b JOIN meeting_history h ON h.id=b.meeting_id WHERE h.room_id=?').bind(id).all()).results;
 const balances={};for(const r of records)if(r.regular)balances[r.member_id]=(balances[r.member_id]||0)+r.relative;
 return {balances,meetings:meetings.map(({origin_snapshot_payload,...m})=>{let origins=[];try{origins=JSON.parse(origin_snapshot_payload||'{}').origins||[];}catch{}return {...m,records:records.filter(r=>r.meeting_id===m.id).map(r=>({...r,originStopName:origins.find(o=>o.memberId===r.member_id)?.stopName||null}))};})};
}
async function finalFingerprint(members,ids,history,mode){return hash(JSON.stringify({members:ids.map(id=>{const m=members.find(m=>m.id===id);return [id,m?.stop_id];}),history:history.meetings.map(m=>m.id),mode}));}
function finalPublic(payload,me){const {retryPool,...publicPayload}=payload;return {...publicPayload,alternatives:selectRecommendationPolicy(payload.candidates,payload.regular,payload.recommendationPolicy||'balance',payload.targetMemberId,payload.recommendedCandidateId).alternatives,candidates:payload.candidates.map(c=>({...c,paths:c.paths.map(p=>({...p,segments:p.segments||[],firstStationMatch:p.firstStationMatch??null}))}))};}
async function finalRoutes(req,env){
 const url=new URL(req.url),db=env.DB;
 if(url.pathname==='/api/config'&&req.method==='GET'){
  const network=await db.prepare('SELECT imported_at FROM transit_network WHERE id=1').bind().first();
  return json({routeApiAllowed:!pagesRequest(req,env),method:'AUTO_FAIRNESS',odsay:!!env.ODSAY_API_KEY,kakaoTransit:!!env.KAKAO_TRANSIT_REST_API_KEY,kakaoLocal:!!env.KAKAO_LOCAL_REST_API_KEY,naverMapClientId:env.NAVER_MAP_CLIENT_ID||'',candidateCount:100,shortlistCount:Math.max(3,Math.min(5,Number(env.SHORTLIST_COUNT)||5)),networkReady:!!network,networkImportedAt:network?.imported_at||null});
 }
 if(url.pathname==='/api/places'&&req.method==='GET'){
  if(pagesRequest(req,env))fail('GitHub Pages에서는 정류장 이름 검색을 이용해주세요. 외부 API는 Render 앱에서 사용할 수 있어요.',403);
  if(!env.KAKAO_LOCAL_REST_API_KEY)fail('카카오 Local 키가 없습니다. 정류장 이름 검색은 키 없이 이용할 수 있습니다.',503);
  const query=clean(url.searchParams.get('q'),80);if(!query)fail('학교·장소 이름을 입력해주세요.');
  const target=new URL('https://dapi.kakao.com/v2/local/search/keyword.json');target.search=new URLSearchParams({query,x:'127.4',y:'36.35',radius:'20000',size:'10'}).toString();
  try{const r=await (env.FETCH||fetch)(target,{headers:{Authorization:'KakaoAK '+env.KAKAO_LOCAL_REST_API_KEY},signal:AbortSignal.timeout(10000),redirect:'error'});if(!r.ok)throw Error();const data=await r.json();return json({places:(data.documents||[]).map(p=>({name:p.place_name,address:p.road_address_name||p.address_name,lat:Number(p.y),lon:Number(p.x)})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon))});}catch{fail('카카오 장소 검색에 실패했습니다. 키와 서비스 설정을 확인해주세요.',502);}
 }
 const match=url.pathname.match(/^\/api\/rooms\/([a-f0-9-]{36})\/(analysis|history|confirm)$/);if(!match)return undefined;
 const [,id,action]=match,room=await addonRoom(db,id);await addonOwner(req,db,room);
 const me=await mine(req,db,id);
 if(action==='history'&&req.method==='GET')return json({...await finalHistory(db,id),canDelete:await rosterCreator(req,db,room)});
 if(action==='history'&&req.method==='DELETE'){
  if(!await rosterCreator(req,db,room))fail('모임을 만든 사람만 이동 기록을 삭제할 수 있어요.',403);
  const input=await body(req),all=input.all===true,ids=input.meetingIds;
  if(!all&&(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(x=>typeof x!=='string'||!/^[a-f0-9-]{36}$/.test(x))))fail('삭제할 회차를 선택해주세요.');
  const history=await finalHistory(db,id),targets=all?history.meetings:history.meetings.filter(m=>ids.includes(m.id));
  if(!all&&targets.length!==new Set(ids).size)fail('현재 모임의 기록만 삭제할 수 있어요.',404);
  if(!targets.length)return json({deleted:0,...await finalHistory(db,id),canDelete:true});
  const statements=[];for(const m of targets){statements.push(db.prepare('DELETE FROM burden_records WHERE meeting_id=? AND meeting_id IN (SELECT id FROM meeting_history WHERE room_id=?)').bind(m.id,id));statements.push(db.prepare('DELETE FROM meeting_history WHERE id=? AND room_id=?').bind(m.id,id));}
  statements.push(db.prepare("UPDATE analysis_runs SET status='invalidated',payload=NULL WHERE room_id=?").bind(id));
  await db.batch(statements);return json({deleted:targets.length,...await finalHistory(db,id),canDelete:true});
 }

 if(action==='confirm'&&req.method==='POST'){
  const input=await body(req),run=await db.prepare('SELECT * FROM analysis_runs WHERE id=? AND room_id=?').bind(clean(input.runId,36),id).first();
  if(!run||run.status!=='complete'||!run.payload)fail('확정할 분석을 찾을 수 없습니다.',404);
  const previous=await db.prepare('SELECT * FROM meeting_history WHERE run_id=?').bind(run.id).first();
  if(previous){if(previous.candidate_id!==input.candidateId)fail('이미 다른 장소로 확정한 분석입니다.',409);return json({meetingId:previous.id,duplicate:true});}
  if(Date.now()-run.created_at>3600000)fail('분석 후 1시간이 지났습니다. 다시 분석해주세요.',409);
  const payload=JSON.parse(run.payload),members=await finalMembers(db,id),history=await finalHistory(db,id);
  if(await finalFingerprint(members,payload.memberIds,history,payload.mode)!==run.fingerprint)fail('참석자 출발지 또는 이전 회차 기록이 바뀌었습니다. 다시 분석해주세요.',409);
  const alternatives=selectRecommendationPolicy(payload.candidates,payload.regular,payload.recommendationPolicy||'balance',payload.targetMemberId,payload.recommendedCandidateId).alternatives;if(![alternatives.fairnessId,alternatives.efficiencyId,alternatives.personalId].includes(input.candidateId))fail('전체 공정성·이동 효율·개인 배려 대안 중에서 선택해주세요.',409);
  const chosen=payload.candidates.find(c=>c.candidate.id===input.candidateId);if(!chosen)fail('추천 목록의 장소를 선택해주세요.');
  if(chosen.eligible===false||!chosen.summary||chosen.paths.some(p=>p.status!==(payload.calculationMode==='estimated'?'estimated':'verified')||!Number.isFinite(p.expectedMinutes)))fail('모든 참석자의 분석 시간이 확인된 장소만 확정할 수 있어요.',409);
  const mid=crypto.randomUUID();
  try{await db.batch([
   db.prepare('INSERT INTO meeting_history(id,room_id,run_id,venue,regular,created_at,candidate_id,calculation_mode) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM meeting_history WHERE room_id=?)=?').bind(mid,id,run.id,chosen.candidate.name,payload.regular?1:0,new Date().toISOString(),chosen.candidate.id,payload.calculationMode==='estimated'?'estimated':'api',id,payload.historyCount),
   ...chosen.paths.map(p=>db.prepare('INSERT INTO burden_records(meeting_id,member_id,name,minutes,walk,transfers,relative) VALUES(?,?,?,?,?,?,?)').bind(mid,p.memberId,p.name,p.expectedMinutes,p.walkMetres,p.transfers,p.relative)),
   db.prepare('UPDATE analysis_runs SET confirmed_id=? WHERE id=?').bind(mid,run.id)
  ]);}catch(e){const old=await db.prepare('SELECT * FROM meeting_history WHERE run_id=?').bind(run.id).first();if(old&&old.candidate_id===input.candidateId)return json({meetingId:old.id,duplicate:true});if(old)fail('이미 다른 장소로 확정한 분석입니다.',409);const latest=await finalHistory(db,id);if(latest.meetings.length!==payload.historyCount)fail('다른 회차가 먼저 확정되었습니다. 다시 분석해주세요.',409);throw e;}
  return json({meetingId:mid,duplicate:false},201);
 }
 if(action!=='analysis'||req.method!=='POST')fail('지원하지 않는 요청입니다.',405);
 const input=await body(req),members=await finalMembers(db,id),ids=input.memberIds;
 if(!Array.isArray(ids)||ids.length<2||ids.length>6||new Set(ids).size!==ids.length||ids.some(x=>!members.some(m=>m.id===x)))fail('이번 참석자를 2~6명 선택해주세요.');
 const selected=ids.map(x=>members.find(m=>m.id===x)),byId=new Map(finalStops.map(s=>[s.id,s]));
 const origins=selected.map(m=>byId.get(m.stop_id));if(origins.some(o=>!o))fail('이번 참석자의 출발 정류장을 모두 지정해주세요.');
 if(!['regular','casual'].includes(input.meetingType))fail('모임 유형을 선택해주세요.');
 const mode='통합',regular=input.meetingType==='regular';
 const recommendationPolicy=input.recommendationPolicy??'balance';if(!['balance','protect'].includes(recommendationPolicy))fail('추천 기준을 확인해주세요.');
 let targetMemberId=regular&&input.targetMemberId?clean(input.targetMemberId,36):null;if(input.targetMemberId&&(!regular||!ids.includes(targetMemberId)))fail('이번 참석자 중 배려할 사람을 선택해주세요.');
 const maxIncreaseRatio=null;
 if(input.useApi!==undefined&&typeof input.useApi!=='boolean')fail('API ON/OFF 설정을 확인해주세요.');
 const useApi=input.useApi!==false,calculationMode=useApi?'api':'estimated';
 if(useApi&&pagesRequest(req,env))fail('GitHub Pages에서는 자체 추정만 사용할 수 있어요. 경로 API 분석은 https://three-2-capston.onrender.com 에서 실행해주세요.',403);
 
 const provider=useApi?(input.provider??'kakao'):'local';if(useApi&&!['kakao','odsay'].includes(provider))fail('검증 API를 선택해주세요.');
 const providerKey=provider==='kakao'?env.KAKAO_TRANSIT_REST_API_KEY:env.ODSAY_API_KEY;
 if(useApi&&!providerKey)fail((provider==='kakao'?'카카오 대중교통':'ODsay')+' 키를 서버 환경변수에 설정해주세요. OFF나 다른 API로 자동 전환하지 않습니다.',503);
 const networkRow=await db.prepare('SELECT payload FROM transit_network WHERE id=1').bind().first();
 if(!networkRow)fail('로컬 DB에 실제 노선 경유 데이터가 없습니다. 공공데이터 정규화 후 노선 DB 가져오기를 실행해주세요.',503);
 const history=await finalHistory(db,id);let plan,previousRun=null,previousPayload=null;
 if(recommendationPolicy==='protect'&&regular){const maximum=Math.max(0,...ids.map(id=>history.balances[id]||0));targetMemberId=maximum>.01?ids.find(id=>Math.abs((history.balances[id]||0)-maximum)<.01):null;}
 if(input.retryRunId){
  previousRun=await db.prepare('SELECT * FROM analysis_runs WHERE id=? AND room_id=?').bind(clean(input.retryRunId,36),id).first();
  try{previousPayload=JSON.parse(previousRun?.payload||'null');}catch{}
  if(!previousPayload||previousRun.confirmed_id||previousPayload.retryUsed||previousPayload.retryParentId||previousPayload.provider!==provider||previousPayload.regular!==regular||(previousPayload.recommendationPolicy||'balance')!==recommendationPolicy||Date.now()-previousRun.created_at>3600000)fail('이 분석에서는 추가 탐색할 수 없습니다.',409);
  if((previousPayload.targetMemberId||null)!==targetMemberId||JSON.stringify(ids)!==JSON.stringify(previousPayload.memberIds)||await finalFingerprint(members,ids,history,mode)!==previousRun.fingerprint)fail('출발지나 이동 기록이 바뀌었습니다. 새로 분석해주세요.',409);
  if(!previousPayload.retryPool?.length)fail('추가 탐색할 새로운 후보가 없습니다.',422);
 }

 try{if(previousPayload)plan={...previousPayload.retryPlan,shortlist:previousPayload.retryPool.filter(r=>!previousPayload.candidates.some(c=>c.candidate.id===r.candidate.id)).slice(0,5),preliminaryRows:previousPayload.retryPool,searchArea:previousPayload.searchArea};else plan=selectMethodB(origins,finalStops,JSON.parse(networkRow.payload),selected,history.balances,regular,Number(env.SHORTLIST_COUNT)||5,targetMemberId);}catch{fail('노선 DB의 방향·순서·정류장 매핑을 확인해주세요.',503);}
 if(!plan.shortlist.length)fail('유효한 정류장 후보를 만들지 못했습니다. 정류장 데이터를 확인해주세요.',422);
 const initialShortlistCount=plan.shortlist.length;plan.shortlist=useApi?verificationPlan({...plan,memberIds:ids,targetMemberId},provider,history.balances,regular):localShortlist(plan,selected,Number(env.SHORTLIST_COUNT)||5);plan.shortlistCount=plan.shortlist.length;
 if(!plan.shortlist.length)fail('모든 참석자의 이동시간을 자체 추정할 수 있는 후보가 없습니다. 출발지를 확인해주세요.',422);
 const fingerprint=await finalFingerprint(members,ids,history,mode),started=Date.now(),runId=crypto.randomUUID();
 const hasFairnessHistory=history.meetings.some(m=>m.regular&&m.records.some(r=>ids.includes(r.member_id)));
 const lock=await db.prepare('INSERT INTO analysis_locks(room_id,started_at) VALUES(?,?) ON CONFLICT(room_id) DO UPDATE SET started_at=excluded.started_at WHERE analysis_locks.started_at<?').bind(id,started,started-600000).run();
 if(!lock.meta.changes)fail('분석이 진행 중입니다. 완료 후 다시 시도해주세요.',409);
 try{
  if(previousRun){const fresh=await db.prepare('SELECT payload,confirmed_id FROM analysis_runs WHERE id=?').bind(previousRun.id).first();if(fresh.confirmed_id||JSON.parse(fresh.payload||'{}').retryUsed)fail('추가 탐색은 한 번만 가능합니다.',409);}
  if(useApi){
  const day=new Date().toISOString().slice(0,10),limit=Math.max(1,provider==='kakao'?(Number(env.KAKAO_TRANSIT_DAILY_LIMIT)||1000):Math.min(30,Number(env.ODSAY_DAILY_LIMIT)||30)),budget=ids.length*plan.shortlist.length;
  await db.prepare('INSERT OR IGNORE INTO provider_usage(day,provider,calls) VALUES(?,?,0)').bind(day,provider).run();
  const reserved=await db.prepare('UPDATE provider_usage SET calls=calls+? WHERE day=? AND provider=? AND calls+?<=?').bind(budget,day,provider,budget,limit).run();
  if(!reserved.meta.changes)fail('선택한 공급자의 오늘 자체 호출 한도가 부족합니다. 내일 또는 별도 보조 API 선택으로 확인해주세요.',429);
  }
  if(previousRun)await db.prepare('UPDATE analysis_runs SET payload=? WHERE id=?').bind(JSON.stringify({...previousPayload,retryUsed:true}),previousRun.id).run();
  await db.prepare('INSERT INTO analysis_runs(id,room_id,created_at,status,fingerprint) VALUES(?,?,?,?,?)').bind(runId,id,started,'running',fingerprint).run();
 }catch(e){await db.prepare('DELETE FROM analysis_locks WHERE room_id=? AND started_at=?').bind(id,started).run();throw e;}
 const encoder=new TextEncoder();let disconnected=false;
 const stream=new ReadableStream({start(controller){
  const emit=data=>{if(!disconnected)try{controller.enqueue(encoder.encode(JSON.stringify(data)+'\n'));}catch{disconnected=true;}};
  (async()=>{try{
   let calls=0,processed=0,expanded=false;const complete=[],comparison=[],queue=[...plan.shortlist],totalCalls=ids.length*plan.shortlist.length;
   if(previousPayload)for(const c of previousPayload.candidates){const ok=!!c.summary&&c.paths.every(p=>p.status===(useApi?'verified':'estimated'));comparison.push({candidate:c.candidate,paths:c.paths,ok,estimate:c.estimate?.summary,selectionReason:'previous_verification',selectionRoles:['previous_verification'],estimatedBurdens:ids.map(memberId=>({score:previousPayload.estimationAccuracy?.pairs.find(p=>p.candidateId===c.candidate.id&&p.memberId===memberId)?.estimatedMinutes}))});if(ok)complete.push({candidate:c.candidate,paths:c.paths});}
   for(const row of queue){
    if(disconnected)break;
    const candidate=row.candidate,paths=[];
    for(let i=0;i<selected.length;i++){
     if(disconnected)break;
     const member=selected[i];processed++;if(useApi)calls++;
     try{if(!useApi){paths.push(estimatedPaths(row,selected)[i]);}else{const route=provider==='kakao'?await verifyKakao(origins[i],candidate,providerKey,mode,env.FETCH||fetch):await verifyOdsay(origins[i],candidate,providerKey,mode,env.FETCH||fetch);paths.push({memberId:member.id,name:member.name,provider,...route,status:'verified'});}}
     catch{paths.push({memberId:member.id,name:member.name,provider,status:'unverified',segments:[],firstStationMatch:null});}
     emit({type:'progress',message:useApi?`후보별 경로 API 비교 · ${calls}/${totalCalls}회`:`교통 DB 자체 추정 · ${processed}/${totalCalls}`,done:processed,total:totalCalls});
    }
    const ok=paths.length===ids.length&&paths.every(p=>p.status===(useApi?'verified':'estimated')&&Number.isFinite(p.expectedMinutes));
    comparison.push({candidate,paths,ok,estimate:row.summary,estimatedBurdens:row.burdens,selectionReason:row.selectionReason,selectionRoles:row.selectionRoles||[row.selectionReason],modelStatus:row.status});if(ok)complete.push({candidate,paths});
   }
   if(disconnected){await db.prepare('UPDATE analysis_runs SET status=? WHERE id=?').bind('cancelled',runId).run();return;}
   const evaluated=evaluateImprovement(complete,history.balances,ids,regular,hasFairnessHistory),ranked=evaluated.eligible;
   const best=evaluated.best,verified=!!best,baseline=complete.length?Math.min(...complete.map(c=>summarize(c.paths.map(p=>p.expectedMinutes)).average)):null;
   const selectedRow=best?comparison.find(c=>c.candidate.id===best.candidate.id):comparison[0];
   const paths=best?best.paths:selectedRow.paths.map(p=>({...p,past:regular?(history.balances[p.memberId]||0):0,relative:null,projected:null}));
   const allCandidateResults=manualCandidates(comparison,history.balances,ids,regular,hasFairnessHistory,maxIncreaseRatio);
   const policySelection=selectRecommendationPolicy(allCandidateResults,regular,recommendationPolicy,input.recommendationPolicy?null:targetMemberId,previousPayload?.recommendedCandidateId);
   const accuracy=useApi?estimationAccuracy(comparison):{pairs:[]},biasByMember=Object.fromEntries(ids.map(memberId=>{const pairs=accuracy.pairs.filter(p=>p.memberId===memberId);return [memberId,pairs.length>=3?Math.max(-10,Math.min(10,pairs.reduce((s,p)=>s+p.errorMinutes,0)/pairs.length))*.5:0];}));
   const unused=(plan.preliminaryRows||[]).filter(r=>!plan.shortlist.some(s=>s.candidate.id===r.candidate.id));
   const priority=unused.map(row=>{const times=row.burdens?.map((b,i)=>b?Math.max(0,b.score-biasByMember[ids[i]]):null);const estimate=times?.every(Number.isFinite)?summarize(times.map((t,i)=>(history.balances[ids[i]]||0)+t-summarize(times).average)).std:Infinity;const separate=plan.shortlist.every(s=>(s.candidate.lat-row.candidate.lat)**2+(s.candidate.lon-row.candidate.lon)**2>.000049);const targetIndex=ids.indexOf(targetMemberId),remainingPositive=targetIndex>=0&&times?.every(Number.isFinite)?Math.max(0,(history.balances[targetMemberId]||0)+times[targetIndex]-summarize(times).average):Infinity;return {row,estimate,separate,remainingPositive};}).sort((a,b)=>(targetMemberId&&(history.balances[targetMemberId]||0)>0?a.remainingPositive-b.remainingPositive:0)||Number(b.separate)-Number(a.separate)||a.estimate-b.estimate||(a.row.projectedStd??Infinity)-(b.row.projectedStd??Infinity));
   const retryPool=[];for(const {row} of priority){if(retryPool.every(x=>(x.candidate.lat-row.candidate.lat)**2+(x.candidate.lon-row.candidate.lon)**2>.000025))retryPool.push(row);if(retryPool.length===5)break;}
   const payload={calculationMode,useApi,hasEstimatedHistory:history.meetings.some(m=>m.regular&&m.calculation_mode==='estimated'),manualComparison:false,targetMemberId,retryParentId:previousRun?.id||null,retryUsed:!!previousRun,totalCalls:(previousPayload?.calls||0)+calls,retryAvailable:!previousRun&&retryPool.some(r=>useApi||estimatedPaths(r,selected)),recommendationPolicy,policyInfo:policySelection.info,retryPool:previousRun?[]:retryPool.filter(r=>useApi||estimatedPaths(r,selected)),retryPlan:{generatedCount:plan.generatedCount,reachableCount:plan.reachableCount,unknownCount:plan.unknownCount,source:plan.source,updatedAt:plan.updatedAt,assumptions:plan.assumptions,localSearch:plan.localSearch,centres:plan.centres,correction:plan.correction},recommendedCandidateId:policySelection.chosen?.candidate.id||null,method:!useApi?'LOCAL_ESTIMATE':provider==='odsay'?'SINGLE_VALIDATION':'API_COMPARE',initialShortlistCount,previousRound:history.meetings.length?{venue:history.meetings.at(-1).venue,regular:!!history.meetings.at(-1).regular,records:history.meetings.at(-1).records.map(r=>({name:r.name,relative:r.relative}))}:null,fairness:{...evaluated.fairness,...(policySelection.chosen?.fairness||{}),expanded,extraCandidates:Math.max(0,comparison.length-plan.shortlist.length)},runId,regular,mode,provider,maxIncreaseRatio,memberIds:ids,historyCount:history.meetings.length,calls,status:verified?(useApi?'verified':'estimated'):'partial',generated:plan.generatedCount,shortlisted:plan.shortlistCount,reachable:plan.reachableCount,unknownCandidates:plan.unknownCount,shortlistStrategy:'local_research_v9',searchArea:plan.searchArea,localSearch:plan.localSearch,estimationAccuracy:useApi?estimationAccuracy(comparison):null,correction:plan.correction,searchCentres:plan.centres,transportModel:{railIncluded:true,railSource:railData.timeSource,railDataDate:railData.retrievedAt},
    baselineAverage:baseline,baselineMaximum:complete.length?Math.min(...complete.map(c=>summarize(c.paths.map(p=>p.expectedMinutes)).max)):null,verifiedCandidates:useApi?complete.length:0,estimatedCandidates:useApi?0:complete.length,
    comparisons:comparison.map(c=>{const summary=c.ok?summarize(c.paths.map(p=>p.expectedMinutes)):null;return {id:c.candidate.id,name:c.candidate.name,participants:c.paths.map(p=>({memberId:p.memberId,name:p.name,status:p.status,expectedMinutes:['verified','estimated'].includes(p.status)?p.expectedMinutes:null,walkMetres:['verified','estimated'].includes(p.status)?p.walkMetres:null,transfers:['verified','estimated'].includes(p.status)?p.transfers:null})),status:c.ok?(useApi?'verified':'estimated'):'partial',selectionReason:c.selectionReason,selectionRoles:c.selectionRoles,modelStatus:c.modelStatus,estimatedAverage:c.estimate?.average??null,average:summary?.average??null,gap:summary?.gap??null,eligible:ranked.some(r=>r.candidate.id===c.candidate.id),selected:best?.candidate.id===c.candidate.id,projectedStd:allCandidateResults.find(r=>r.candidate.id===c.candidate.id).projectedStd,fairness:allCandidateResults.find(r=>r.candidate.id===c.candidate.id).fairness};}),
    origins:selected.map((m,i)=>({memberId:m.id,name:m.name,label:String.fromCharCode(65+i),stopName:origins[i].name,lat:origins[i].lat,lon:origins[i].lon})),network:{source:plan.source,updatedAt:plan.updatedAt,assumptions:plan.assumptions},
    candidates:allCandidateResults,createdAt:started};
   await db.prepare('UPDATE analysis_runs SET status=?,payload=? WHERE id=?').bind(verified?'complete':'partial',JSON.stringify(payload),runId).run();
   await db.prepare('UPDATE analysis_runs SET payload=NULL WHERE room_id=? AND created_at<? AND id<>?').bind(id,started-86400000,runId).run();
   emit({type:'result',...finalPublic(payload,me)});
  }catch{await db.prepare('UPDATE analysis_runs SET status=? WHERE id=?').bind('failed',runId).run();emit({type:'error',message:'분석을 완료하지 못했습니다. 서버 설정을 확인해주세요.'});}
  finally{await db.prepare('DELETE FROM analysis_locks WHERE room_id=? AND started_at=?').bind(id,started).run();if(!disconnected)try{controller.close();}catch{}}
  })();
 },cancel(){disconnected=true;}});
 return new Response(stream,{headers:{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}