export function estimationAccuracy(rows){
 const pairs=[];let missing=0;for(const row of rows)row.paths.forEach((p,i)=>{const estimated=row.estimatedBurdens?.[i]?.score;if(p.status!=='verified'||!Number.isFinite(p.expectedMinutes)||!Number.isFinite(estimated)){missing++;return;}const error=estimated-p.expectedMinutes;pairs.push({candidateId:row.candidate.id,memberId:p.memberId,estimatedMinutes:estimated,apiMinutes:p.expectedMinutes,errorMinutes:error,absoluteErrorMinutes:Math.abs(error),usedRail:!!row.estimatedBurdens[i].usedRail});});
 const n=pairs.length;return {count:n,missing,mae:n?pairs.reduce((s,p)=>s+p.absoluteErrorMinutes,0)/n:null,rmse:n?Math.sqrt(pairs.reduce((s,p)=>s+p.errorMinutes**2,0)/n):null,bias:n?pairs.reduce((s,p)=>s+p.errorMinutes,0)/n:null,pairs};
}
