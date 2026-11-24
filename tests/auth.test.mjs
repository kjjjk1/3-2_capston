import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import worker from '../dist/server/index.js';
import {createDB} from '../tests-db.mjs';

test('removed login routes stay unavailable and cookies cannot grant room access',async()=>{
 const DB=createDB(),env={DB};
 try{
  for(const [path,method] of [['/auth/kakao','GET'],['/auth/kakao/callback','GET'],['/api/auth/session','GET'],['/api/auth/logout','POST'],['/api/account/rooms','GET']]){
   const response=await worker.fetch(new Request('https://room.test'+path,{method}),env);
   assert.equal(response.status,404,path);assert.equal(response.headers.get('set-cookie'),null);
  }
  const created=await (await worker.fetch(new Request('https://room.test/api/rooms',{method:'POST',body:JSON.stringify({title:'Token room'})}),env)).json();
  const path='https://room.test/api/rooms/'+created.room.id;
  const cookieOnly=await (await worker.fetch(new Request(path,{headers:{cookie:'__Host-dts_session=old-session'}}),env)).json();
  assert.equal(cookieOnly.isOwner,false);
  const owner=await (await worker.fetch(new Request(path,{headers:{'X-Room-Owner-Token':created.ownerToken}}),env)).json();
  assert.equal(owner.isOwner,true);
  const link=await worker.fetch(new Request(path+'/account',{method:'POST',body:'{}'}),env);assert.equal(link.status,404);
 }finally{DB.close();}
});

test('SQLite upgrade preserves linked room/member tokens and removes account data',()=>{
 const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
 try{
  for(const name of readdirSync('drizzle').filter(n=>n.endsWith('.sql')&&n<'0010').sort())db.exec(readFileSync('drizzle/'+name,'utf8'));
  db.prepare('INSERT INTO app_users VALUES(?,?,?,?)').run('user','123','nickname','today');
  db.prepare('INSERT INTO rooms(id,title,mode,created_at,creator_user_id,roster_creator_hash) VALUES(?,?,?,?,?,?)').run('room','Room','통합','today','user','owner-hash');
  db.prepare('INSERT INTO room_members(id,room_id,token_hash,name,stop_id,slot,user_id) VALUES(?,?,?,?,?,?,?)').run('member','room','member-hash','Name','stop',0,'user');
  db.exec(readFileSync('drizzle/0010_remove_accounts.sql','utf8'));
  assert.equal(db.prepare('SELECT owner_hash FROM rooms').get().owner_hash,'owner-hash');
  assert.deepEqual({...db.prepare('SELECT id,token_hash FROM room_members').get()},{id:'member',token_hash:'member-hash'});
  for(const table of ['app_users','auth_sessions','oauth_states'])assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table),undefined);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
});
