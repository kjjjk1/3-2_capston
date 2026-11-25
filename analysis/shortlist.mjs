import {balancePreference,compensationEvaluation} from './recommendation-policy.mjs';
import {centres,metres,project,unproject,generateCandidates,buildNetwork,searchBurden} from './core.mjs';
import {burdenCorrectionCentres} from './correction-centres.mjs';
import {railData} from './rail-data.mjs';
import {summarize,rankPersonalCare} from './fairness.mjs';

// These are candidate seeds, not a claim that a subway network is modelled.
const HUBS=['대전역','중앙로','시청','탄방','유성온천','정부청사','서대전네거리','용문','갈마','월평'];
export function centralSearchArea(origins,cfg={}){
 const center=centres(origins).minimax,farthest=Math.max(0,...origins.map(o=>metres(o,center))),radiusM=Math.max(cfg.centralMinRadiusM??1500,Math.min(cfg.centralMaxRadiusM??4000,farthest*(cfg.centralRadiusRatio??.5)));
 return {center,radiusM,rule:'minimax_half_span_clamped',farthestOriginM:farthest};
}
export function generateDiverseCandidates(origins,stops,balances,members,cfg){
 const correction=burdenCorrectionCentres(origins,members,balances,cfg.correctionAlphas||[.2,.4,.6]),center={median:correction.median,minimax:correction.minimax},selected=[],seen=new Map(),limit=cfg.candidateCount;
 const searchArea=centralSearchArea(origins,cfg);stops=stops.filter(s=>metres(s,searchArea.center)<=searchArea.radiusM);
 const cap=point=>{const start=project(searchArea.center),end=project(point),d=metres(searchArea.center,point),ratio=Math.min(1,searchArea.radiusM*.9/Math.max(1,d));return {...point,...unproject({x:start.x+(end.x-start.x)*ratio,y:start.y+(end.y-start.y)*ratio}),clippedToCentralArea:ratio<1};};
 // Interpolate within the permitted segment instead of clipping each anchor independently.
 if(correction.active&&correction.anchors.length){
  const start=project(cap(center.median)),end=project(cap(origins[correction.target.index])),maxAlpha=Math.max(...correction.anchors.map(a=>a.alpha));
  correction.anchors=correction.anchors.map(a=>{const t=a.alpha/maxAlpha,point=unproject({x:start.x+(end.x-start.x)*t,y:start.y+(end.y-start.y)*t});return {...a,...point,displacementM:metres(unproject(start),point),clippedToCentralArea:true};});
 }
 const near=p=>[...stops].sort((a,b)=>metres(a,p)-metres(b,p)||a.id.localeCompare(b.id));
 const add=(stop,seed,extra={})=>{if(!stop)return false;if(seen.has(stop.id)){Object.assign(seen.get(stop.id),extra);return false;}if(selected.length>=limit||selected.some(p=>metres(p,stop)<cfg.candidateSpacingM))return false;const row={...stop,seed,...extra};selected.push(row);seen.set(row.id,row);return true;};
 // Distinct quotas for original centres, correction regions, and rail/hub access.
 const anchors=[{point:center.median,seed:'median',quota:Math.ceil(limit*.2)},{point:center.minimax,seed:'minimax',quota:Math.ceil(limit*.2)},...origins.map((origin,i)=>({point:cap({lat:(searchArea.center.lat+origin.lat)/2,lon:(searchArea.center.lon+origin.lon)/2}),seed:'participant_region',memberId:members[i].id,quota:Math.ceil(limit*.07)})),...correction.anchors.map(point=>({point,seed:'directional_correction',quota:Math.ceil(limit*.06)}))];
 for(const a of [...anchors].sort((a,b)=>Number(b.seed==='directional_correction')-Number(a.seed==='directional_correction'))){let n=0;for(const stop of near(a.point)){if(a.point.alpha&&metres(stop,a.point)>(cfg.correctionRadiusM??1200))break;const extra=a.point.alpha?{weightedCorrection:true,weightedDistanceM:metres(stop,a.point),correctionAlpha:a.point.alpha,correctionTargetId:correction.target.memberId,correctionDistanceM:metres(stop,a.point)}:(a.memberId?{participantRegionId:a.memberId}:{});if(add(stop,a.seed,extra))n++;if(n>=a.quota||selected.length>=limit)break;}}
 if(cfg.includeRail)for(const station of railData.stations){const stop=near(station).find(s=>metres(s,station)<=600);add(stop,'rail_access',{railStationId:station.id});}
 for(const term of HUBS){const stop=stops.filter(s=>s.name.includes(term)).sort((a,b)=>metres(a,center.median)-metres(b,center.median))[0];add(stop,'transit_hub');}
 // Farthest-point fill over a bounded region, with incrementally maintained distances.
 const radius=Math.max(6000,...origins.map(o=>metres(o,center.median)))+2000,pool=stops.filter(s=>metres(s,center.median)<=radius&&!seen.has(s.id));
 const distances=new Map(pool.map(s=>[s.id,selected.length?Math.min(...selected.map(p=>metres(p,s))):Infinity]));
 while(selected.length<limit){let next=null,score=-1;for(const stop of pool){if(seen.has(stop.id))continue;const d=distances.get(stop.id);if(d>=cfg.candidateSpacingM&&(d>score||(d===score&&stop.id.localeCompare(next?.id||'')<0))){next=stop;score=d;}}if(!next||!add(next,'spatial_diversity'))break;for(const stop of pool)distances.set(stop.id,Math.min(distances.get(stop.id),metres(stop,next)));}
 return {searchArea,centres:{...center,corrections:correction.anchors},correction,weighting:{active:correction.active,displacementM:correction.anchors.at(-1)?.displacementM||0},candidates:selected};
}

const preliminaryContexts=new WeakMap();
export function attachPreliminaryContext(plan,context){if(context)preliminaryContexts.set(plan,context);return plan;}
export function getPreliminaryContext(plan){return preliminaryContexts.get(plan);}
export function createPreliminaryContext(origins,graph,cfg,search=searchBurden){
 const cell=Math.max(1,cfg.accessRadiusM),grid=new Map(),cache=new Map();
 graph.served.forEach((stop,index)=>{const p=project(stop),key=Math.floor(p.x/cell)+','+Math.floor(p.y/cell);if(!grid.has(key))grid.set(key,[]);grid.get(key).push({stop,index});});
 const nearby=candidate=>{const key=candidate.lat+','+candidate.lon;if(cache.has(key))return cache.get(key);const p=project(candidate),x=Math.floor(p.x/cell),y=Math.floor(p.y/cell),rows=[];for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const row of grid.get((x+dx)+','+(y+dy))||[]){const walk=metres(row.stop,candidate);if(walk<=cfg.accessRadiusM)rows.push({...row,walk});}rows.sort((a,b)=>a.index-b.index);cache.set(key,rows);return rows;};
 return {graph,originKey:JSON.stringify(origins.map(o=>[o.lat,o.lon])),configKey:JSON.stringify(cfg),searches:origins.map(o=>search(o,graph,cfg)),nearby};
}
export function evaluatePreliminary(origins,candidates,graph,cfg,members,balances,regular,context=null){
 if(!context||context.graph!==graph||context.originKey!==JSON.stringify(origins.map(o=>[o.lat,o.lon]))||context.configKey!==JSON.stringify(cfg))context=createPreliminaryContext(origins,graph,cfg);
 const searches=context.searches;
 return candidates.map(candidate=>{
  const burdens=searches.map(search=>{
   let best=null;for(const {stop,walk} of context.nearby(candidate)){const base=search.get(stop.id);if(!base)continue;
    const row={...base,score:base.score+walk/100*cfg.walkWeightPer100m+(stop.kind==='rail'?(cfg.railExitMinutes??2):0),walk:base.walk+walk};if(!best||row.score<best.score)best=row;
   }return best;
  });
  const coverage=burdens.filter(Boolean).length,complete=coverage===origins.length;
  const summary=complete?summarize(burdens.map(b=>b.score)):null;
  const projectedStd=complete?summarize(burdens.map((b,i)=>(regular?(balances[members[i].id]||0):0)+b.score-summary.average)).std:null;
  const distances=origins.map(o=>metres(o,candidate)),geo=summarize(distances);
  return {candidate,burdens,summary,projectedStd,coverage,status:complete?(burdens.some(b=>b.usedRail)?'integrated_model_estimated':'bus_model_estimated'):'insufficient_transit_data',geo};
 });
}

export function chooseDiverseShortlist(rows,count=5,options={}){
 count=Math.max(3,Math.min(5,Math.floor(count)||5));const selected=[],ids=new Map(),known=rows.filter(r=>r.summary),unknown=rows.filter(r=>!r.summary);
 const add=(row,role)=>{if(!row)return;if(ids.has(row.candidate.id)){ids.get(row.candidate.id).selectionRoles.push(role);return;}if(selected.length<count){const item={...row,selectionReason:role,selectionRoles:[role]};selected.push(item);ids.set(row.candidate.id,item);}};
 const best=(pool,score)=>[...pool].sort((a,b)=>score(a)-score(b)||(a.summary?.average??Infinity)-(b.summary?.average??Infinity)||a.candidate.id.localeCompare(b.candidate.id))[0];
 if(options.regular&&options.targetMemberId&&options.members?.some(m=>m.id===options.targetMemberId)){
  add(best(known,r=>r.projectedStd),'cumulative_fairness');
  const modeled=known.map(r=>({...r,paths:r.burdens.map((b,i)=>({memberId:options.members[i].id,status:'verified',past:options.balances?.[options.members[i].id]||0,relative:b.score-r.summary.average,projected:(options.balances?.[options.members[i].id]||0)+b.score-r.summary.average}))}));
  const personal=rankPersonalCare(modeled,options.targetMemberId);
  for(const row of personal){if(selected.length>=count)break;add(row,'personal_care');}
  if(selected.length===count)return selected;
 }
 if(options.members?.length){
  if(options.regular){
   // Keep the strongest fairness candidate; subsequent slots explore distinct regions.
   const diverse=pool=>{const rest=pool.filter(r=>!ids.has(r.candidate.id)),before=summarize(options.members.map(m=>options.balances?.[m.id]||0)).std,improving=rest.filter(r=>r.projectedStd<before-.01),remaining=improving.length?improving:rest,separated=remaining.filter(r=>selected.every(c=>metres(c.candidate,r.candidate)>=700));return separated.length?separated:remaining;};
   add(best(known,r=>r.projectedStd),'cumulative_fairness');
   add(best(diverse(known),r=>r.projectedStd),'cumulative_fairness_alternative');
   add(best(diverse(known.filter(r=>r.candidate.weightedCorrection)),r=>r.projectedStd),'directional_correction');
   add(best(diverse(known.filter(r=>r.burdens?.some(b=>b?.usedRail)||r.candidate.railStationId||r.candidate.seed==='transit_hub')),r=>r.projectedStd),'transit_fairness');
   while(selected.length<count){const pool=diverse(known);if(!pool.length)break;add(best(pool,r=>r.projectedStd),'regional_fairness');}
  }else{
   add(best(known,r=>r.summary.average),'efficiency');
   add(best(known,r=>r.summary.max),'minimax_time');
   add(best(known,r=>r.summary.std),'time_balance');
  }
 }else{
 add(best(known,r=>r.summary.average),'efficiency');
 add(best(known,r=>r.summary.max??Math.max(...(r.burdens||[]).filter(Boolean).map(b=>b.score))),'minimax_time');
 add(best(known,r=>r.summary.std??r.summary.gap),'time_balance');
 add(best(known,r=>r.projectedStd),'cumulative_fairness');
 const weighted=rows.filter(r=>r.candidate.weightedCorrection);
 if(weighted.length){const uncertain=weighted.filter(r=>!r.summary);add(uncertain.length?best(uncertain,r=>r.candidate.correctionDistanceM??r.candidate.weightedDistanceM??r.geo.average):best(weighted,r=>r.projectedStd),'weighted_correction');}
 }
 // Shared winners free slots for data uncertainty and transport/geographic diversity.
 if(selected.length<count&&unknown.length)add(best(unknown,r=>r.geo.average),'data_gap_exploration');
 if(selected.length<count)add(best(rows.filter(r=>!ids.has(r.candidate.id)&&(r.candidate.railStationId||r.candidate.seed==='transit_hub')),r=>r.geo.average),'transit_hub');
 while(selected.length<Math.min(count,rows.length)){const rest=rows.filter(r=>!ids.has(r.candidate.id));if(!rest.length)break;const row=best(rest,r=>-Math.min(...selected.map(p=>metres(p.candidate,r.candidate))));add(row,'spatial_diversity');}
 return selected;
}

export function planDiverse(origins,stops,network,members,balances,regular,cfg,count,targetMemberId=null){
 const generated=generateDiverseCandidates(origins,stops,regular?balances:{},members,cfg);
 const graph=buildNetwork(stops,network,cfg),context=createPreliminaryContext(origins,graph,cfg),rows=evaluatePreliminary(origins,generated.candidates,graph,cfg,members,balances,regular,context);
 const beforeStd=summarize(members.map(m=>balances[m.id]||0)).std,seen=new Set(rows.map(r=>r.candidate.id)),passes=[{round:1,added:rows.length}],active=regular&&beforeStd>.01;
 if(active){
  const remaining=()=>stops.filter(s=>!seen.has(s.id)&&metres(s,generated.searchArea.center)<=generated.searchArea.radiusM);
  // Pass 2 covers gaps between initial seeds; pass 3 refines promising regions.
  for(let pass=2;pass<=3;pass++){
   let pool=remaining();const candidates=[],limit=Math.min(100,cfg.candidateCount||100);
   const anchors=[...rows].filter(r=>Number.isFinite(r.projectedStd)).sort((a,b)=>a.projectedStd-b.projectedStd).slice(0,8);
   if(pass===3&&anchors.length)pool.sort((a,b)=>Math.min(...anchors.map(r=>metres(a,r.candidate)))-Math.min(...anchors.map(r=>metres(b,r.candidate)))||a.id.localeCompare(b.id));
   if(pass===2){const distances=new Map(pool.map(s=>[s.id,Math.min(...rows.map(r=>metres(s,r.candidate)))]));pool.sort((a,b)=>distances.get(b.id)-distances.get(a.id)||a.id.localeCompare(b.id));}
   for(const stop of pool){if(candidates.every(c=>metres(c,stop)>= (pass===2?120:60))){candidates.push({...stop,seed:pass===2?'local_gap_search':'local_fairness_refinement'});seen.add(stop.id);}if(candidates.length>=limit)break;}
   if(!candidates.length)break;
   rows.push(...evaluatePreliminary(origins,candidates,graph,cfg,members,balances,regular,context));passes.push({round:pass,added:candidates.length});
  }
 }
 const localSearch={passes,uniqueCandidates:rows.length,beforeStd,estimatedImproving:rows.filter(r=>Number.isFinite(r.projectedStd)&&r.projectedStd<beforeStd-.01).length,extraApiCalls:0};
 const shortlist=chooseDiverseShortlist(rows,count,{members,origins,balances,regular,targetMemberId});
 const chosenIds=new Set(shortlist.map(r=>r.candidate.id));const expansion=rows.filter(r=>!chosenIds.has(r.candidate.id)).sort((a,b)=>(a.projectedStd??Infinity)-(b.projectedStd??Infinity)||a.geo.average-b.geo.average).slice(0,2).map(r=>({...r,selectionReason:'fairness_research'}));
 return attachPreliminaryContext({shortlist,expansion,preliminaryRows:rows,localSearch,searchArea:generated.searchArea,centres:generated.centres,correction:{...generated.correction,regions:generated.correction.anchors.map(a=>({alpha:a.alpha,generated:rows.filter(r=>r.candidate.correctionAlpha===a.alpha).length,shortlisted:shortlist.filter(r=>r.candidate.correctionAlpha===a.alpha).length})),missingRegions:generated.correction.anchors.filter(a=>!shortlist.some(r=>r.candidate.correctionAlpha===a.alpha)).map(a=>a.alpha)},weighting:generated.weighting,weightedCandidateCount:rows.filter(r=>r.candidate.weightedCorrection).length,weightedShortlistCount:shortlist.filter(r=>r.candidate.weightedCorrection).length,generatedCount:rows.length,reachableCount:rows.filter(r=>r.summary).length,unknownCount:rows.filter(r=>!r.summary).length},context);
}


// Reserve different purposes and regions instead of spending the entire API budget on one cluster.
export function chooseBalancedShortlist(rows,count=5,options={}){
 count=Math.max(1,Math.min(5,Math.floor(count)||5));const members=options.members||[],balances=options.balances||{},regular=options.regular!==false,minSpacingM=options.minSpacingM??1000,previous=options.previousCandidates||[],selected=[],seen=new Map();
 const modeled=rows.filter(r=>r.summary&&r.burdens?.length===members.length&&r.burdens.every(b=>b&&Number.isFinite(b.score))).map(r=>({...r,paths:r.burdens.map((b,i)=>({memberId:members[i].id,past:regular?(balances[members[i].id]||0):0,projected:(regular?(balances[members[i].id]||0):0)+b.score-r.summary.average}))}));
 const hasDebt=regular&&members.some(m=>Math.abs(balances[m.id]||0)>.01),tie=(a,b)=>a.candidate.id.localeCompare(b.candidate.id),byStd=[...modeled].sort((a,b)=>a.projectedStd-b.projectedStd||a.summary.average-b.summary.average||tie(a,b));
 const compensation=hasDebt?balancePreference(modeled,summarize(members.map(m=>balances[m.id]||0)).std):byStd;
 const distance=r=>{const refs=[...selected.map(r=>r.candidate),...previous];return refs.length?Math.min(...refs.map(p=>metres(p,r.candidate))):Infinity;};
 const add=(row,role)=>{if(!row)return;if(seen.has(row.candidate.id)){const old=seen.get(row.candidate.id);if(!old.selectionRoles.includes(role))old.selectionRoles.push(role);return;}if(selected.length>=count)return;const item={...row,selectionReason:role,selectionRoles:[role]};selected.push(item);seen.set(item.candidate.id,item);};
 const role=(ranked,name)=>{if(!ranked.length)return;if(seen.has(ranked[0].candidate.id)){add(ranked[0],name);return;}const distant=ranked.find(r=>!seen.has(r.candidate.id)&&distance(r)>=minSpacingM);if(distant)add(distant,name);else if(!selected.length)add(ranked[0],name);};
 role(compensation,hasDebt?'compensation':'initial_balance');role(byStd,'cumulative_dispersion');
 const relief=(r,positive)=>r.paths.reduce((sum,p)=>sum+((positive?p.past>.01:p.past<-.01)?Math.abs(p.past)-Math.abs(p.projected):0),0);
 if(hasDebt&&members.some(m=>(balances[m.id]||0)>.01))role([...modeled].sort((a,b)=>relief(b,true)-relief(a,true)||a.projectedStd-b.projectedStd||tie(a,b)),'positive_burden_relief');
 if(hasDebt&&members.some(m=>(balances[m.id]||0)<-.01))role([...modeled].sort((a,b)=>relief(b,false)-relief(a,false)||a.projectedStd-b.projectedStd||tie(a,b)),'negative_benefit_rebalance');
 const all=[...rows].sort((a,b)=>tie(a,b));
 while(selected.length<count){const remaining=all.filter(r=>!seen.has(r.candidate.id));if(!remaining.length)break;let pool=[];for(const spacing of [...new Set([minSpacingM,Math.min(700,minSpacingM),Math.min(350,minSpacingM),0])]){pool=remaining.filter(r=>distance(r)>=spacing);if(pool.length)break;}pool.sort((a,b)=>distance(b)-distance(a)||Number(!!b.summary)-Number(!!a.summary)||tie(a,b));const row=pool[0];if(!row)break;add(row,row.summary?'regional_alternative':'data_gap_exploration');}
 const distances=[];for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++)distances.push(metres(selected[i].candidate,selected[j].candidate));
 Object.defineProperty(selected,'diversity',{value:{requestedSpacingM:minSpacingM,minPairDistanceM:distances.length?Math.min(...distances):null,maxPairDistanceM:distances.length?Math.max(...distances):null,relaxed:distances.some(d=>d<minSpacingM),roles:selected.map(r=>({candidateId:r.candidate.id,roles:r.selectionRoles}))},enumerable:false});
 return selected;
}

// Calibrate only near measured destinations and only for the same model transport class.
export function calibrateRetryEstimates(rows,comparisons,members,balances,options={}){
 const radiusM=options.radiusM??2000,maxCorrectionMinutes=options.maxCorrectionMinutes??15,maxFraction=options.maxFraction??.25,observations=[];
 for(const c of comparisons){if(!c.ok)continue;for(let i=0;i<members.length;i++){const b=c.estimatedBurdens?.[i],path=c.paths.find(p=>p.memberId===members[i].id);if(b&&Number.isFinite(b.score)&&path?.status==='verified'&&Number.isFinite(path.expectedMinutes))observations.push({memberId:members[i].id,candidate:c.candidate,error:b.score-path.expectedMinutes,usedRail:!!b.usedRail});}}
 let correctedRows=0;
 const adjusted=rows.map(row=>{if(!row.summary||!row.burdens?.every(Boolean))return row;const raw=row.rawBurdens||row.burdens,corrections=[];
  const burdens=raw.map((b,i)=>{const nearby=observations.filter(o=>o.memberId===members[i].id&&o.usedRail===!!b.usedRail&&metres(o.candidate,row.candidate)<=radiusM).sort((a,b)=>metres(a.candidate,row.candidate)-metres(b.candidate,row.candidate)),distinct=[];for(const o of nearby)if(distinct.every(p=>metres(p.candidate,o.candidate)>=150))distinct.push(o);let correction=0;if(distinct.length>=2){let total=0,weight=0;for(const o of distinct){const w=1/(250+metres(o.candidate,row.candidate));total+=w*o.error;weight+=w;}const cap=Math.min(maxCorrectionMinutes,b.score*maxFraction);correction=Math.max(-cap,Math.min(cap,total/weight*distinct.length/(distinct.length+3)));}corrections.push(correction);return {...b,score:Math.max(0,b.score-correction)};});
  if(!corrections.some(c=>Math.abs(c)>.000001))return row;correctedRows++;const summary=summarize(burdens.map(b=>b.score)),projectedStd=summarize(burdens.map((b,i)=>(balances[members[i].id]||0)+b.score-summary.average)).std;
  return {...row,rawBurdens:raw,burdens,summary,projectedStd,estimateCorrection:{minutes:corrections,radiusM,estimated:true}};
 });
 return {rows:adjusted,diagnostic:{observations:observations.length,correctedRows,radiusM,maxCorrectionMinutes,maxFraction,minDistinctLocations:2,shrinkagePrior:3}};
}
