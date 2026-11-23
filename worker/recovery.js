export async function recoveryRoutes(req,env){
const url=new URL(req.url),p=url.pathname,db=env.DB;
if(p==='/api/recovery/restore'&&req.method==='POST'){
 const b=await body(req),code=typeof b.code==='string'?b.code.trim():'';
 if(!/^[a-f0-9]{64}$/.test(code))fail('복구 코드를 확인해주세요.',403);
 const row=await db.prepare('SELECT room_id FROM access_recovery WHERE code_hash=? AND expires_at>?').bind(await hash(code),Date.now()).first();
 if(!row)fail('코드가 만료되었거나 이미 사용·재발급되었습니다.',403);
 const target=new URL(req.url);target.pathname='/api/rooms/'+row.room_id+'/recovery/restore';
 const response=await recoveryRoutes(new Request(target,{method:'POST',headers:req.headers,body:JSON.stringify({code})}),env);
 return json({...await response.json(),roomId:row.room_id},response.status);
}
const recovery=p.match(/^\/api\/rooms\/([a-f0-9-]{36})\/recovery\/(issue|restore)$/);
if(recovery&&req.method==='POST'){
 const [,id,action]=recovery,b=await body(req),room=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();
 if(!room)fail('모임을 찾을 수 없어요.',404);
 if(action==='issue'){
  const role=b.role==='owner'?'owner':'member';let subject;
  if(role==='member'){subject=await mine(req,db,id);if(!subject)fail('본인 참여 권한이 필요해요.',403);}
  else{if(!await rosterCreator(req,db,room))fail('모임 생성자만 발급할 수 있어요.',403);subject={id};}
  const code=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),expiresAt=Date.now()+365*86400000;
  await db.prepare('INSERT INTO access_recovery(room_id,subject_id,role,code_hash,expires_at) VALUES(?,?,?,?,?) ON CONFLICT(room_id,subject_id,role) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at').bind(id,subject.id,role,await hash(code),expiresAt).run();
  return json({code,role,expiresAt});
 }
 const code=typeof b.code==='string'?b.code.trim():'';
 if(!/^[a-f0-9]{64}$/.test(code))fail('복구 코드를 확인해주세요.',403);
 const digest=await hash(code),row=await db.prepare('SELECT * FROM access_recovery WHERE room_id=? AND code_hash=? AND expires_at>?').bind(id,digest,Date.now()).first();
 if(!row)fail('코드가 만료되었거나 이미 사용·재발급되었습니다.',403);
 if(row.role==='member'){
  const m=await db.prepare('SELECT * FROM room_members WHERE room_id=? AND id=?').bind(id,row.subject_id).first();
  if(!m)fail('기존 참여 정보를 확인해주세요.',409);
  const current=await mine(req,db,id);if(current&&current.id!==m.id)fail('이미 다른 참여자로 접속 중입니다. 별도 브라우저에서 복구해주세요.',409);
 }
 const token=crypto.randomUUID()+crypto.randomUUID(),tokenHash=await hash(token);
 const update=row.role==='member'?db.prepare('UPDATE room_members SET token_hash=? WHERE id=? AND room_id=? AND EXISTS(SELECT 1 FROM access_recovery WHERE code_hash=?)').bind(tokenHash,row.subject_id,id,digest):db.prepare('UPDATE rooms SET owner_hash=?,roster_creator_hash=? WHERE id=? AND EXISTS(SELECT 1 FROM access_recovery WHERE code_hash=?)').bind(tokenHash,tokenHash,id,digest);
 const changes=await db.batch([update,db.prepare('DELETE FROM access_recovery WHERE code_hash=?').bind(digest)]);
 if(!changes[0].meta.changes)fail('이미 사용된 코드입니다.',409);
 return json(row.role==='member'?{memberToken:token}:{ownerToken:token});
}
return undefined;}
