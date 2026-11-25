import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankVerified} from '../analysis/fairness.mjs';
import {selectRecommendationPolicy,compensationScore,compensationEvaluation} from '../analysis/recommendation-policy.mjs';
function rows(times,balances){return rankVerified(times.map((time,index)=>({candidate:{id:String(index),name:'C'+index},paths:time.map((expectedMinutes,i)=>({memberId:String(i),name:'P'+i,status:'verified',expectedMinutes}))})),balances,true);}
test('protect selects a positive-burden reduction rather than an attractive average',()=>{const candidates=rows([[90,30,30],[20,50,50]],{'0':48,'1':-24,'2':-24});const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.alternatives.fairnessId,'1');assert.equal(selected.info.status,'protected');assert.deepEqual(selected.info.targetMemberIds,['0']);assert.ok(selected.chosen.paths[0].projected<48);});
test('no protective candidate is explicitly failed and does not offer an unsafe efficiency fallback',()=>{const candidates=rows([[90,30,30],[70,30,30]],{'0':48,'1':-24,'2':-24});const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.alternatives.fairnessId,null);assert.equal(selected.alternatives.efficiencyId,null);assert.equal(selected.chosen,null);assert.equal(selected.info.status,'protection_failed');assert.equal(selected.info.met,false);});
test('all tied maximum-burden attendees must be protected',()=>{const candidates=rows([[10,40,40],[20,20,50]],{'0':10,'1':10,'2':-20});const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.alternatives.fairnessId,'1');assert.deepEqual(selected.info.targetMemberIds,['0','1']);});
test('balance reports failure when even its best candidate increases dispersion',()=>{const candidates=rows([[90,30,30]],{'0':10,'1':-5,'2':-5});const selected=selectRecommendationPolicy(candidates,true,'balance');assert.equal(selected.info.status,'compensation_failed');assert.equal(selected.info.met,false);});
test('a new attendee starts at zero; no positive history uses a declared balance fallback',()=>{const candidates=rows([[10,20,30]],{});assert.ok(candidates[0].paths.every(p=>p.past===0));const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.info.status,'no_positive_burden');assert.deepEqual(selected.info.targetMemberIds,[]);});

test('equal retry scores retain the prior recommendation instead of switching on candidate ID',()=>{const candidates=rows([[20,35,35],[20,35,35]],{'0':10,'1':-5,'2':-5});assert.equal(selectRecommendationPolicy(candidates,true,'balance').alternatives.fairnessId,'0');assert.equal(selectRecommendationPolicy(candidates,true,'balance',null,'1').alternatives.fairnessId,'1');});


test('balance still returns a labelled alternative when no compensation succeeds',()=>{
 const selected=selectRecommendationPolicy(rows([[90,30,30]],{'0':10,'1':-5,'2':-5}),true,'balance');
 assert.equal(selected.chosen.candidate.id,'0');assert.equal(selected.info.status,'compensation_failed');assert.equal(selected.info.met,false);assert.equal(selected.alternatives.fairnessId,'0');assert.equal(selected.alternatives.efficiencyId,'0');
});

test('balance compares both signs without restricting candidates to near-optimal dispersion',()=>{
 // The second rewards the largest positive debtor more, but leaves the negative debtor farther from zero.
 const candidates=rows([[26,26,38,30,30],[25,31,36,29,29],[21,35,34,30,30]],{'0':10,'1':2,'2':-12,'3':0,'4':0});
 const selected=selectRecommendationPolicy(candidates,true,'balance');
 const improving=candidates.filter(c=>c.projectedStd<selected.info.beforeStd-.01),best=Math.min(...improving.map(c=>c.projectedStd));
 assert.equal(selected.chosen.candidate.id,'0');assert.ok(selected.chosen.projectedStd<=selected.info.beforeStd);
 assert.ok(selected.chosen.projectedStd<selected.info.beforeStd);
});

test('an extreme five-person fallback is explicitly labelled as not improved',()=>{
 const candidates=rows([[73,19,65,38,41]],{'0':4,'1':-12,'2':-3,'3':8,'4':3});
 const balance=selectRecommendationPolicy(candidates,true,'balance');
 assert.equal(balance.info.status,'compensation_failed');assert.equal(balance.info.met,false);assert.ok(balance.chosen);assert.ok(balance.info.afterStd>balance.info.beforeStd);
 const protect=selectRecommendationPolicy(candidates,true,'protect');assert.equal(protect.info.status,'protected');
});


test('all-attendee compensation is symmetric under reversing every historical burden',()=>{
 const paths=[{past:10,projected:6},{past:5,projected:3},{past:0,projected:0},{past:-5,projected:-3},{past:-10,projected:-6}];
 assert.ok(compensationScore(paths)>0);
 assert.equal(compensationScore(paths),compensationScore(paths.map(p=>({past:-p.past,projected:-p.projected}))));
 assert.equal(compensationScore([...paths].reverse()),compensationScore(paths));
 assert.ok(compensationScore([{past:-10,projected:-6}])>compensationScore([{past:-10,projected:-12}]));
 assert.ok(compensationScore([{past:0,projected:0}])>compensationScore([{past:0,projected:5}]));
});

test('equal dispersion prefers gentle compensation over crossing to the opposite burden',()=>{
 const candidates=rows([[18,42],[22,38]],{'0':10,'1':-10});
 assert.equal(candidates[0].projectedStd,candidates[1].projectedStd);
 const selected=selectRecommendationPolicy(candidates,true,'balance');
 assert.equal(selected.chosen.candidate.id,'1');
 assert.ok(compensationScore(selected.chosen.paths)>compensationScore(candidates.find(c=>c.candidate.id==='0').paths));
});

test('failed compensation still returns the least harmful available alternative',()=>{
 const candidates=rows([[60,0],[0,60]],{'0':10,'1':-10});
 const result=selectRecommendationPolicy(candidates,true,'balance');assert.equal(result.info.status,'compensation_failed');assert.equal(result.info.met,false);assert.equal(result.chosen.projectedStd,Math.min(...candidates.map(c=>c.projectedStd)));
});


test('per-person gains match the requested examples exactly',()=>{
 for(const [past,projected,gain] of [[10,6,4],[-10,-6,4],[5,8,-3],[-3,-13,-10]])assert.equal(compensationEvaluation([{past,projected}]).members[0].gain,gain);
});

test('compensation is not gated by a half-minute standard deviation band',()=>{
 const candidates=rows([[20,32,38,30,30],[26,29,35,30,30]],{'0':10,'1':2,'2':-12,'3':0,'4':0});
 assert.ok(candidates.find(c=>c.candidate.id==='1').projectedStd>Math.min(...candidates.map(c=>c.projectedStd))+.5);
 const result=selectRecommendationPolicy(candidates,true,'balance');
 assert.equal(result.chosen.candidate.id,'1');assert.equal(result.info.compensation.worsenedCount,0);
});

test('repeated benefit and harm lose to a compensating alternative for all five attendees',()=>{
 const candidates=rows([[38,20,26,33,33],[32,32,28,27,31]],{'0':-3,'1':-3,'2':3,'3':5,'4':-2});
 const chosen=selectRecommendationPolicy(candidates,true,'balance');
 assert.equal(chosen.chosen.candidate.id,'1');
 assert.equal(chosen.info.status,'compensated');assert.equal(chosen.info.compensation.worsenedCount,0);assert.ok(chosen.info.compensation.netGain>0);
});

test('an improvement for others cannot hide one member worsening if a non-worsening option exists',()=>{
 const candidates=rows([[20,31,39,30,30],[25,29,36,30,30]],{'0':10,'1':2,'2':-12,'3':0,'4':0});
 const selected=selectRecommendationPolicy(candidates,true,'balance');
 assert.equal(selected.chosen.candidate.id,'1');assert.equal(selected.info.compensation.maxWorsening,0);
});


test('net benefit with an individual loss is explicitly partial and never labelled full compensation',()=>{
 const result=selectRecommendationPolicy(rows([[20,32,38,30,30]],{'0':10,'1':2,'2':-12,'3':0,'4':0}),true,'balance');
 assert.equal(result.info.status,'partial_compensation');assert.equal(result.info.met,false);assert.equal(result.info.compensation.worsenedCount,1);assert.ok(result.info.compensation.netGain>0);
});
