import {test} from 'node:test';import assert from 'node:assert/strict';
import {verificationPlan} from '../analysis/provider-plan.mjs';
const row=(id,times)=>({candidate:{id},summary:{average:times.reduce((a,b)=>a+b)/times.length},burdens:times.map(score=>({score}))});
test('ODsay keeps exactly one candidate selected using cumulative estimated burden',()=>{
 const plan={memberIds:['A','B'],shortlist:[row('a',[30,30]),row('b',[25,35]),row('c',[40,40])]};
 const picked=verificationPlan(plan,'odsay',{A:5,B:-5},true);assert.equal(picked.length,1);assert.equal(picked[0].candidate.id,'b');
 assert.equal(verificationPlan(plan,'kakao',{},true).length,3);
});
test('ODsay uses one exploration candidate when bus estimates are all unknown',()=>{
 const rows=[{candidate:{id:'unknown'},summary:null,burdens:[null,null]}];assert.equal(verificationPlan({memberIds:['A','B'],shortlist:rows},'odsay',{},true).length,1);
});
