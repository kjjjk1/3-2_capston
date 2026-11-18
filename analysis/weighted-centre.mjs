import {project,unproject,metres} from './core.mjs';
// A search seed only: signed historical burden does not change final fairness scores.
export function weightedBurdenCentre(origins,members,balances={},strength=.5){
 const alpha=Number.isFinite(strength)?Math.max(0,Math.min(1,strength)):.5;
 const debt=origins.map((_,i)=>Number.isFinite(balances[members[i]?.id])?balances[members[i].id]:0);
 const scale=Math.max(0,...debt.map(Math.abs));
 const weights=debt.map(b=>Math.max(.25,Math.min(2,1+(scale?alpha*b/scale:0))));
 const points=origins.map(project),sum=weights.reduce((a,b)=>a+b,0);
 if(!points.length)throw Error('출발 좌표가 필요합니다.');
 let x=points.reduce((a,p,i)=>a+p.x*weights[i],0)/sum,y=points.reduce((a,p,i)=>a+p.y*weights[i],0)/sum;
 // Modified Weiszfeld iteration: handle a minimizer coincident with an origin.
 for(let k=0;k<300;k++){
  let sx=0,sy=0,sw=0,rx=0,ry=0,coincident=0;
  points.forEach((p,i)=>{const dx=p.x-x,dy=p.y-y,d=Math.hypot(dx,dy);if(d<1e-7){coincident+=weights[i];return;}const w=weights[i]/d;sx+=w*p.x;sy+=w*p.y;sw+=w;rx+=w*dx;ry+=w*dy;});
  if(!sw)break;const r=Math.hypot(rx,ry);if(r<=coincident+1e-10)break;
  const keep=coincident/r,nx=(1-keep)*sx/sw+keep*x,ny=(1-keep)*sy/sw+keep*y;
  const delta=Math.hypot(nx-x,ny-y);x=nx;y=ny;if(delta<.01)break;
 }
 return {point:unproject({x,y}),weights:weights.map((weight,i)=>({memberId:members[i]?.id,burden:debt[i],weight})),strength:alpha,active:scale>0&&Math.max(...weights)-Math.min(...weights)>1e-9};
}
