import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseDiverseShortlist,evaluatePreliminary,generateDiverseCandidates} from '../analysis/shortlist.mjs';
import {buildNetwork} from '../analysis/core.mjs';
import {methodBConfig} from '../analysis/method-b.mjs';
import {rankVerified} from '../analysis/fairness.mjs';
const make=(i,avg,gap,std,seed='central')=>({candidate:{id:String(i),name:String(i),lat:36+i*.02,lon:127,seed},summary:avg===null?null:{average:avg,gap},projectedStd:std,geo:{average:1000+i}});
test('fastest, balanced, cumulative, hub and data-gap candidates survive together',()=>{
 const rows=[make(0,10,10,20),make(1,20,1,15),make(2,30,2,1),make(3,null,null,null),make(4,60,20,30,'transit_hub')];
 const result=chooseDiverseShortlist(rows,5);
 assert.equal(result.length,5);assert.equal(result[0].candidate.id,'0');
 assert.ok(result.some(r=>r.selectionReason==='cumulative_fairness'&&r.candidate.id==='2'));
 assert.ok(result.some(r=>r.selectionReason==='transit_hub'&&r.candidate.id==='4'));
 assert.ok(result.some(r=>r.selectionReason==='data_gap_exploration'&&r.candidate.id==='3'));
});
test('three-call-candidate budget still reserves a data-gap exploration slot',()=>{
 const result=chooseDiverseShortlist([make(0,10,2,2),make(1,12,1,1),make(2,null,null,null),make(3,15,3,3,'transit_hub')],3);
 assert.equal(result.length,3);assert.ok(result.some(r=>r.candidate.id==='2'));
});
test('no local connectivity is unknown, not fabricated estimated minutes',()=>{
 const stops=[{id:'a',name:'a',lat:36,lon:127},{id:'b',name:'b',lat:36.1,lon:127}];
 const graph=buildNetwork(stops,{routes:[]},methodBConfig);
 const rows=evaluatePreliminary(stops,stops,graph,methodBConfig,[{id:'A'},{id:'B'}],{},true);
 assert.ok(rows.every(r=>r.status==='insufficient_transit_data'&&r.summary===null));
 assert.equal(chooseDiverseShortlist(rows,5).length,2);
});
test('verified candidates are not excluded by average or personal time increases',()=>{
 const c=(id,t)=>({candidate:{id},paths:t.map((expectedMinutes,i)=>({memberId:String(i),expectedMinutes}))});
 const ranked=rankVerified([c('base',[10,30]),c('fair',[21,21]),c('expensive',[23,23])],{},true,{maxIncreaseRatio:.1});
 assert.equal(ranked[0].candidate.id,'fair');assert.ok(ranked.some(r=>r.candidate.id==='expensive'));
});

test('a corrective candidate survives both former caps and wins on cumulative fairness',()=>{
 const c=(id,t)=>({candidate:{id},paths:t.map((expectedMinutes,i)=>({memberId:String(i),expectedMinutes}))});
 const ranked=rankVerified([c('base',[10,30]),c('correction',[20,50])],{'0':15,'1':-15},true);
 assert.equal(ranked[0].candidate.id,'correction');assert.equal(ranked[0].projectedStd,0);assert.equal(ranked[0].extraMinutes,20);assert.equal(ranked[0].eligible,true);
});
