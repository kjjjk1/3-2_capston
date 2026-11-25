import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankVerified} from '../analysis/fairness.mjs';
import {selectRecommendationPolicy,compensationScore} from '../analysis/recommendation-policy.mjs';
function rows(times,balances){return rankVerified(times.map((time,index)=>({candidate:{id:String(index),name:'C'+index},paths:time.map((expectedMinutes,i)=>({memberId:String(i),name:'P'+i,status:'verified',expectedMinutes}))})),balances,true);}
test('protect selects a positive-burden reduction rather than an attractive average',()=>{const candidates=rows([[90,30,30],[20,50,50]],{'0':48,'1':-24,'2':-24});const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.alternatives.fairnessId,'1');assert.equal(selected.info.status,'protected');assert.deepEqual(selected.info.targetMemberIds,['0']);assert.ok(selected.chosen.paths[0].projected<48);});
test('no protective candidate is explicitly failed and does not offer an unsafe efficiency fallback',()=>{const candidates=rows([[90,30,30],[70,30,30]],{'0':48,'1':-24,'2':-24});const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.alternatives.fairnessId,null);assert.equal(selected.alternatives.efficiencyId,null);assert.equal(selected.chosen,null);assert.equal(selected.info.status,'protection_failed');assert.equal(selected.info.met,false);});
test('all tied maximum-burden attendees must be protected',()=>{const candidates=rows([[10,40,40],[20,20,50]],{'0':10,'1':10,'2':-20});const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.alternatives.fairnessId,'1');assert.deepEqual(selected.info.targetMemberIds,['0','1']);});
test('balance reports failure when even its best candidate increases dispersion',()=>{const candidates=rows([[90,30,30]],{'0':10,'1':-5,'2':-5});const selected=selectRecommendationPolicy(candidates,true,'balance');assert.equal(selected.info.status,'not_improved');assert.equal(selected.info.met,false);});
test('a new attendee starts at zero; no positive history uses a declared balance fallback',()=>{const candidates=rows([[10,20,30]],{});assert.ok(candidates[0].paths.every(p=>p.past===0));const selected=selectRecommendationPolicy(candidates,true,'protect');assert.equal(selected.info.status,'no_positive_burden');assert.deepEqual(selected.info.targetMemberIds,[]);});

test('equal retry scores retain the prior recommendation instead of switching on candidate ID',()=>{const candidates=rows([[20,35,35],[20,35,35]],{'0':10,'1':-5,'2':-5});assert.equal(selectRecommendationPolicy(candidates,true,'balance').alternatives.fairnessId,'0');assert.equal(selectRecommendationPolicy(candidates,true,'balance',null,'1').alternatives.fairnessId,'1');});


test('balance returns the least dispersed fallback when no candidate improves',()=>{
 const selected=selectRecommendationPolicy(rows([[90,30,30]],{'0':10,'1':-5,'2':-5}),true,'balance');
 assert.equal(selected.chosen.candidate.id,'0');assert.equal(selected.info.status,'not_improved');assert.equal(selected.info.met,false);assert.equal(selected.alternatives.fairnessId,'0');assert.equal(selected.alternatives.efficiencyId,'0');
});

test('near-optimal balance considers negative as well as positive historical burden',()=>{
 // The second rewards the largest positive debtor more, but leaves the negative debtor farther from zero.
 const candidates=rows([[26,26,38,30,30],[25,31,36,29,29],[21,35,34,30,30]],{'0':10,'1':2,'2':-12,'3':0,'4':0});
 const selected=selectRecommendationPolicy(candidates,true,'balance');
 const improving=candidates.filter(c=>c.projectedStd<selected.info.beforeStd-.01),best=Math.min(...improving.map(c=>c.projectedStd));
 assert.equal(selected.chosen.candidate.id,'0');assert.ok(selected.chosen.projectedStd<=best+.5);
 assert.ok(selected.chosen.projectedStd<selected.info.beforeStd);
});

test('an extreme five-person fallback is explicitly labelled as not improved',()=>{
 const candidates=rows([[73,19,65,38,41]],{'0':4,'1':-12,'2':-3,'3':8,'4':3});
 const balance=selectRecommendationPolicy(candidates,true,'balance');
 assert.equal(balance.info.status,'not_improved');assert.equal(balance.info.met,false);assert.ok(balance.chosen);assert.ok(balance.info.afterStd>balance.info.beforeStd);
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

test('without improvement the fallback minimizes dispersion rather than compensation',()=>{
 const candidates=rows([[60,0],[0,60]],{'0':10,'1':-10});
 const result=selectRecommendationPolicy(candidates,true,'balance');assert.equal(result.info.status,'not_improved');assert.equal(result.info.met,false);assert.equal(result.chosen.projectedStd,Math.min(...candidates.map(c=>c.projectedStd)));
});
