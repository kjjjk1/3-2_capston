import {rankVerified,rankPersonalCare} from './fairness.mjs';
export function verificationPlan(plan,provider,balances,regular){
 if(provider!=='odsay')return plan.shortlist;
 if(plan.protectiveSearch)return plan.shortlist.slice(0,1);
 const estimated=plan.shortlist.filter(row=>row.summary&&row.burdens?.every(Boolean)).map(row=>({candidate:row.candidate,paths:row.burdens.map((b,i)=>({memberId:plan.memberIds[i],status:'verified',expectedMinutes:b.score}))}));
 const ordinary=rankVerified(estimated,balances,regular,{maxIncreaseRatio:.10}),ranked=regular&&plan.targetMemberId?rankPersonalCare(ordinary,plan.targetMemberId):ordinary;
 const chosen=ranked.length?plan.shortlist.find(row=>row.candidate.id===ranked[0].candidate.id):plan.shortlist[0];
 return chosen?[chosen]:[];
}
