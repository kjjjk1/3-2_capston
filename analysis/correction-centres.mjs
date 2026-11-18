import {centres,project,unproject,metres} from './core.mjs';
// Always derived afresh from current origins. No previous corrected point is an input.
export function burdenCorrectionCentres(origins,members,balances={},alphas=[.2,.4,.6]){
 const base=centres(origins),burdened=members.map((m,i)=>({memberId:m.id,index:i,burden:Number.isFinite(balances[m.id])?balances[m.id]:0})).filter(m=>m.burden>0&&origins[m.index]).sort((a,b)=>b.burden-a.burden||String(a.memberId).localeCompare(String(b.memberId)));
 const target=burdened[0];if(!target)return {...base,active:false,target:null,anchors:[]};
 const start=project(base.median),end=project(origins[target.index]);
 const anchors=[...new Set(alphas)].filter(a=>Number.isFinite(a)&&a>0&&a<1).sort((a,b)=>a-b).map(alpha=>{const point=unproject({x:start.x+alpha*(end.x-start.x),y:start.y+alpha*(end.y-start.y)});return {...point,alpha,displacementM:metres(base.median,point)};});
 return {...base,active:anchors.some(a=>a.displacementM>.01),target,anchors:anchors.filter(a=>a.displacementM>.01)};
}
