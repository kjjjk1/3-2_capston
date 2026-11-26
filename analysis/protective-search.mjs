import {summarize} from './fairness.mjs';
import {balancePreference,compensationEvaluation} from './recommendation-policy.mjs';
import {metres,buildNetwork} from './core.mjs';
import {evaluatePreliminary,createPreliminaryContext,attachPreliminaryContext,getPreliminaryContext,chooseBalancedShortlist} from './shortlist.mjs';
// Expand from the original centre toward every participant tied for maximum debt.
export function expandProtectiveSearch(plan,origins,stops,network,members,balances,cfg,count=5){
 const maximum=Math.max(0,...members.map(m=>balances[m.id]||0));
 if(maximum<=.01)return plan;
 const targets=members.map((m,i)=>({id:m.id,index:i,past:balances[m.id]||0})).filter(t=>Math.abs(t.past-maximum)<.01);
 const center=plan.searchArea.center,radiusM=Math.max(800,Math.min(2000,plan.searchArea.radiusM*.6));
 const areas=targets.flatMap(t=>[.4,.75,1].map(f=>({center:{lat:center.lat+(origins[t.index].lat-center.lat)*f,lon:center.lon+(origins[t.index].lon-center.lon)*f},radiusM,targetMemberId:t.id,fraction:f})));
 const seen=new Set(plan.preliminaryRows.map(r=>r.candidate.id)),extra=[];
 // Round robin preserves coverage of each direction and each expansion stage.
 const pools=areas.map(a=>stops.filter(s=>!seen.has(s.id)&&metres(s,a.center)<=a.radiusM).sort((a1,b)=>metres(a1,a.center)-metres(b,a.center)||a1.id.localeCompare(b.id)));
 while(extra.length<200&&pools.some(a=>a.length))for(const pool of pools){
  let s;while(pool.length){const next=pool.shift();if(!seen.has(next.id)&&extra.every(c=>metres(c,next)>=120)){s=next;break;}}
  if(s){seen.add(s.id);extra.push({...s,seed:'protective_directional_expansion'});}if(extra.length>=200)break;
 }
 const context=getPreliminaryContext(plan)||createPreliminaryContext(origins,buildNetwork(stops,network,cfg),cfg);
 const additional=evaluatePreliminary(origins,extra,context.graph,cfg,members,balances,true,context),rows=[...plan.preliminaryRows,...additional];
 const remaining=r=>targets.map(t=>Math.max(0,t.past+r.burdens[t.index].score-r.summary.average));
 const protects=r=>r.summary&&r.burdens?.every(Boolean)&&targets.every((t,i)=>remaining(r)[i]<t.past-.01);
 const rank=(a,b)=>Math.max(...remaining(a))-Math.max(...remaining(b))||remaining(a).reduce((x,y)=>x+y,0)-remaining(b).reduce((x,y)=>x+y,0)||a.projectedStd-b.projectedStd||a.summary.average-b.summary.average||a.candidate.id.localeCompare(b.candidate.id);
 const central=plan.preliminaryRows.filter(protects).sort(rank),protectedRows=rows.filter(protects).sort(rank);
 const pool=central.length?central:protectedRows.length?protectedRows:rows.filter(r=>r.summary&&r.burdens?.every(Boolean)).sort(rank);
 const shortlist=pool.slice(0,Math.max(1,Math.min(5,count))).map(r=>({...r,selectionReason:'maximum_burden_protection'}));
 return attachPreliminaryContext({...plan,shortlist,preliminaryRows:rows,generatedCount:rows.length,reachableCount:rows.filter(r=>r.summary).length,unknownCount:rows.filter(r=>!r.summary).length,
 protectiveSearch:{targetMemberIds:targets.map(t=>t.id),areas,expanded:true,added:extra.length,centralProtectiveCount:central.length,protectiveCount:protectedRows.length,stage:central.length?'central':protectedRows.length?'directional':'no_estimated_protection'}},context);
}

// Expansion changes candidate coverage, never the original participant coordinates.
export function expandBalanceSearch(plan,origins,stops,network,members,balances,cfg,count=5,forceExpansion=false){
 const before=summarize(members.map(m=>balances[m.id]||0)).std;
 if(before<=.01){const shortlist=chooseBalancedShortlist(plan.preliminaryRows,count,{members,balances,regular:true,minSpacingM:1000});return attachPreliminaryContext({...plan,shortlist,shortlistDiversity:shortlist.diversity},getPreliminaryContext(plan));}
 const modeled=rows=>rows.filter(r=>r.summary&&r.burdens?.every(Boolean)).map(r=>({...r,paths:r.burdens.map((b,i)=>({past:balances[members[i].id]||0,projected:(balances[members[i].id]||0)+b.score-r.summary.average}))}));
 const central=forceExpansion?[]:modeled(plan.preliminaryRows).filter(r=>{const c=compensationEvaluation(r.paths);return c.netGain>.01&&c.maxWorsening<=.01&&c.afterGap<=c.beforeGap+.01;});
 let expanded=plan,rows=plan.preliminaryRows;
 if(before>.01){
  expanded=expandProtectiveSearch(plan,origins,stops,network,members,balances,cfg,count);rows=expanded.preliminaryRows;
  const context=getPreliminaryContext(expanded)||getPreliminaryContext(plan),seen=new Set(rows.map(r=>r.candidate.id));
  if(context){const additional=stops.filter(s=>!seen.has(s.id)).map(s=>({...s,seed:'citywide_balance'}));rows=[...rows,...evaluatePreliminary(origins,additional,context.graph,cfg,members,balances,true,context)];}
 }
 const known=modeled(rows),ranked=balancePreference(known,before);
 const fallback=[...known].sort((a,b)=>a.projectedStd-b.projectedStd||a.summary.average-b.summary.average||a.candidate.id.localeCompare(b.candidate.id));
 const ordered=ranked.length?ranked:fallback;
 if(!ordered.length)return {...plan,balanceSearch:{expanded:expanded!==plan,improvingCount:0}};
 const selected=chooseBalancedShortlist(rows,count,{members,balances,regular:true,minSpacingM:1000});
 return attachPreliminaryContext({...plan,shortlist:selected,preliminaryRows:rows,shortlistDiversity:selected.diversity,generatedCount:rows.length,reachableCount:rows.filter(r=>r.summary).length,unknownCount:rows.filter(r=>!r.summary).length,balanceSearch:{expanded:expanded!==plan,added:rows.length-plan.preliminaryRows.length,compensatingCount:ranked.filter(r=>compensationEvaluation(r.paths).netGain>.01).length,stage:central.length?'central':ranked.some(r=>compensationEvaluation(r.paths).netGain>.01)?'directional':'no_estimated_compensation'}},getPreliminaryContext(expanded)||getPreliminaryContext(plan));
}
