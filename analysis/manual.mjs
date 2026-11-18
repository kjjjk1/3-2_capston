import {summarize,rankVerified} from './fairness.mjs';
import {evaluateImprovement} from './improvement.mjs';
export function manualCandidates(rows,balances,ids,regular,hasHistory,ratio=.10){
 const verified=rows.filter(r=>r.ok);
 const eligibleIds=new Set(rankVerified(verified,balances,regular,{maxIncreaseRatio:ratio}).map(r=>r.candidate.id));
 return rows.map(r=>{
  const summary=r.ok?summarize(r.paths.map(p=>p.expectedMinutes)):null;
  const paths=r.paths.map(p=>{const past=regular?(balances[p.memberId]||0):0,relative=summary?p.expectedMinutes-summary.average:null;return {...p,past,relative,projected:relative===null?null:past+relative};});
  const fairness=evaluateImprovement(r.ok?[r]:[],balances,ids,regular,hasHistory).fairness;
  return {candidate:r.candidate,paths,summary,projectedStd:summary?summarize(paths.map(p=>p.projected)).std:null,fairness,eligible:eligibleIds.has(r.candidate.id),estimate:{summary:r.estimate,projectedStd:null}};
 });
}
