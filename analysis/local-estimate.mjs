export function estimatedPaths(row,members){
 if(!row?.burdens||row.burdens.length!==members.length)return null;
 if(!row.burdens.every(b=>b&&Number.isFinite(b.score)&&b.score>=0&&Number.isFinite(b.walk)&&b.walk>=0&&Number.isInteger(b.transfers)&&b.transfers>=0))return null;
 return row.burdens.map((b,i)=>({memberId:members[i].id,name:members[i].name,provider:'local',status:'estimated',expectedMinutes:b.score,walkMetres:b.walk,transfers:b.transfers,segments:[],firstStationMatch:null}));
}
export function localShortlist(plan,members,count=5){
 const out=[];for(const row of [...plan.shortlist,...(plan.preliminaryRows||[])]){if(out.some(r=>r.candidate.id===row.candidate.id)||!estimatedPaths(row,members))continue;out.push(row);if(out.length>=count)break;}return out;
}
