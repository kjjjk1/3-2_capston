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
 const history=await call('/rooms/'+id+'/history','GET',undefined,token);assert.equal(history.data.meetings.length,1);assert.equal(history.data.meetings[0].records.length,4);
 const deleted=await call('/rooms/'+id+'/history','DELETE',{all:true},undefined,owner);assert.equal(deleted.status,200);assert.equal(deleted.data.meetings.length,0);
 assert.equal((await call('/rooms/'+id)).data.members.length,4);
});
