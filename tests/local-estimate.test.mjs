import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';import {readFileSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {createDB} from '../local-store.mjs';
import {estimatedPaths} from '../analysis/local-estimate.mjs';
import {metres} from '../analysis/core.mjs';

async function fixture(t){
 const DB=createDB();t.after(()=>DB.close());let calls=0;
 const env={DB,FETCH:async()=>{calls++;throw Error('External calls forbidden');}};
 const box={window:{}};vm.runInNewContext(readFileSync('stops_data.js','utf8'),box);const all=box.window.DT_SNIPER_STOPS;
 const stops=[...all].sort((a,b)=>metres(a,all[0])-metres(b,all[0])).slice(0,80);
 const network={source:'TEST ONLY',updatedAt:new Date().toISOString(),routes:[{id:'test-out',direction:'out',stops:stops.map(s=>s.id)},{id:'test-back',direction:'back',stops:stops.map(s=>s.id).reverse()}]};
 await DB.prepare('INSERT INTO transit_network VALUES(1,?,?)').bind(JSON.stringify(network),network.updatedAt).run();
 const call=async(path,method='GET',data,token)=>{const r=await worker.fetch(new Request('https://demo.test/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined}),env),raw=await r.text();return {status:r.status,data:r.headers.get('content-type')?.includes('ndjson')?raw.trim().split('\n').map(JSON.parse).at(-1):JSON.parse(raw)};};
 const members=[];const a=await call('/rooms','POST',{title:'OFF test',name:'A',stopId:stops[0].id});members.push(a.data.room.me);
 const id=a.data.room.id,token=a.data.memberToken;
 for(let i=1;i<4;i++)members.push((await call('/rooms/'+id+'/join','POST',{name:'P'+i,stopId:stops[i].id})).data.room.me);
 const input={memberIds:members.map(m=>m.id),meetingType:'regular',provider:'kakao',useApi:false};
 return {DB,env,call,id,token,input,calls:()=>calls,analyze:()=>call('/rooms/'+id+'/analysis','POST',input,token)};
}

test('OFF uses actual model values, stores provenance and never reserves or calls an API',async t=>{
 const f=await fixture(t);f.env.KAKAO_TRANSIT_REST_API_KEY='configured-but-off';
 const r=await f.analyze();assert.equal(r.data.status,'estimated',JSON.stringify(r.data));assert.equal(r.data.provider,'local');assert.equal(r.data.calculationMode,'estimated');assert.equal(r.data.calls,0);assert.equal(r.data.verifiedCandidates,0);assert.ok(r.data.estimatedCandidates>0);assert.equal(r.data.estimationAccuracy,null);
 assert.equal(f.calls(),0);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM provider_usage').first()).n,0);
 const c=r.data.candidates.find(c=>c.candidate.id===r.data.alternatives.fairnessId);assert.ok(c.eligible);assert.ok(c.paths.every(p=>p.status==='estimated'&&Number.isFinite(p.expectedMinutes)&&p.segments.length===0));
 assert.ok(Math.abs(c.projectedStd-Math.sqrt(c.paths.reduce((sum,p)=>sum+p.projected*p.projected,0)/4))<1e-8);
 assert.equal((await f.call('/rooms/'+f.id+'/confirm','POST',{runId:r.data.runId,candidateId:c.candidate.id},f.token)).status,201);
 let h=(await f.call('/rooms/'+f.id+'/history','GET',undefined,f.token)).data;assert.equal(h.meetings[0].calculation_mode,'estimated');assert.equal(h.meetings[0].records.length,4);
 for(const p of c.paths)assert.equal(h.balances[p.memberId],p.relative);
 await f.DB.prepare('UPDATE analysis_runs SET payload=NULL WHERE id=?').bind(r.data.runId).run();h=(await f.call('/rooms/'+f.id+'/history','GET',undefined,f.token)).data;assert.equal(h.meetings[0].calculation_mode,'estimated');
 const next=await f.analyze();assert.equal(next.data.hasEstimatedHistory,true);assert.equal(next.data.status,'estimated');assert.equal(f.calls(),0);
});

test('ON without a server key is blocked and never falls back to OFF',async t=>{
 const f=await fixture(t);f.input.useApi=true;const r=await f.analyze();assert.equal(r.status,503);assert.match(r.data.error,/키/);assert.equal(f.calls(),0);assert.equal((await f.DB.prepare('SELECT COUNT(*) AS n FROM analysis_runs').first()).n,0);
 f.input.useApi='false';assert.equal((await f.analyze()).status,400);
});

test('missing transit data is not replaced by invented routes',()=>{
 assert.equal(estimatedPaths({burdens:[null]},[{id:'A',name:'A'}]),null);
 assert.equal(estimatedPaths({burdens:[{score:Infinity,walk:1,transfers:0}]},[{id:'A',name:'A'}]),null);
 const p=estimatedPaths({burdens:[{score:23.75,walk:333,transfers:1}]},[{id:'A',name:'A'}])[0];assert.equal(p.expectedMinutes,23.75);assert.equal(p.status,'estimated');
});

test('management settings distinguish ON readiness from OFF and persist explicit selection',()=>{
 const source=readFileSync('final-ui.js','utf8');const start=source.indexOf(' function settings()'),end=source.indexOf(' function stateBadge',start);
 const box={sync(){},context:()=>({members:[{id:'A',name:'A',ready:true},{id:'B',name:'B',ready:true}]}),result:null,busy:false,meetingType:'regular',provider:'kakao',useApi:true,careMemberId:'',config:{networkReady:true,kakaoTransit:false},selected:new Set(['A','B']),E:String};
 vm.runInNewContext(source.slice(start,end),box);assert.match(box.settings(),/id="finalApi"/);assert.match(box.settings(),/서버 키가 아직 없습니다/);
 box.useApi=false;const html=box.settings();assert.match(html,/API 미검증/);assert.match(html,/경로 API 호출은 0회/);assert.doesNotMatch(html,/서버 키가 아직 없습니다/);
});
