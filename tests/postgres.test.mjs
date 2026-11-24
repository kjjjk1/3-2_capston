import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {postgresSQL,postgresAdapter,migratePostgres,createPostgresBucket,connectionConfig} from '../postgres-store.mjs';
import {seedNetwork} from '../server-network.mjs';
import worker from '../dist/server/index.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

async function fixture(t){
 const engine=new PGlite();t.after(()=>engine.close());
 const query=async(sql,args)=>{if(sql.includes(';')){const rows=await engine.exec(sql);return rows.at(-1);}const r=await engine.query(sql,args);return {...r,rowCount:r.affectedRows??r.rows.length};};
 const client={query,release(){}};const pool={query,connect:async()=>client,end:async()=>{}};
 await migratePostgres(pool);await engine.exec('SET search_path TO dt_sniper,pg_catalog');
 return {engine,pool,DB:postgresAdapter(pool)};
}

test('PostgreSQL markers preserve quoted question marks and TLS remains verified',()=>{
 assert.equal(postgresSQL("SELECT '?' AS value, ? AS param -- ?\n"),"SELECT '?' AS value, $1 AS param -- ?\n");
 assert.equal(postgresSQL('INSERT OR IGNORE INTO provider_usage VALUES(?,?,0)'), 'INSERT INTO provider_usage VALUES($1,$2,0) ON CONFLICT DO NOTHING');
 const cfg=connectionConfig('postgresql://u:p@db.example:5432/postgres?sslmode=disable');assert.equal(cfg.ssl.rejectUnauthorized,true);assert.equal(new URL(cfg.connectionString).searchParams.has('sslmode'),false);assert.equal(cfg.max,3);
});

test('private PostgreSQL schema is repeatable, batches roll back and photos persist in the DB',async t=>{
 const {DB,pool,engine}=await fixture(t);await migratePostgres(pool);
 assert.equal(await seedNetwork(DB),true);assert.equal(await seedNetwork(DB),false);
 await DB.prepare('INSERT INTO rooms(id,title,mode,created_at) VALUES(?,?,?,?)').bind('r','original','통합','today').run();
 await assert.rejects(DB.batch([DB.prepare('UPDATE rooms SET title=? WHERE id=?').bind('changed','r'),DB.prepare('INSERT INTO rooms(id,title,mode,created_at) VALUES(?,?,?,?)').bind('r','duplicate','통합','today')]),/UNIQUE/);
 assert.equal((await DB.prepare('SELECT title FROM rooms WHERE id=?').bind('r').first()).title,'original');
 const bucket=createPostgresBucket(DB);await bucket.put('test',new Uint8Array([1,2,3]));assert.deepEqual(Array.from((await createPostgresBucket(DB).get('test')).body),[1,2,3]);await bucket.delete('test');assert.equal(await bucket.get('test'),null);
 const rls=await engine.query("SELECT relrowsecurity FROM pg_class WHERE oid='dt_sniper.room_members'::regclass");assert.equal(rls.rows[0].relrowsecurity,true);
});

test('PostgreSQL supports participation, mocked route analysis, confirmation and history deletion',async t=>{
 const {DB}=await fixture(t);await seedNetwork(DB);
 const box={window:{}};vm.runInNewContext(readFileSync('stops_data.js','utf8'),box);const stops=box.window.DT_SNIPER_STOPS;
 let calls=0;
 const env={DB,BUCKET:createPostgresBucket(DB),KAKAO_TRANSIT_REST_API_KEY:'test',FETCH:async()=>{calls++;return Response.json({status:'OK',routes:[{properties:{type:'BUS',totalTime:1800,transfers:1},steps:[{properties:{type:'WALKING',distance:300,time:200}},{properties:{type:'BUS',distance:4000,time:1600,stops:[{name:'origin'},{name:'destination'}],vehicles:[{name:'101'}]}}]}]});}};
 const call=async(path,method='GET',data,token,owner)=>{const r=await worker.fetch(new Request('https://demo.test/api'+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(owner?{'X-Room-Owner-Token':owner}:{})},body:data?JSON.stringify(data):undefined}),env);const raw=await r.text();return {status:r.status,data:r.headers.get('content-type')?.includes('ndjson')?raw.trim().split('\n').map(JSON.parse).at(-1):JSON.parse(raw)};};
 const created=await call('/rooms','POST',{title:'PG demonstration'});assert.equal(created.status,201);const id=created.data.room.id,owner=created.data.ownerToken;
 const members=[];for(let i=0;i<4;i++){const r=await call('/rooms/'+id+'/join','POST',{name:'P'+i,stopId:stops[i].id});assert.equal(r.status,201);members.push(r.data);}
 const token=members[0].memberToken;
 const duplicate=await call('/rooms/'+id+'/join','POST',{name:'P0',stopId:stops[0].id});assert.equal(duplicate.status,409);
 assert.equal((await call('/rooms/'+id)).data.members.length,4);
 const r=await call('/rooms/'+id+'/analysis','POST',{memberIds:members.map(m=>m.room.me.id),meetingType:'regular',provider:'kakao',mode:'버스만'},token);
 assert.equal(r.data.status,'verified',JSON.stringify(r.data));assert.equal(calls,r.data.shortlisted*4);
 const saved=await call('/rooms/'+id+'/confirm','POST',{runId:r.data.runId,candidateId:r.data.recommendedCandidateId},token);assert.equal(saved.status,201);
 const history=await call('/rooms/'+id+'/history','GET',undefined,token);assert.equal(history.data.meetings.length,1);assert.equal(history.data.meetings[0].records.length,4);assert.equal(history.data.meetings[0].calculation_mode,'api');
 const deleted=await call('/rooms/'+id+'/history','DELETE',{all:true},undefined,owner);assert.equal(deleted.status,200);assert.equal(deleted.data.meetings.length,0);
 assert.equal((await call('/rooms/'+id)).data.members.length,4);
 const beforeCalls=calls;delete env.KAKAO_TRANSIT_REST_API_KEY;
 const off=await call('/rooms/'+id+'/analysis','POST',{memberIds:members.map(m=>m.room.me.id),meetingType:'regular',provider:'kakao',useApi:false},token);
 assert.equal(off.data.status,'estimated');assert.equal(calls,beforeCalls);
 assert.equal((await call('/rooms/'+id+'/confirm','POST',{runId:off.data.runId,candidateId:off.data.recommendedCandidateId},token)).status,201);
 const offHistory=(await call('/rooms/'+id+'/history','GET',undefined,token)).data;assert.equal(offHistory.meetings[0].calculation_mode,'estimated');
});


test('PostgreSQL upgrade retains existing account-linked access hashes',async t=>{
 const engine=new PGlite();t.after(()=>engine.close());
 await engine.exec('CREATE SCHEMA dt_sniper; SET search_path TO dt_sniper,pg_catalog');
 for(const name of ['0001_initial.sql','0002_calculation_mode.sql'])await engine.exec(readFileSync('postgres/'+name,'utf8'));
 await engine.exec("CREATE TABLE deployment_migrations(name TEXT PRIMARY KEY); INSERT INTO deployment_migrations VALUES ('0001_initial.sql'),('0002_calculation_mode.sql')");
 await engine.query('INSERT INTO app_users VALUES($1,$2,$3,$4)',['user','123','name','today']);
 await engine.query('INSERT INTO rooms(id,title,mode,created_at,creator_user_id,roster_creator_hash) VALUES($1,$2,$3,$4,$5,$6)',['room','Room','통합','today','user','owner-hash']);
 await engine.query('INSERT INTO room_members(id,room_id,token_hash,name,stop_id,slot,user_id) VALUES($1,$2,$3,$4,$5,$6,$7)',['member','room','member-hash','Name','stop',0,'user']);
 const query=async(sql,args)=>sql.includes(';')?(await engine.exec(sql)).at(-1):engine.query(sql,args);
 const client={query,release(){}};const pool={query,connect:async()=>client};
 await migratePostgres(pool);await migratePostgres(pool);
 assert.equal((await engine.query('SELECT owner_hash FROM rooms')).rows[0].owner_hash,'owner-hash');
 assert.deepEqual((await engine.query('SELECT id,token_hash FROM room_members')).rows[0],{id:'member',token_hash:'member-hash'});
 assert.equal((await engine.query("SELECT tablename FROM pg_tables WHERE schemaname='dt_sniper' AND tablename IN ('app_users','auth_sessions','oauth_states')")).rows.length,0);
});
