import {resultAlternatives,summarize} from './fairness.mjs';
// Positive/negative historical burdens are evaluated symmetrically in minutes.
export function compensationEvaluation(paths){
 if(!paths?.length||paths.some(p=>!Number.isFinite(p.past)||!Number.isFinite(p.projected)))return null;
 const members=paths.map(p=>{const gain=Math.abs(p.past)-Math.abs(p.projected);return {memberId:p.memberId,name:p.name,past:p.past,projected:p.projected,gain,worsening:Math.max(0,-gain),overshoot:p.past*p.projected<0?Math.abs(p.projected):0};});
 const before=summarize(paths.map(p=>p.past)),after=summarize(paths.map(p=>p.projected));
 const netGain=members.reduce((sum,p)=>sum+p.gain,0),totalWorsening=members.reduce((sum,p)=>sum+p.worsening,0),overshoot=members.reduce((sum,p)=>sum+p.overshoot,0),gapIncrease=Math.max(0,after.gap-before.gap),maxWorsening=Math.max(...members.map(p=>p.worsening));
 return {version:2,netGain,totalWorsening,maxWorsening,overshoot,beforeGap:before.gap,afterGap:after.gap,gapIncrease,score:netGain-totalWorsening-overshoot-gapIncrease,improvedCount:members.filter(p=>p.gain>.01).length,worsenedCount:members.filter(p=>p.gain<-.01).length,members};
}
export function compensationScore(paths){return compensationEvaluation(paths)?.score??-Infinity;}
export function balancePreference(candidates,beforeStd,previousCandidateId=null){
 const rows=candidates.filter(c=>Number.isFinite(c.projectedStd)&&compensationEvaluation(c.paths));
 if(!rows.length)return [];
 const metrics=new Map(rows.map(c=>[c,compensationEvaluation(c.paths)]));
 // Cumulative dispersion is the primary objective; personal compensation only breaks exact ties.
 const compare=(a,b)=>{const x=metrics.get(a),y=metrics.get(b);return a.projectedStd-b.projectedStd||y.score-x.score||a.summary.average-b.summary.average||(a.candidate.id===previousCandidateId?-1:b.candidate.id===previousCandidateId?1:a.candidate.id.localeCompare(b.candidate.id));};
 return [...rows].sort(compare);
}
// Secondary alternative: jointly compensate the most burdened and most favoured attendees.
export function minimaxCompensationAlternative(candidates){
 const valid=candidates.filter(c=>c.summary&&c.paths?.length&&c.eligible!==false);
 if(!valid.length)return null;
 const past=valid[0].paths,max=Math.max(...past.map(p=>p.past)),min=Math.min(...past.map(p=>p.past));
 if(max<=.01||min>=-.01)return null;
 const targets=past.filter(p=>Math.abs(p.past-max)<.01||Math.abs(p.past-min)<.01).map(p=>p.memberId);
 const cap=Math.max(Math.abs(max),Math.abs(min));
 const acceptable=valid.filter(c=>targets.every(id=>{const p=c.paths.find(p=>p.memberId===id);return p&&Math.abs(p.projected)<Math.abs(p.past)-.01;})&&c.paths.every(p=>targets.includes(p.memberId)||Math.abs(p.projected)<=Math.max(Math.abs(p.past),cap)+.01));
 const worst=c=>Math.max(...c.paths.filter(p=>targets.includes(p.memberId)).map(p=>Math.abs(p.projected)));
 return [...acceptable].sort((a,b)=>worst(a)-worst(b)||a.projectedStd-b.projectedStd||a.summary.average-b.summary.average||a.candidate.id.localeCompare(b.candidate.id))[0]||null;
}
export function selectRecommendationPolicy(candidates,regular,policy='balance',targetMemberId=null,previousCandidateId=null){
 const base=resultAlternatives(candidates,regular,targetMemberId);
 const old=candidates.find(c=>c.candidate.id===previousCandidateId&&c.eligible!==false&&c.summary),fair=candidates.find(c=>c.candidate.id===base.fairnessId),fast=candidates.find(c=>c.candidate.id===base.efficiencyId);
 const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-8;
 if(old&&fair&&close(regular?old.projectedStd:old.summary.std,regular?fair.projectedStd:fair.summary.std)&&close(old.summary.average,fair.summary.average))base.fairnessId=old.candidate.id;
 if(old&&fast&&close(old.summary.average,fast.summary.average)&&close(old.summary.max,fast.summary.max)&&close(regular?old.projectedStd:old.summary.std,regular?fast.projectedStd:fast.summary.std))base.efficiencyId=old.candidate.id;
 const valid=candidates.filter(c=>c.eligible!==false&&c.summary&&c.paths?.length&&c.paths.every(p=>['verified','estimated'].includes(p.status)&&p.status===c.paths[0].status&&Number.isFinite(p.past)&&Number.isFinite(p.projected)));
 const reference=valid[0],beforeStd=reference?summarize(reference.paths.map(p=>p.past)).std:null;
 if(!reference)return {alternatives:base,chosen:null,info:{policy,status:'unavailable',met:false,beforeStd:null,afterStd:null,targetMemberIds:[]}};
 if(policy!=='protect'&&regular&&targetMemberId){const chosen=valid.find(c=>c.candidate.id===base.fairnessId)||null;return {alternatives:base,chosen,info:{policy:'balance',status:!chosen?'unavailable':beforeStd<=.01?'balanced_start':chosen.projectedStd<beforeStd-.01?'improved':'not_improved',met:!!chosen&&chosen.projectedStd<beforeStd-.01,beforeStd,afterStd:chosen?.projectedStd??null,targetMemberIds:[]}};}
 if(policy!=='protect'||!regular){
  const hasDebt=reference.paths.some(p=>Math.abs(p.past)>.01);
  const ranked=regular&&hasDebt?balancePreference(valid,beforeStd,previousCandidateId):valid.filter(c=>c.candidate.id===base.fairnessId);
  const chosen=ranked[0]||valid.find(c=>c.candidate.id===base.fairnessId)||null;
  const allowed=valid;
  const compensation=chosen?compensationEvaluation(chosen.paths):null;
  const efficiency=minimaxCompensationAlternative(allowed);
  return {alternatives:{...base,fairnessId:chosen?.candidate.id||null,efficiencyId:chosen?efficiency?.candidate.id||null:null,...(base.personalId&&!allowed.some(c=>c.candidate.id===base.personalId)?{personalId:null}:{})},chosen,info:{policy:'balance',status:!chosen?'unavailable':!regular?'casual':!hasDebt?'balanced_start':chosen.projectedStd<beforeStd-.01?'improved':'not_improved',met:!!chosen&&regular&&chosen.projectedStd<beforeStd-.01,beforeStd,afterStd:chosen?.projectedStd??null,targetMemberIds:[],compensation,compensationScore:compensation?.score??null,stdImproved:!!chosen&&chosen.projectedStd<beforeStd-.01}};
 }
 const maximum=Math.max(0,...(reference?.paths||[]).map(p=>p.past));
 const targets=maximum>.01?reference.paths.filter(p=>Math.abs(p.past-maximum)<.01).map(p=>p.memberId):[];
 if(!targets.length){const chosen=valid.find(c=>c.candidate.id===base.fairnessId)||null;return {alternatives:{fairnessId:base.fairnessId,efficiencyId:base.efficiencyId},chosen,info:{policy:'protect',status:'no_positive_burden',met:false,beforeStd,afterStd:chosen?.projectedStd??null,targetMemberIds:[]}};}
 const protectedRows=valid.filter(c=>targets.every(id=>{const p=c.paths.find(p=>p.memberId===id);return p&&Math.max(0,p.projected)<Math.max(0,p.past)-.01;}));
 const remaining=c=>targets.map(id=>Math.max(0,c.paths.find(p=>p.memberId===id).projected));
 protectedRows.sort((a,b)=>Math.max(...remaining(a))-Math.max(...remaining(b))||remaining(a).reduce((x,y)=>x+y,0)-remaining(b).reduce((x,y)=>x+y,0)||a.projectedStd-b.projectedStd||a.summary.average-b.summary.average||(a.candidate.id===previousCandidateId?-1:b.candidate.id===previousCandidateId?1:a.candidate.id.localeCompare(b.candidate.id)));
 const winner=protectedRows[0]||null,chosen=winner;
 const protectedEfficiency=[...protectedRows].sort((a,b)=>a.summary.average-b.summary.average||a.summary.max-b.summary.max||a.candidate.id.localeCompare(b.candidate.id))[0];
 return {alternatives:{fairnessId:winner?.candidate.id||null,efficiencyId:protectedEfficiency?.candidate.id||null},chosen,info:{policy:'protect',status:winner?'protected':'protection_failed',met:!!winner,beforeStd,afterStd:chosen?.projectedStd??null,targetMemberIds:targets,targetNames:reference.paths.filter(p=>targets.includes(p.memberId)).map(p=>p.name)}};
}
