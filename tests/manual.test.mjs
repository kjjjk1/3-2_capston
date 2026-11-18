import {test} from 'node:test';import assert from 'node:assert/strict';
import {manualCandidates} from '../analysis/manual.mjs';
const row=(id,times,ok=true)=>({candidate:{id},ok,estimate:null,paths:times.map((expectedMinutes,i)=>({memberId:String(i),status:expectedMinutes===null?'unverified':'verified',expectedMinutes}))});
test('every candidate gets its own cumulative burden and assessment, including non-eligible rows',()=>{
 const rows=manualCandidates([row('a',[30,30]),row('b',[25,35]),row('expensive',[45,45]),row('partial',[25,null],false)],{'0':5,'1':-5},['0','1'],true,true);
 assert.equal(rows.length,4);assert.equal(rows[0].projectedStd,5);assert.equal(rows[1].projectedStd,0);assert.equal(rows[1].fairness.status,'improved');assert.equal(rows[2].eligible,true);assert.equal(rows[3].projectedStd,null);assert.equal(rows[3].paths[0].relative,null);
});
test('casual assessment uses this meeting only and marks cumulative exclusion',()=>{
 const [c]=manualCandidates([row('a',[20,40])],{'0':100,'1':-100},['0','1'],false,true);assert.equal(c.fairness.status,'casual');assert.ok(c.paths.every(p=>p.past===0));assert.equal(c.projectedStd,10);
});
