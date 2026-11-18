export function summarize(values) {
  const average = values.reduce((a,b)=>a+b,0)/values.length;
  return {average,total:average*values.length,min:Math.min(...values),max:Math.max(...values),gap:Math.max(...values)-Math.min(...values),std:Math.sqrt(values.reduce((a,b)=>a+(b-average)**2,0)/values.length)};
}
export function rankVerified(candidates, balances={}, regular=true, options={}) {
  if (!candidates.length) return [];
  const rows=candidates.map(c=>{
    const summary=summarize(c.paths.map(p=>p.expectedMinutes));
    const paths=c.paths.map(p=>({...p,past:regular?(balances[p.memberId]||0):0,relative:p.expectedMinutes-summary.average}));
    paths.forEach(p=>p.projected=p.past+p.relative);
    return {...c,paths,summary,projectedStd:summarize(paths.map(p=>p.projected)).std};
  });
  const baseline=[...rows].sort((a,b)=>a.summary.total-b.summary.total)[0];
  const baseTimes=Object.fromEntries(baseline.paths.map(p=>[p.memberId,p.expectedMinutes]));
  for(const r of rows){
    r.extraMinutes=Math.max(0,...r.paths.map(p=>p.expectedMinutes-baseTimes[p.memberId]));
    r.totalIncreaseRatio=baseline.summary.total?(r.summary.total-baseline.summary.total)/baseline.summary.total:0;
    r.eligible=true; // All verified routes participate; no average/personal time increase caps.
  }
  return rows.filter(r=>r.eligible).sort((a,b)=>(regular?a.projectedStd-b.projectedStd:a.summary.std-b.summary.std)||a.summary.average-b.summary.average||a.candidate.id.localeCompare(b.candidate.id));
}

export function resultAlternatives(candidates,regular=true,targetId=null){
 const verified=candidates.filter(c=>c.eligible!==false&&c.summary&&c.paths?.length&&c.paths.every(p=>(p.status==='verified'||p.status==='estimated'&&Number.isFinite(p.expectedMinutes))&&p.status===c.paths[0].status)&&Number.isFinite(regular?c.projectedStd:c.summary.std));
 const tie=(a,b)=>a.candidate.id.localeCompare(b.candidate.id);
 const fairness=[...verified].sort((a,b)=>(regular?a.projectedStd-b.projectedStd:a.summary.std-b.summary.std)||a.summary.average-b.summary.average||tie(a,b))[0];
 const efficiency=[...verified].sort((a,b)=>a.summary.average-b.summary.average||a.summary.max-b.summary.max||(regular?a.projectedStd-b.projectedStd:a.summary.std-b.summary.std)||tie(a,b))[0];
 return {fairnessId:fairness?.candidate.id||null,efficiencyId:efficiency?.candidate.id||null,...(regular&&targetId?{personalId:rankPersonalCare(verified,targetId)[0]?.candidate.id||null}: {})};
}

export function rankPersonalCare(candidates,targetId){
 const valid=candidates.filter(c=>c.eligible!==false&&c.summary&&c.paths?.every(p=>(p.status==='verified'||p.status==='estimated'&&Number.isFinite(p.expectedMinutes))&&p.status===c.paths[0].status)&&c.paths.some(p=>p.memberId===targetId&&Number.isFinite(p.projected)&&Number.isFinite(p.past)));
 if(!valid.length)return [];
 const target=c=>c.paths.find(p=>p.memberId===targetId),transfer=c=>Math.max(0,...c.paths.filter(p=>p.memberId!==targetId).map(p=>p.relative));
 if(target(valid[0]).past<=0)return [...valid].sort((a,b)=>a.projectedStd-b.projectedStd||a.summary.average-b.summary.average||a.candidate.id.localeCompare(b.candidate.id));
 return [...valid].sort((a,b)=>Math.max(0,target(a).projected)-Math.max(0,target(b).projected)||transfer(a)-transfer(b)||a.projectedStd-b.projectedStd||Math.max(0,-target(a).projected)-Math.max(0,-target(b).projected)||a.summary.average-b.summary.average||a.candidate.id.localeCompare(b.candidate.id));
}
