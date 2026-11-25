import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreliminaryContext,evaluatePreliminary,chooseBalancedShortlist,calibrateRetryEstimates} from '../analysis/shortlist.mjs';
function reference(origins,candidates,graph,cfg,members,balances,regular){
 const searches=origins.map(o=>searchBurden(o,graph,cfg));
 return candidates.map(candidate=>{
  const burdens=searches.map(search=>{
   let best=null;for(const stop of graph.served){const base=search.get(stop.id),walk=metres(stop,candidate);if(!base||walk>cfg.accessRadiusM)continue;
    const row={...base,score:base.score+walk/100*cfg.walkWeightPer100m+(stop.kind==='rail'?(cfg.railExitMinutes??2):0),walk:base.walk+walk};if(!best||row.score<best.score)best=row;
   }return best;
  });
  const coverage=burdens.filter(Boolean).length,complete=coverage===origins.length;
  const summary=complete?summarize(burdens.map(b=>b.score)):null;
  const projectedStd=complete?summarize(burdens.map((b,i)=>(regular?(balances[members[i].id]||0):0)+b.score-summary.average)).std:null;
  const distances=origins.map(o=>metres(o,candidate)),geo=summarize(distances);
  return {candidate,burdens,summary,projectedStd,coverage,status:complete?(burdens.some(b=>b.usedRail)?'integrated_model_estimated':'bus_model_estimated'):'insufficient_transit_data',geo};
 });
}


import {buildNetwork,searchBurden,metres} from '../analysis/core.mjs';
import {methodBConfig} from '../analysis/method-b.mjs';
import {summarize} from '../analysis/fairness.mjs';
const members=[{id:'A'},{id:'B'}],balances={A:10,B:-10};
const row=(id,lat,t=[20,40])=>({candidate:{id,lat,lon:127.4},burdens:t.map(score=>({score,walk:100,usedRail:false})),summary:summarize(t),projectedStd:summarize(t.map((v,i)=>balances[members[i].id]+v-summarize(t).average)).std});
test('spatial index and reused searches preserve original estimates exactly',()=>{
 const stops=Array.from({length:16},(_,i)=>({id:String(i),name:String(i),lat:36.35+i*.002,lon:127.4+(i%3)*.001}));
 const cfg={...methodBConfig,includeRail:false},graph=buildNetwork(stops,{routes:[{id:'r',direction:'out',stops:stops.map(s=>s.id)}]},cfg),origins=[stops[0],stops[2]];
 let calls=0;const context=createPreliminaryContext(origins,graph,cfg,(...args)=>{calls++;return searchBurden(...args);});
 for(const candidates of [stops.slice(0,8),stops.slice(8),[{id:'unknown',lat:37,lon:128}]])assert.deepEqual(evaluatePreliminary(origins,candidates,graph,cfg,members,balances,true,context),reference(origins,candidates,graph,cfg,members,balances,true));
 assert.equal(calls,2);
 const changed=[stops[4],stops[5]];assert.deepEqual(evaluatePreliminary(changed,stops,graph,cfg,members,balances,true,context),reference(changed,stops,graph,cfg,members,balances,true));
 const changedCfg={...cfg,walkWeightPer100m:2};assert.deepEqual(evaluatePreliminary(origins,stops,graph,changedCfg,members,balances,true,context),reference(origins,stops,graph,changedCfg,members,balances,true));
});
test('balance shortlist keeps strongest compensation and explores separated regions within five slots',()=>{
 const rows=[...Array.from({length:8},(_,i)=>row('cluster'+i,36.35+i*.0001)),...Array.from({length:5},(_,i)=>row('region'+i,36.37+i*.02,[25,35]))];
 const list=chooseBalancedShortlist(rows,5,{members,balances});assert.equal(list.length,5);assert.equal(new Set(list.map(r=>r.candidate.id)).size,5);assert.equal(list[0].candidate.id,'cluster0');assert.ok(list.diversity.minPairDistanceM>=1000);assert.ok(list[0].selectionRoles.includes('compensation'));assert.ok(list.some(r=>r.selectionRoles.includes('negative_benefit_rebalance')));assert.equal(chooseBalancedShortlist(rows,1,{members,balances}).length,1);
});
test('small candidate regions relax distance rather than inventing candidates',()=>{const list=chooseBalancedShortlist([row('a',36.35),row('b',36.3501)],5,{members,balances});assert.equal(list.length,2);assert.equal(list.diversity.relaxed,true);});
test('retry calibration needs two separate nearby measurements and is bounded by minutes and percentage',()=>{
 const observation=(lat)=>({ok:true,candidate:{lat,lon:127.4},estimatedBurdens:[{score:100},{score:20}],paths:[{memberId:'A',status:'verified',expectedMinutes:0},{memberId:'B',status:'verified',expectedMinutes:100}]});
 const original=row('near',36.35,[100,20]),one=observation(36.351),two=observation(36.355);
 assert.equal(calibrateRetryEstimates([original],[one],members,balances).diagnostic.correctedRows,0);
 assert.equal(calibrateRetryEstimates([original],[one,one],members,balances).diagnostic.correctedRows,0);
 const out=calibrateRetryEstimates([original,row('far',36.5,[100,20])],[one,two],members,balances);
 assert.equal(out.rows[0].burdens[0].score,85);assert.equal(out.rows[0].burdens[1].score,25);assert.equal(out.rows[1].estimateCorrection,undefined);assert.equal(original.burdens[0].score,100);assert.equal(out.rows[0].rawBurdens,original.burdens);
 const rail={...original,burdens:original.burdens.map(b=>({...b,usedRail:true}))};assert.equal(calibrateRetryEstimates([rail],[one,two],members,balances).diagnostic.correctedRows,0);
});
