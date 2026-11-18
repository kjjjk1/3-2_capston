import {test} from 'node:test';
import assert from 'node:assert/strict';
import {evaluateImprovement} from '../analysis/improvement.mjs';
const c=(id,t)=>({candidate:{id},paths:t.map((expectedMinutes,i)=>({memberId:String(i),expectedMinutes}))});
test('same attendee set used before and after; absent debt excluded',()=>{
 const e=evaluateImprovement([c('correction',[20,40])],{'0':10,'1':-10,'absent':999},['0','1'],true,true);
 assert.equal(e.fairness.beforeStd,10);assert.equal(e.fairness.afterStd,0);assert.equal(e.fairness.status,'improved');assert.equal(e.fairness.improvementPercent,100);
});
test('all candidates worse are explicitly labelled and require acknowledgement',()=>{
 const e=evaluateImprovement([c('worse',[40,20])],{'0':5,'1':-5},['0','1'],true,true);
 assert.equal(e.fairness.status,'worsened');assert.equal(e.fairness.requiresAcknowledgement,true);assert.ok(e.fairness.afterStd>e.fairness.beforeStd);
});
test('first regular meeting and previously balanced histories are distinguished',()=>{
 assert.equal(evaluateImprovement([c('first',[20,30])],{},['0','1'],true,false).fairness.status,'first_meeting');
 const balanced=evaluateImprovement([c('later',[20,30])],{},['0','1'],true,true).fairness;assert.equal(balanced.status,'balanced_start');assert.equal(balanced.requiresAcknowledgement,true);
 assert.equal(evaluateImprovement([c('equal',[30,30])],{},['0','1'],true,true).fairness.status,'maintained');
});
test('casual meetings ignore debts and do not claim cumulative improvement',()=>{
 assert.equal(evaluateImprovement([c('casual',[20,40])],{'0':20,'1':-20},['0','1'],false,true).fairness.status,'casual');
});
test('all verified candidates remain available for cumulative correction without time caps',()=>{
 const e=evaluateImprovement([c('efficient',[20,20]),c('expensive',[20,30])],{'0':10,'1':-10},['0','1'],true,true);
 assert.equal(e.best.candidate.id,'expensive');assert.equal(e.eligible.length,2);
});
test('no verified candidates produce no selected destination',()=>{
 assert.equal(evaluateImprovement([],{},['0','1'],true,true).best,null);
});

 test('no improvement falls back to lowest overall imbalance, not individual correction',()=>{
 const e=evaluateImprovement([c('global',[45.6333,25.9167,33.4167,37.9333]),c('target',[32.15,43.4333,38.95,30.9833])],{'0':22.2917,'1':19.4917,'2':-18,'3':-23.7834},['0','1','2','3'],true,true);
 assert.equal(e.best.candidate.id,'global');assert.equal(e.fairness.recommendation,'no_improvement');
 });
 test('no target reduction is reported without dropping verified alternatives',()=>{const e=evaluateImprovement([c('fallback',[40,20])],{'0':10,'1':-10},['0','1'],true,true);assert.equal(e.fairness.correction.status,'no_target_reduction');assert.equal(e.best.candidate.id,'fallback');});
 test('tied maximum debts both need reduction and casual selection is unchanged',()=>{const e=evaluateImprovement([c('one',[10,40,30]),c('both',[10,10,40])],{'0':10,'1':10,'2':-20},['0','1','2'],true,true);assert.equal(e.best.candidate.id,'both');assert.equal(e.fairness.correction.targetMemberIds.length,2);assert.equal(evaluateImprovement([c('even',[20,20]),c('uneven',[10,40])],{'0':10,'1':-10},['0','1'],false,true).best.candidate.id,'even');});

test('overall improvement precedes target reduction that worsens everyone combined',()=>{const candidates=[c('improves',[30,30,30,50]),c('individual',[10,60,10,40])];const e=evaluateImprovement(candidates,{'0':20,'1':19,'2':-19,'3':-20},['0','1','2','3'],true,true);assert.equal(e.best.candidate.id,'improves');assert.equal(e.fairness.recommendation,'improvement');});
