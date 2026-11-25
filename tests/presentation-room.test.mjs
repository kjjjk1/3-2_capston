import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import worker from '../dist/server/index.js';
import {createDB} from '../local-store.mjs';
import {metres} from '../analysis/core.mjs';
const id='05fdf6e8-8b65-4cb3-94ae-f38a13c01cd6';
test('every existing room exposes and edits origins and can analyze without credentials',async t=>{
 const DB=createDB();t.after(()=>DB.close());const box={window:{}};vm.runInNewContext(readFileSync('stops_data.js','utf8'),box);
 const all=box.window.DT_SNIPER_STOPS,stops=[...all].sort((a,b)=>metres(a,all[0])-metres(b,all[0])).slice(0,80);
 const network={source:'TEST',updatedAt:new Date().toISOString(),routes:[{id:'out',direction:'out',stops:stops.map(s=>s.id)},{id:'back',direction:'back',stops:stops.map(s=>s.id).reverse()}]};
 await DB.prepare('INSERT INTO transit_network VALUES(1,?,?)').bind(JSON.stringify(network),network.updatedAt).run();
 const ordinary=crypto.randomUUID(),members=[];
 for(const roomId of [id,ordinary]){
  await DB.prepare('INSERT INTO rooms(id,title,mode,created_at,owner_hash,roster_creator_hash) VALUES(?,?,?,?,?,?)').bind(roomId,'room','통합','today','owner-secret-hash','creator-secret-hash').run();
  for(let i=0;i<5;i++){const mid=crypto.randomUUID();if(roomId===id)members.push(mid);await DB.prepare('INSERT INTO room_members(id,room_id,token_hash,name,stop_id,slot,managed) VALUES(?,?,?,?,?,?,?)').bind(mid,roomId,mid+'-secret','P'+i,stops[i].id,i,[0,1,2,3,0][i]).run();}
 }
 let external=0;const env={DB,FETCH:async()=>{external++;throw Error('No external calls');}};
 const call=async(path,method='GET',data)=>{const response=await worker.fetch(new Request('https://server.test/api'+path,{method,headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)}),env);const text=await response.text();return {status:response.status,data:response.headers.get('content-type')?.includes('ndjson')?text.trim().split('\n').map(JSON.parse).at(-1):JSON.parse(text)};};
 const demo=(await call('/rooms/'+id)).data;assert.equal(demo.canAnalyze,true);assert.equal(demo.isOwner,true);assert.ok(demo.members.every(m=>m.canEdit&&m.editableStopId));
 const normal=(await call('/rooms/'+ordinary)).data;assert.equal(normal.canAnalyze,true);assert.ok(normal.members.every(m=>m.canEdit&&m.editableStopId));
 const renamed=await call('/rooms/'+id+'/settings','PUT',{title:'이름 변경 시연'});assert.equal(renamed.status,200);assert.equal(renamed.data.id,id);assert.equal(renamed.data.title,'이름 변경 시연');assert.equal(renamed.data.mode,'통합');assert.equal(renamed.data.members.length,5);
 assert.equal((await call('/rooms/'+id+'/settings','PUT',{title:'  '})).status,400);
 assert.equal((await call('/rooms/'+ordinary+'/settings','PUT',{mode:'버스만'})).status,200);
 assert.equal((await call('/rooms/'+ordinary)).data.title,'room');
 const original=(await DB.prepare('SELECT token_hash,managed FROM room_members WHERE id=?').bind(members[3]).first());
 assert.equal((await call('/rooms/'+id+'/participants/'+members[3],'PUT',{name:'P3',stopId:stops[8].id})).status,200);
 assert.deepEqual(await DB.prepare('SELECT token_hash,managed FROM room_members WHERE id=?').bind(members[3]).first(),original);
 assert.equal((await call('/rooms/'+ordinary+'/participants/'+normal.members[0].id,'PUT',{name:'P0',stopId:stops[9].id})).status,200);
 assert.equal((await call('/rooms/'+id+'/participants/'+normal.members[0].id,'PUT',{name:'wrong-room',stopId:stops[9].id})).status,409);
 const added=await call('/rooms/'+id+'/participants','POST',{name:'temporary',stopId:stops[0].id});assert.equal(added.status,201);const temporary=added.data.members.find(m=>m.name==='temporary');assert.equal((await call('/rooms/'+id+'/participants/'+temporary.id,'DELETE')).status,200);
 assert.equal((await call('/rooms/'+id+'/history','DELETE',{all:true})).status,403);
 assert.equal((await call('/rooms/'+id+'/recovery/issue','POST',{role:'owner'})).status,403);
 const result=await call('/rooms/'+id+'/analysis','POST',{memberIds:members,meetingType:'regular',useApi:false,recommendationPolicy:'balance'});
 assert.equal(result.status,200);assert.equal(result.data.status,'estimated');assert.equal(external,0);
 const choice=result.data.alternatives.fairnessId;assert.ok(choice);
 assert.equal((await call('/rooms/'+id+'/confirm','POST',{runId:result.data.runId,candidateId:choice})).status,201);
 assert.equal((await call('/rooms/'+id+'/history')).data.meetings.length,1);
 assert.equal((await call('/rooms/'+ordinary+'/analysis','POST',{})).status,400);
 const owner=await DB.prepare('SELECT owner_hash,roster_creator_hash FROM rooms WHERE id=?').bind(id).first();assert.equal(owner.owner_hash,'owner-secret-hash');assert.equal(owner.roster_creator_hash,'creator-secret-hash');
});

test('shared room readiness works without a member token and still requires all origins',()=>{
 const source=readFileSync('rooms.js','utf8'),a=source.indexOf('const ready='),b=source.indexOf('function apply()',a),box={room:{me:null,isOwner:false,canAnalyze:true,members:[{ready:true},{ready:true}]}};
 vm.createContext(box);vm.runInContext(source.slice(a,b)+';globalThis.canStart=ready;',box);assert.equal(box.canStart(),true);box.room.members[1].ready=false;assert.equal(box.canStart(),false);box.room.members[1].ready=true;box.room.canAnalyze=false;assert.equal(box.canStart(),false);
});
