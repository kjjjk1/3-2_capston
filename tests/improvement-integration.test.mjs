import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import worker from '../dist/server/index.js';
import {createDB} from '../local-store.mjs';
import {verifyKakao} from '../analysis/kakao-transit.mjs';
import {metres,buildNetwork,searchBurden} from '../analysis/core.mjs';
import {methodBConfig,validateNetwork} from '../analysis/method-b.mjs';
const ctx={window:{}};vm.runInNewContext(readFileSync(new URL('../stops_data.js',import.meta.url),'utf8'),ctx);const stops=ctx.window.DT_SNIPER_STOPS;
const nearest=[...stops].sort((a,b)=>metres(a,stops[0])-metres(b,stops[0])).slice(0,80);
// Synthetic graph exists only inside tests; never imported into runtime data.
const network={source:'TEST ONLY',updatedAt:new Date().toISOString(),routes:[{id:'test-out',direction:'out',stops:nearest.map(s=>s.id)},{id:'test-in',direction:'in',stops:nearest.map(s=>s.id).reverse()}]};
function kakaodata(seconds=1800){return {status:'OK',routes:[{properties:{type:'BUS',totalTime:seconds,transfers:1},steps:[{properties:{type:'WALKING',distance:300,time:200}},{properties:{type:'BUS',distance:4000,time:1600,stops:[{name:'private origin'},{name:'destination'}],vehicles:[{name:'101'}]}}]}]};}
async function fixture(t,{withNetwork=true}={}){const DB=createDB();t.after(()=>DB.close());const calls=[];const env={DB,KAKAO_TRANSIT_REST_API_KEY:'test',ODSAY_API_KEY:'test',FETCH:async(url,options)=>{calls.push({url:new URL(url),options});return Response.json(new URL(url).hostname==='dapi.kakao.com'?kakaodata():{result:{searchType:0,path:[{pathType:2,info:{totalTime:30,totalWalk:300},subPath:[{trafficType:2,startName:'private origin',endName:'destination',lane:[{busNo:'101'}]}]}]}});}};
 if(withNetwork)await DB.prepare('INSERT INTO transit_network VALUES(1,?,?)').bind(JSON.stringify(network),network.updatedAt).run();
 const call=async(path,method='GET',data,token)=>{const res=await worker.fetch(new Request('http://localhost/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined}),env),raw=await res.text();return {status:res.status,data:res.headers.get('content-type')?.includes('ndjson')?raw.trim().split('\n').map(JSON.parse).at(-1):JSON.parse(raw)};};
 const a=await call('/rooms','POST',{title:'B test',name:'A',stopId:nearest[0].id});const id=a.data.room.id,token=a.data.memberToken;const members=[a.data.room.me];for(let i=1;i<4;i++){const b=await call('/rooms/'+id+'/join','POST',{name:String.fromCharCode(65+i),stopId:nearest[i].id});members.push(b.data.room.me);}
 const input={memberIds:members.map(m=>m.id),meetingType:'regular',provider:'kakao',mode:'버스만'};
 return {DB,env,calls,call,id,token,members,input,analyze:()=>call('/rooms/'+id+'/analysis','POST',input,token)};
}
test('balance fallback preserves the API budget and can be confirmed idempotently',async t=>{
 const f=await fixture(t);const records=f.members.map((m,i)=>({id:m.id,name:m.name,minutes:[40,20,30,30][i],relative:[10,-10,0,0][i]}));
 await f.DB.batch([f.DB.prepare('INSERT INTO meeting_history(id,room_id,run_id,venue,regular,created_at,candidate_id) VALUES(?,?,?,?,?,?,?)').bind('old-round',f.id,'old-run','old place',1,'2026-01-01','old-candidate'),...records.map(r=>f.DB.prepare('INSERT INTO burden_records(meeting_id,member_id,name,minutes,walk,transfers,relative) VALUES(?,?,?,?,?,?,?)').bind('old-round',r.id,r.name,r.minutes,0,0,r.relative))]);
 let count=0;f.env.FETCH=async()=>Response.json(kakaodata([40,20,30,30][count++%4]*60));
 f.input.recommendationPolicy='balance';f.input.targetMemberId=f.members[0].id;const r=await f.analyze();assert.equal(r.data.status,'verified');assert.equal(r.data.policyInfo.status,'not_improved');assert.equal(r.data.policyInfo.met,false);assert.equal(r.data.fairness.expanded,false);assert.equal(r.data.calls,20);assert.equal(count,20);
 const usage=await f.DB.prepare('SELECT calls FROM provider_usage WHERE provider=?').bind('kakao').first();assert.equal(usage.calls,20);
 assert.equal(r.data.legacyPersonalCare,false);assert.ok(r.data.recommendedCandidateId);const b={runId:r.data.runId,candidateId:r.data.recommendedCandidateId};assert.equal((await f.call('/rooms/'+f.id+'/confirm','POST',b,f.token)).status,201);
 const again=await f.call('/rooms/'+f.id+'/confirm','POST',b,f.token);assert.equal(again.status,200);assert.equal(again.data.duplicate,true);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM meeting_history').bind().first()).n,2);
});

test('explicit retry verifies new candidates once, merges old routes and preserves best alternative',async t=>{
 const f=await fixture(t);await f.DB.batch([f.DB.prepare('INSERT INTO meeting_history(id,room_id,run_id,venue,regular,created_at,candidate_id) VALUES(?,?,?,?,?,?,?)').bind('old',f.id,'old-run','old',1,'2026-01-01','old'),...f.members.map((m,i)=>f.DB.prepare('INSERT INTO burden_records(meeting_id,member_id,name,minutes,walk,transfers,relative) VALUES(?,?,?,?,?,?,?)').bind('old',m.id,m.name,[40,20,30,30][i],0,0,[10,-10,0,0][i]))]);
 let calls=0;f.env.FETCH=async()=>Response.json(kakaodata([40,20,30,30][calls++%4]*60));
 const first=await f.analyze();assert.equal(first.data.fairness.recommendation,'no_improvement');assert.ok(!('retryPool' in first.data));const oldIds=new Set(first.data.candidates.map(c=>c.candidate.id));
 const second=await f.call('/rooms/'+f.id+'/analysis','POST',{...f.input,retryRunId:first.data.runId},f.token);assert.equal(second.status,200);assert.equal(second.data.type,'result');assert.equal(second.data.retryParentId,first.data.runId);assert.equal(second.data.retryUsed,true);assert.ok(second.data.calls>0&&second.data.calls<=20);assert.ok(calls<=40);assert.equal(second.data.totalCalls,calls);assert.ok(second.data.candidates.length>first.data.candidates.length);assert.equal(new Set(second.data.candidates.map(c=>c.candidate.id)).size,second.data.candidates.length);assert.ok(second.data.candidates.filter(c=>!oldIds.has(c.candidate.id)).length>0);assert.ok(second.data.recommendedCandidateId);assert.equal(second.data.policyInfo.status,'not_improved');assert.ok(second.data.fairness.afterStd<=first.data.fairness.afterStd+1e-8);
 const before=calls;assert.equal((await f.call('/rooms/'+f.id+'/analysis','POST',{...f.input,retryRunId:first.data.runId},f.token)).status,409);assert.equal((await f.call('/rooms/'+f.id+'/analysis','POST',{...f.input,retryRunId:second.data.runId},f.token)).status,409);assert.equal(calls,before);
});
