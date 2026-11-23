import {expandProtectiveSearch} from './protective-search.mjs';
import {planDiverse} from './shortlist.mjs';
import {buildNetwork,generateCandidates,rankCandidates} from './core.mjs';
import {summarize,rankVerified} from './fairness.mjs';
export const methodBConfig={candidateCount:100,centralMinRadiusM:1500,centralMaxRadiusM:4000,centralRadiusRatio:.5,includeRail:true,railTransferRadiusM:450,railEntryMinutes:3,railExitMinutes:2,burdenWeightStrength:.5,correctionAlphas:[.2,.4,.6],correctionRadiusM:1200,candidateSpacingM:180,accessRadiusM:450,transferRadiusM:150,maxTransfers:2,maxRoutes:5000,maxTotalIncreaseRatio:.30,hopWeight:1,boardingWeight:5,walkWeightPer100m:1.5,headwayWeightPerMinute:1,estimateMinutes:true,busSpeedKmh:18,defaultWaitMinutes:5};
export function validateNetwork(network,stops){
 if(!network||typeof network.source!=='string'||!network.source.trim()||!Number.isFinite(Date.parse(network.updatedAt))||!Array.isArray(network.routes)||!network.routes.length||network.routes.length>5000)throw Error('출처·갱신일·실제 노선 데이터가 필요합니다.');
 const ids=new Set(stops.map(s=>s.id));
 for(const r of network.routes){if(typeof r.id!=='string'||!r.id||typeof r.direction!=='string'||!r.direction||!Array.isArray(r.stops)||r.stops.length<2||r.stops.length>2000||r.stops.some(s=>s!==null&&!ids.has(s))||(r.headwayMinutes!=null&&(!Number.isFinite(r.headwayMinutes)||r.headwayMinutes<0||r.headwayMinutes>300)))throw Error('노선 방향·경유 순서·정류장 매핑을 확인해주세요.');}
 return network;
}
export function selectMethodB(origins,stops,network,members,balances,regular,shortlistCount=5,targetMemberId=null,recommendationPolicy='balance'){
 validateNetwork(network,stops);
 let plan=planDiverse(origins,stops,network,members,balances,regular,methodBConfig,shortlistCount,targetMemberId);
 if(regular&&recommendationPolicy==='protect')plan=expandProtectiveSearch(plan,origins,stops,network,members,balances,methodBConfig,shortlistCount);
 return {...plan,chosen:plan.shortlist[0]||null,shortlistCount:plan.shortlist.length,eligibleCount:plan.shortlist.length,source:network.source,updatedAt:network.updatedAt,assumptions:{busSpeedKmh:methodBConfig.busSpeedKmh,walkSpeedKmh:4,defaultWaitMinutes:methodBConfig.defaultWaitMinutes},estimated:true};
}
