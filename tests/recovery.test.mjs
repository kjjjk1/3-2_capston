import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {createDB} from '../tests-db.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const box={window:{}};vm.runInNewContext(readFileSync('stops_data.js','utf8'),box);const stopId=box.window.DT_SNIPER_STOPS[0].id;
test('guest recovery preserves identity and burden, rotates access, rejects replay and invite-only issuance',async()=>{
 const DB=createDB(),env={DB,KAKAO_REST_API_KEY:'configured',KAKAO_CLIENT_SECRET:'configured'};
 async function call(path,data,member='',owner=''){const r=await worker.fetch(new Request('https://room.test/api'+path,{method:data?'POST':'GET',headers:{...(member?{Authorization:'Bearer '+member}:{}),...(owner?{'X-Room-Owner-Token':owner}:{}),'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined}),env);return {status:r.status,data:await r.json()};}
 const created=await call('/rooms',{title:'복구 테스트'});assert.equal(created.status,201);const id=created.data.room.id,owner=created.data.ownerToken;
 const joined=await call('/rooms/'+id+'/join',{name:'민지',stopId});assert.equal(joined.status,201);const token=joined.data.memberToken,mid=joined.data.room.me.id;
 const base='/rooms/'+id+'/recovery';assert.equal((await call(base+'/issue',{role:'member'})).status,403);assert.equal((await call(base+'/issue',{role:'owner'},token)).status,403);
 const first=(await call(base+'/issue',{role:'member'},token)).data;
 const second=(await call(base+'/issue',{role:'member'},token)).data;assert.equal((await call(base+'/restore',{code:first.code})).status,403);
 const stored=await DB.prepare('SELECT code_hash FROM access_recovery WHERE subject_id=?').bind(mid).first();assert.notEqual(stored.code_hash,second.code);
 const room2=(await call('/rooms',{title:'다른 방'})).data.room.id;assert.equal((await call('/rooms/'+room2+'/recovery/restore',{code:second.code})).status,403);
 const run=crypto.randomUUID(),meeting=crypto.randomUUID();await DB.prepare('INSERT INTO analysis_runs(id,room_id,created_at,status,fingerprint) VALUES(?,?,?,?,?)').bind(run,id,Date.now(),'complete','x').run();
 await DB.prepare('INSERT INTO meeting_history(id,room_id,run_id,venue,regular,created_at,candidate_id) VALUES(?,?,?,?,?,?,?)').bind(meeting,id,run,'시청',1,new Date().toISOString(),'place').run();
 await DB.prepare('INSERT INTO burden_records(meeting_id,member_id,name,minutes,walk,transfers,relative) VALUES(?,?,?,?,?,?,?)').bind(meeting,mid,'민지',30,10,1,5).run();
 assert.equal((await call('/recovery/restore',{code:'invalid'})).status,403);
 const restored=await call('/recovery/restore',{code:second.code});assert.equal(restored.data.roomId,id);assert.equal((await call('/recovery/restore',{code:second.code})).status,403);assert.equal(restored.status,200);const next=restored.data.memberToken;
 assert.equal((await call('/rooms/'+id,null,token)).data.me,null);assert.equal((await call('/rooms/'+id,null,next)).data.me.id,mid);
 assert.equal((await call(base+'/restore',{code:second.code})).status,403);assert.equal((await DB.prepare('SELECT relative FROM burden_records WHERE member_id=?').bind(mid).first()).relative,5);
 const ownCode=(await call(base+'/issue',{role:'owner'},'',owner)).data.code;const recoveredOwner=await call('/recovery/restore',{code:ownCode});assert.equal(recoveredOwner.data.roomId,id);assert.equal(recoveredOwner.status,200);assert.equal((await call('/rooms/'+id,null,'',owner)).data.isOwner,false);assert.equal((await call('/rooms/'+id,null,'',recoveredOwner.data.ownerToken)).data.isOwner,true);
 const expired=(await call(base+'/issue',{role:'member'},next)).data.code;await DB.prepare('UPDATE access_recovery SET expires_at=0 WHERE subject_id=?').bind(mid).run();assert.equal((await call(base+'/restore',{code:expired})).status,403);
 DB.close();
});
test('linking guest membership keeps the same ID and revokes guest recovery',async()=>{
 const DB=createDB(),env={DB};
 async function call(path,data,token='',cookie=''){const r=await worker.fetch(new Request('https://room.test/api'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(cookie?{cookie}:{})},body:data?JSON.stringify(data):undefined}),env);return {status:r.status,data:await r.json()};}
 const created=await call('/rooms',{title:'계정 연결'}),id=created.data.room.id;
 const joined=await call('/rooms/'+id+'/join',{name:'친구',stopId}),token=joined.data.memberToken,mid=joined.data.room.me.id;
 const code=(await call('/rooms/'+id+'/recovery/issue',{role:'member'},token)).data.code;
 const uid=crypto.randomUUID(),session='test-session';const sha=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(session))).toString('hex');
 await DB.prepare('INSERT INTO app_users(id,kakao_id,nickname,created_at) VALUES(?,?,?,?)').bind(uid,'123','친구',new Date().toISOString()).run();await DB.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(sha,uid,Date.now()+60000).run();const cookie='__Host-dts_session='+session;
 assert.equal((await call('/rooms/'+id+'/account',{},token,cookie)).status,200);
 assert.equal((await call('/rooms/'+id,null,'',cookie)).data.me.id,mid);
 assert.equal((await call('/rooms/'+id+'/recovery/restore',{code})).status,403);
 assert.equal((await call('/rooms/'+id+'/recovery/issue',{role:'member'},'',cookie)).status,409);
 DB.close();
});
