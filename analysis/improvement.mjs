import {rankVerified,summarize} from './fairness.mjs';
export function evaluateImprovement(candidates,balances,memberIds,regular,hasHistory){
 const before=summarize(memberIds.map(id=>balances[id]||0)).std;
 const eligible=rankVerified(candidates,balances,regular,{maxIncreaseRatio:.10});
 const improving=regular&&hasHistory&&before>.01?eligible.filter(c=>c.projectedStd<before-.01):[];
 const maximum=Math.max(0,...memberIds.map(id=>balances[id]||0));
 const targetIds=regular&&hasHistory&&maximum>.01?memberIds.filter(id=>Math.abs((balances[id]||0)-maximum)<.01):[];
 const correctionCandidates=targetIds.length?eligible.filter(c=>targetIds.every(id=>c.paths.some(p=>p.memberId===id&&p.relative<-.01))):[];
 const correction={active:targetIds.length>0,targetMemberIds:targetIds,matchedCandidates:correctionCandidates.length,status:!targetIds.length?'not_needed':correctionCandidates.length?'target_reduced':'no_target_reduction'};
 const improvingCorrection=improving.filter(c=>correctionCandidates.includes(c));
 const best=improvingCorrection[0]||improving[0]||eligible[0]||null;
 correction.status=!targetIds.length?'not_needed':best&&correctionCandidates.includes(best)?'target_reduced':'no_target_reduction';
 const recommendation=regular&&hasHistory&&before>.01?(improving.length?'improvement':'no_improvement'):'initial_or_casual';
 if(!best)return {best:null,eligible,fairness:{recommendation,correction,status:'unverified',beforeStd:before,afterStd:null,improved:false,requiresAcknowledgement:false}};
 const after=best.projectedStd,delta=before-after;
 const status=!regular?'casual':!hasHistory?'first_meeting':after<before-.01?'improved':Math.abs(after-before)<=.01?'maintained':before<=.01?'balanced_start':'worsened';
 return {best,eligible,fairness:{recommendation,correction,status,beforeStd:before,afterStd:after,improved:status==='improved',changeMinutes:delta,improvementPercent:before>.01?delta/before*100:null,requiresAcknowledgement:regular&&hasHistory&&after>before+.01,comparableMemberIds:[...memberIds]}};
}
