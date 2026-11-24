import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankVerified} from '../analysis/fairness.mjs';
import {selectRecommendationPolicy} from '../analysis/recommendation-policy.mjs';
function rows(times,balances){return rankVerified(times.map((time,index)=>({candidate:{id:String(index),name:'C'+index},paths:time.map((expectedMinutes,i)=>({memberId:String(i),name:'P'+i,status:'verified',expectedMinutes}))})),balances,true);}
test('protect selects a positive-burden reduction rather than an attractive average',()=>{const candidates=rows([[90,30,30],[20,50,50]],{'0':48,'1':-24,'2':-24});const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.alternatives.fairnessId,'1');assert.equal(selected.info.status,'protected');assert.deepEqual(selected.info.targetMemberIds,['0']);assert.ok(selected.chosen.paths[0].projected<48);});
test('no protective candidate is explicitly failed and does not offer an unsafe efficiency fallback',()=>{const candidates=rows([[90,30,30],[70,30,30]],{'0':48,'1':-24,'2':-24});const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.alternatives.fairnessId,null);assert.equal(selected.alternatives.efficiencyId,null);assert.equal(selected.chosen,null);assert.equal(selected.info.status,'protection_failed');assert.equal(selected.info.met,false);});
test('all tied maximum-burden attendees must be protected',()=>{const candidates=rows([[10,40,40],[20,20,50]],{'0':10,'1':10,'2':-20});const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.alternatives.fairnessId,'1');assert.deepEqual(selected.info.targetMemberIds,['0','1']);});
test('balance reports failure when even its best candidate increases dispersion',()=>{const candidates=rows([[90,30,30]],{'0':10,'1':-5,'2':-5});const selected=selectRecommendationPolicy(candidates,true,'balance');assert.equal(selected.info.status,'not_improved');assert.equal(selected.info.met,false);});
test('a new attendee starts at zero; no positive history uses a declared balance fallback',()=>{const candidates=rows([[10,20,30]],{});assert.ok(candidates[0].paths.every(p=>p.past===0));const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.info.status,'no_positive_burden');assert.deepEqual(selected.info.targetMemberIds,[]);});

test('equal retry scores retain the prior recommendation instead of switching on candidate ID',()=>{const candidates=rows([[20,35,35],[20,35,35]],{'0':10,'1':-5,'2':-5});assert.equal(selectRecommendationPolicy(candidates,true,'balance').alternatives.fairnessId,'0');assert.equal(selectRecommendationPolicy(candidates,true,'balance',null,'1').alternatives.fairnessId,'1');});


test('balance never offers an efficiency escape when no candidate improves',()=>{
 const selected=selectRecommendationPolicy(rows([[90,30,30]],{'0':10,'1':-5,'2':-5}),true,'balance');
 assert.equal(selected.chosen,null);assert.equal(selected.alternatives.fairnessId,null);assert.equal(selected.alternatives.efficiencyId,null);
});

test('near-optimal balance rewards past positive burden only within its dispersion band',()=>{
 // Both are real five-attendee calculations; the second rewards the largest debtor.
 const candidates=rows([[26,26,38,30,30],[25,31,36,29,29],[21,35,34,30,30]],{'0':10,'1':2,'2':-12,'3':0,'4':0});
 const selected=selectRecommendationPolicy(candidates,true,'balance');
 const improving=candidates.filter(c=>c.projectedStd<selected.info.beforeStd-.01),best=Math.min(...improving.map(c=>c.projectedStd));
 assert.equal(selected.chosen.candidate.id,'1');assert.ok(selected.chosen.projectedStd<=best+.5);
 assert.ok(selected.chosen.projectedStd<selected.info.beforeStd);
});

test('the reported extreme five-person result cannot be selected as a balance recommendation',()=>{
 const candidates=rows([[73,19,65,38,41]],{'0':4,'1':-12,'2':-3,'3':8,'4':3});
 const balance=selectRecommendationPolicy(candidates,true,'balance');
 assert.equal(balance.info.status,'not_improved');assert.equal(balance.chosen,null);assert.equal(balance.alternatives.efficiencyId,null);
 const protect=selectRecommendationPolicy(candidates,true,'protect');assert.equal(protect.info.status,'protected');
});
