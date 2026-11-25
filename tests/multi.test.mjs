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
test('matrix calls and actual baseline',async t=>{const f=await fixture(t),r=await f.analyze();assert.equal(r.data.status,'verified');assert.equal(f.calls.length,r.data.shortlisted*4);assert.equal(r.data.performance.apiRequests,f.calls.length);assert.equal(r.data.performance.requests.length,f.calls.length);assert.ok(r.data.performance.dbOperations>0);assert.ok(r.data.performance.totalMs>=r.data.performance.candidateMs);assert.equal(JSON.stringify(r.data.performance).includes('test-key'),false);assert.equal(r.data.comparisons.length,r.data.shortlisted);assert.equal(r.data.baselineAverage,30);assert.ok(r.data.candidates[0].summary.average<=33);});
test('partial candidate excluded, remaining candidates usable',async t=>{const f=await fixture(t);let n=0;const original=f.env.FETCH;f.env.FETCH=async(...args)=>{if(++n===1)throw Error('fail');return original(...args);};const r=await f.analyze();assert.equal(r.data.status,'verified');assert.equal(r.data.verifiedCandidates,r.data.shortlisted-1);assert.equal(r.data.candidates[0].eligible,false);assert.equal(r.data.candidates[0].summary,null);assert.ok(r.data.candidates.filter(c=>c.eligible).every(c=>c.paths.every(p=>p.status==='verified')));});

test('comparison payload includes each participant time without private route detail',async t=>{const f=await fixture(t),r=await f.analyze();for(const c of r.data.comparisons){assert.equal(c.participants.length,4);assert.ok(c.participants.every(p=>p.status==='verified'&&Number.isFinite(p.expectedMinutes)));assert.ok(c.participants.every(p=>!('segments' in p)&&!('stopId' in p)));const mean=c.participants.reduce((sum,p)=>sum+p.expectedMinutes,0)/4;assert.ok(Math.abs(mean-c.average)<1e-9);}assert.equal(f.calls.length,r.data.shortlisted*4);});

test('ODsay live adapter mock verifies one candidate in exactly four requests',async t=>{const f=await fixture(t);f.input.provider='odsay';const r=await f.analyze();assert.equal(r.data.method,'SINGLE_VALIDATION');assert.equal(r.data.calls,4);assert.equal(r.data.comparisons.length,1);assert.equal(f.calls.length,4);assert.ok(f.calls.every(c=>c.url.hostname==='api.odsay.com'));});
test('ODsay server cap stays 30 even when environment requests higher limit',async t=>{const f=await fixture(t);f.input.provider='odsay';f.env.ODSAY_DAILY_LIMIT='1000';await f.DB.prepare('INSERT INTO provider_usage(day,provider,calls) VALUES(?,?,?)').bind(new Date().toISOString().slice(0,10),'odsay',27).run();assert.equal((await f.analyze()).status,429);assert.equal(f.calls.length,0);});

test('automatic selection keeps the matrix and confirms only the selected eligible candidate',async t=>{const f=await fixture(t),r=await f.analyze();assert.equal(r.data.manualComparison,false);assert.equal(r.data.candidates.length,r.data.comparisons.length);assert.equal(r.data.comparisons.filter(c=>c.selected).length,1);const chosen=r.data.candidates.find(c=>c.candidate.id===r.data.recommendedCandidateId);const other=r.data.candidates.find(c=>c.candidate.id!==chosen.candidate.id);assert.equal((await f.call('/rooms/'+f.id+'/confirm','POST',{runId:r.data.runId,candidateId:other.candidate.id},f.token)).status,409);assert.ok(chosen.eligible);assert.equal(chosen.projectedStd,Math.min(...r.data.candidates.filter(c=>c.eligible).map(c=>c.projectedStd)));const count=f.calls.length;assert.equal((await f.call('/rooms/'+f.id+'/confirm','POST',{runId:r.data.runId,candidateId:chosen.candidate.id},f.token)).status,201);assert.equal(f.calls.length,count);const h=(await f.call('/rooms/'+f.id+'/history','GET',undefined,f.token)).data;assert.equal(h.meetings[0].candidate_id,chosen.candidate.id);});
test('public configuration is available without a provider variable',async t=>{const f=await fixture(t);assert.equal((await f.call('/config')).status,200);});

test('historical burden retains compensation and regional candidate roles without extra calls',async t=>{
 const f=await fixture(t),run=crypto.randomUUID(),meeting=crypto.randomUUID();
 await f.DB.prepare('INSERT INTO analysis_runs(id,room_id,created_at,status,fingerprint) VALUES(?,?,?,?,?)').bind(run,f.id,Date.now()-300000,'complete','weighted-test').run();
 await f.DB.prepare('INSERT INTO meeting_history(id,room_id,run_id,venue,regular,created_at,candidate_id) VALUES(?,?,?,?,?,?,?)').bind(meeting,f.id,run,'previous',1,new Date(Date.now()-86400000).toISOString(),'past').run();
 for(let i=0;i<4;i++)await f.DB.prepare('INSERT INTO burden_records(meeting_id,member_id,name,minutes,walk,transfers,relative) VALUES(?,?,?,?,?,?,?)').bind(meeting,f.members[i].id,f.members[i].name,30,0,0,[5,19,-11,-12][i]).run();
 const r=await f.analyze();assert.equal(r.data.shortlistStrategy,'diverse_compensation_v1');assert.ok(r.data.shortlistDiversity.roles.some(r=>r.roles.includes('compensation')));assert.equal(r.data.shortlistDiversity.roles.length,5);assert.equal(r.data.comparisons.length,5);assert.equal(f.calls.length,20);
 const h=(await f.call('/rooms/'+f.id+'/history','GET',undefined,f.token)).data;assert.equal(h.meetings.length,1);assert.equal(h.balances[f.members[1].id],19);
});


test('shared visitors can delete individual/all history, recalculating burdens without deleting members',async t=>{
 const f=await fixture(t),made=await f.call('/rooms','POST',{title:'delete test'}),id=made.data.room.id,owner=made.data.ownerToken;
 const people=[];for(let i=0;i<2;i++)people.push((await f.call('/rooms/'+id+'/join','POST',{name:'P'+i,stopId:nearest[i].id})).data);
 const ids=people.map(p=>p.room.me.id);
 async function add(regular,values){const run=crypto.randomUUID(),mid=crypto.randomUUID();await f.DB.prepare('INSERT INTO analysis_runs(id,room_id,created_at,status,fingerprint,payload) VALUES(?,?,?,?,?,?)').bind(run,id,Date.now()-300000,'complete','x','{}').run();await f.DB.prepare('INSERT INTO meeting_history(id,room_id,run_id,venue,regular,created_at,candidate_id) VALUES(?,?,?,?,?,?,?)').bind(mid,id,run,'place',regular,new Date().toISOString(),'c').run();for(let i=0;i<2;i++)await f.DB.prepare('INSERT INTO burden_records VALUES(?,?,?,?,?,?,?)').bind(mid,ids[i],'P'+i,30,0,0,values[i]).run();return {mid,run};}
 const one=await add(1,[5,-5]),two=await add(1,[2,-2]);await add(0,[100,-100]);
 async function remove(data,ownerToken='',member=''){const r=await worker.fetch(new Request('http://localhost/api/rooms/'+id+'/history',{method:'DELETE',headers:{'Content-Type':'application/json',...(ownerToken?{'X-Room-Owner-Token':ownerToken}:{}),...(member?{Authorization:'Bearer '+member}:{})},body:JSON.stringify(data)}),f.env);return {status:r.status,data:await r.json()};}
 assert.equal((await f.call('/rooms/'+id+'/history')).data.canDelete,true);
 assert.equal((await remove({meetingIds:[crypto.randomUUID()]})).status,404);
 const partial=await remove({meetingIds:[one.mid]});assert.equal(partial.status,200);assert.equal(partial.data.deleted,1);assert.equal(partial.data.balances[ids[0]],2);assert.equal(partial.data.meetings.length,2);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM burden_records WHERE meeting_id=?').bind(one.mid).first()).n,0);
 assert.equal((await f.DB.prepare('SELECT status FROM analysis_runs WHERE id=?').bind(two.run).first()).status,'invalidated');
 const all=await remove({all:true});assert.equal(all.status,200);assert.deepEqual(all.data.balances,{});assert.equal(all.data.meetings.length,0);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM room_members WHERE room_id=?').bind(id).first()).n,2);
 assert.equal((await f.call('/rooms/'+f.id,'GET',undefined,f.token)).data.members.length,4);
});


test('completed analysis can run again immediately without the former two-minute cooldown',async t=>{
 const f=await fixture(t),first=await f.analyze(),second=await f.analyze();
 assert.equal(first.status,200);assert.equal(second.status,200);assert.notEqual(first.data.runId,second.data.runId);assert.equal(f.calls.length,40);
 const usage=await f.DB.prepare('SELECT calls FROM provider_usage WHERE provider=?').bind('kakao').first();assert.equal(usage.calls,40);
});


test('integrated analysis persists estimate errors and role diagnostics without increasing the API budget',async t=>{
 const f=await fixture(t),r=await f.analyze();assert.ok(r.data.generated>0&&r.data.generated<=100);assert.equal(r.data.transportModel.railIncluded,true);assert.equal(r.data.estimationAccuracy.count+r.data.estimationAccuracy.missing,20);assert.ok(r.data.comparisons.every(c=>Array.isArray(c.selectionRoles)&&c.selectionRoles.length));assert.equal(f.calls.length,20);const stored=await f.DB.prepare('SELECT payload FROM analysis_runs WHERE id=?').bind(r.data.runId).first();assert.equal(JSON.parse(stored.payload).estimationAccuracy.count,r.data.estimationAccuracy.count);
});

test('history departure display reads existing analysis snapshots without adding history data',async t=>{
 const f=await fixture(t),r=await f.analyze();await f.call('/rooms/'+f.id+'/confirm','POST',{runId:r.data.runId,candidateId:r.data.recommendedCandidateId},f.token);
 const read=async()=>(await f.call('/rooms/'+f.id+'/history','GET',undefined,f.token)).data;
 const h=await read(),record=h.meetings[0].records.find(p=>p.member_id===f.members[0].id);assert.equal(record.originStopName,nearest[0].name);assert.equal('origin_snapshot_payload' in h.meetings[0],false);
 await f.DB.prepare('UPDATE room_members SET stop_id=? WHERE id=?').bind(nearest[10].id,f.members[0].id).run();assert.equal((await read()).meetings[0].records.find(p=>p.member_id===f.members[0].id).originStopName,nearest[0].name);
 await f.DB.prepare('UPDATE analysis_runs SET payload=NULL WHERE id=?').bind(r.data.runId).run();const after=(await read()).meetings[0].records.find(p=>p.member_id===f.members[0].id);assert.equal(after.originStopName,null);assert.equal(after.relative,record.relative);
});

test('efficiency alternative can be confirmed and saved without additional route requests',async t=>{
 const f=await fixture(t);let calls=0;f.env.FETCH=async()=>{const candidate=Math.floor(calls/4),person=calls++%4;return Response.json(kakaodata((candidate===0?20:candidate===1?[5,5,5,15][person]:[50,10,30,30][person])*60));};
 const r=await f.analyze(),a=r.data.alternatives;assert.ok(a);assert.notEqual(a.fairnessId,a.efficiencyId);const fastest=r.data.candidates.find(c=>c.candidate.id===a.efficiencyId),other=r.data.candidates.find(c=>![a.fairnessId,a.efficiencyId].includes(c.candidate.id));const before=calls;
 assert.equal((await f.call('/rooms/'+f.id+'/confirm','POST',{runId:r.data.runId,candidateId:other.candidate.id},f.token)).status,409);
 assert.equal((await f.call('/rooms/'+f.id+'/confirm','POST',{runId:r.data.runId,candidateId:a.efficiencyId},f.token)).status,201);assert.equal(calls,before);
 const history=(await f.call('/rooms/'+f.id+'/history','GET',undefined,f.token)).data;assert.equal(history.meetings[0].candidate_id,a.efficiencyId);for(const record of history.meetings[0].records){const expected=fastest.paths.find(p=>p.memberId===record.member_id);assert.equal(record.minutes,expected.expectedMinutes);assert.ok(Math.abs(record.relative-expected.relative)<1e-8);}
});

test('personal-care mode validates target, keeps call budget and confirms its allowed alternative',async t=>{const f=await fixture(t);await f.DB.batch([f.DB.prepare('INSERT INTO meeting_history(id,room_id,run_id,venue,regular,created_at,candidate_id) VALUES(?,?,?,?,?,?,?)').bind('care-old',f.id,'care-run','old',1,'2026-01-01','old'),...f.members.map((m,i)=>f.DB.prepare('INSERT INTO burden_records(meeting_id,member_id,name,minutes,walk,transfers,relative) VALUES(?,?,?,?,?,?,?)').bind('care-old',m.id,m.name,[60,59,1,0][i],0,0,[30,29,-29,-30][i]))]);assert.equal((await f.call('/rooms/'+f.id+'/analysis','POST',{...f.input,targetMemberId:'not-in-room'},f.token)).status,400);assert.equal(f.calls.length,0);let n=0;f.env.FETCH=async()=>{const c=Math.floor(n/4),i=n++%4;return Response.json(kakaodata((c===0?[30,30,40,40][i]:[10,50,30,30][i])*60));};const result=await f.call('/rooms/'+f.id+'/analysis','POST',{...f.input,targetMemberId:f.members[0].id},f.token);assert.equal(result.data.status,'verified');assert.equal(result.data.targetMemberId,f.members[0].id);assert.ok(result.data.alternatives.personalId);assert.notEqual(result.data.alternatives.personalId,result.data.alternatives.fairnessId);assert.ok(n<=20);const before=n;const picked=result.data.candidates.find(c=>c.candidate.id===result.data.alternatives.personalId);assert.ok(picked.paths[0].projected<picked.paths[0].past);assert.ok(picked.paths[1].relative>0);assert.equal((await f.call('/rooms/'+f.id+'/confirm','POST',{runId:result.data.runId,candidateId:picked.candidate.id},f.token)).status,201);assert.equal(n,before);const history=(await f.call('/rooms/'+f.id+'/history','GET',undefined,f.token)).data;assert.equal(history.meetings.at(-1).candidate_id,picked.candidate.id);});
