import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker from '../dist/server/index.js';
import {createDB} from '../tests-db.mjs';
import {metres} from '../analysis/core.mjs';
const pages='https://kjjjk1.github.io',server='https://three-2-capston.onrender.com';
test('CORS allows the named Pages origin and rejects other origins, methods and headers',async t=>{
 const DB=createDB();t.after(()=>DB.close());const env={DB};
 const call=(origin,method='POST',headers='content-type,authorization,x-room-owner-token')=>worker.fetch(new Request(server+'/api/rooms',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':method,'Access-Control-Request-Headers':headers}}),env);
 const ok=await call(pages);assert.equal(ok.status,204);assert.equal(ok.headers.get('access-control-allow-origin'),pages);assert.match(ok.headers.get('access-control-allow-headers'),/Authorization/);
 assert.equal((await call('https://attacker.test')).status,403);assert.equal((await call(pages,'PATCH')).status,403);assert.equal((await call(pages,'POST','x-unknown')).status,403);
 const denied=await worker.fetch(new Request(server+'/api/config',{headers:{Origin:'https://attacker.test'}}),env);assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
 const config=await worker.fetch(new Request(server+'/api/config',{headers:{Origin:pages}}),env);assert.equal((await config.json()).routeApiAllowed,false);
 const native=await worker.fetch(new Request(server+'/api/config'),env);assert.equal((await native.json()).routeApiAllowed,true);
});
test('Pages and Render share rooms, OFF results and history; Pages ON never calls a provider',async t=>{
 const DB=createDB();t.after(()=>DB.close());let external=0;
 const env={DB,KAKAO_TRANSIT_REST_API_KEY:'test-key',FETCH:async()=>{external++;throw Error('No external calls');}};
 const box={window:{}};vm.runInNewContext(readFileSync('stops_data.js','utf8'),box);
 const all=box.window.DT_SNIPER_STOPS,stops=[...all].sort((a,b)=>metres(a,all[0])-metres(b,all[0])).slice(0,80);
 const network={source:'TEST ONLY',updatedAt:new Date().toISOString(),routes:[{id:'out',direction:'out',stops:stops.map(s=>s.id)},{id:'back',direction:'back',stops:stops.map(s=>s.id).reverse()}]};
 await DB.prepare('INSERT INTO transit_network VALUES(1,?,?)').bind(JSON.stringify(network),new Date().toISOString()).run();
 async function call(path,method='GET',data,token='',origin=pages){const response=await worker.fetch(new Request(server+'/api'+path,{method,headers:{...(origin?{Origin:origin,'Sec-Fetch-Site':'cross-site'}:{}),'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:data?JSON.stringify(data):undefined}),env);const raw=await response.text();return {status:response.status,headers:response.headers,data:response.headers.get('content-type')?.includes('ndjson')?raw.trim().split('\n').map(JSON.parse).at(-1):JSON.parse(raw)};}
 const created=await call('/rooms','POST',{title:'공유 검증',name:'A',stopId:stops[0].id});assert.equal(created.status,201);assert.equal(created.data.room.mode,'통합');assert.equal(created.headers.get('access-control-allow-origin'),pages);
 const id=created.data.room.id,token=created.data.memberToken;
 const joined=await call('/rooms/'+id+'/join','POST',{name:'B',stopId:stops[1].id},'',null);assert.equal(joined.status,201);
 assert.equal((await call('/rooms/'+id,'GET',undefined,token,null)).data.members.length,2);
 const input={memberIds:[created.data.room.me.id,joined.data.room.me.id],meetingType:'regular',useApi:true};
 const denied=await call('/rooms/'+id+'/analysis','POST',input,token);assert.equal(denied.status,403);assert.match(denied.data.error,/Render|onrender/);assert.equal(external,0);assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM provider_usage').bind().first()).n,0);
 delete input.useApi;assert.equal((await call('/rooms/'+id+'/analysis','POST',input,token)).status,403);
 input.useApi=false;const result=await call('/rooms/'+id+'/analysis','POST',input,token);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.status,'estimated');assert.equal(result.data.calls,0);assert.equal(result.headers.get('access-control-allow-origin'),pages);
 const chosen=result.data.alternatives.fairnessId;const saved=await call('/rooms/'+id+'/confirm','POST',{runId:result.data.runId,candidateId:chosen},token);assert.equal(saved.status,201);
 const history=await call('/rooms/'+id+'/history','GET',undefined,token,null);assert.equal(history.data.meetings.length,1);assert.equal(history.data.meetings[0].calculation_mode,'estimated');assert.equal(external,0);
 const code=(await call('/rooms/'+id+'/recovery/issue','POST',{role:'member'},token)).data.code;
 const recovered=await call('/recovery/restore','POST',{code},'',null);assert.equal(recovered.status,200);assert.equal(recovered.data.roomId,id);assert.equal((await call('/rooms/'+id,'GET',undefined,recovered.data.memberToken,null)).data.me.id,created.data.room.me.id);
});


