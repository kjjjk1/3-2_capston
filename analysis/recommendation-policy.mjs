import {resultAlternatives,summarize} from './fairness.mjs';
// Compare compensation only within half a minute of the best improving dispersion.
export const balanceTieMinutes=.5;
// Reward movement toward zero for every attendee, symmetrically for positive/negative history.
// Crossing zero incurs an additional penalty; this is a preference, never a forced sign flip.
export function compensationScore(paths){
 let weighted=0,totalWeight=0;
 for(const p of paths){
  if(!Number.isFinite(p.past)||!Number.isFinite(p.projected))return -Infinity;
  const weight=Math.max(1,Math.abs(p.past));
  const overshoot=p.past*p.projected<0?Math.abs(p.projected):0;
  weighted+=weight*(Math.abs(p.past)-Math.abs(p.projected)-overshoot);
  totalWeight+=weight;
 }
 return totalWeight?weighted/totalWeight:0;
}
export function balancePreference(candidates,beforeStd,previousCandidateId=null){
 const improving=candidates.filter(c=>Number.isFinite(c.projectedStd)&&(beforeStd<=.01||c.projectedStd<beforeStd-.01));
 if(!improving.length)return [];
 const best=Math.min(...improving.map(c=>c.projectedStd));
 const relief=c=>compensationScore(c.paths);
 const near=improving.filter(c=>c.projectedStd<=best+balanceTieMinutes);
 near.sort((a,b)=>relief(b)-relief(a)||a.projectedStd-b.projectedStd||a.summary.average-b.summary.average||(a.candidate.id===previousCandidateId?-1:b.candidate.id===previousCandidateId?1:a.candidate.id.localeCompare(b.candidate.id)));
 return [...near,...improving.filter(c=>!near.includes(c)).sort((a,b)=>a.projectedStd-b.projectedStd||a.candidate.id.localeCompare(b.candidate.id))];
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
  const ranked=regular&&beforeStd>.01?balancePreference(valid,beforeStd,previousCandidateId):valid.filter(c=>c.candidate.id===base.fairnessId);
  const chosen=ranked[0]||null;
  const allowed=regular&&beforeStd>.01?valid.filter(c=>c.projectedStd<beforeStd-.01):valid;
  const efficiency=[...allowed].sort((a,b)=>a.summary.average-b.summary.average||a.summary.max-b.summary.max||a.candidate.id.localeCompare(b.candidate.id))[0];
  return {alternatives:{...base,fairnessId:chosen?.candidate.id||null,efficiencyId:chosen?efficiency?.candidate.id||null:null,...(base.personalId&&!allowed.some(c=>c.candidate.id===base.personalId)?{personalId:null}:{})},chosen,info:{policy:'balance',status:!chosen?'not_improved':beforeStd<=.01?'balanced_start':!regular?'casual':'improved',met:!!chosen&&regular&&chosen.projectedStd<beforeStd-.01,beforeStd,afterStd:chosen?.projectedStd??null,targetMemberIds:[],tieToleranceMinutes:balanceTieMinutes,compensationScore:chosen?compensationScore(chosen.paths):null}};
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
