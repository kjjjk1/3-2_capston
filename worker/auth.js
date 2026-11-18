const sessionCookie='__Host-dts_session',stateCookie='__Host-dts_oauth';
const cookieValue=(req,key)=>req.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(key+'='))?.slice(key.length+1)||'';
const authConfigured=env=>!!(env.KAKAO_REST_API_KEY&&env.KAKAO_CLIENT_SECRET);
const authCookie=(key,value,seconds)=>`${key}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`;
function localReturn(value){if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||value.includes('\\')||/[\r\n]/.test(value))return '/';return value.slice(0,1000);}
async function account(req,db){const token=cookieValue(req,sessionCookie);if(!token||token.length>200)return null;return db.prepare('SELECT u.id,u.nickname FROM auth_sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(token),Date.now()).first();}
async function needAccount(req,env){const user=await account(req,env.DB);return user;}
function authRedirect(path,cookies=[]){const headers=new Headers({'Location':path,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});cookies.forEach(c=>headers.append('Set-Cookie',c));return new Response(null,{status:303,headers});}
async function providerJSON(url,options){const res=await fetch(url,{...options,signal:AbortSignal.timeout(12000)});if(!res.ok)throw Error('provider');return res.json();}
export async function authRoutes(req,env){const url=new URL(req.url),p=url.pathname,db=env.DB;
if(p==='/api/auth/session'&&req.method==='GET')return json({configured:authConfigured(env),user:await account(req,db)});
if(p==='/auth/kakao'&&req.method==='GET'){
 if(!authConfigured(env))return authRedirect('/?auth_error=not_configured');
 const state=crypto.randomUUID()+crypto.randomUUID();await db.prepare('DELETE FROM oauth_states WHERE expires_at<?').bind(Date.now()).run();await db.prepare('INSERT INTO oauth_states(state_hash,return_to,expires_at) VALUES(?,?,?)').bind(await hash(state),localReturn(url.searchParams.get('returnTo')),Date.now()+600000).run();
 const target=new URL('https://kauth.kakao.com/oauth/authorize');target.search=new URLSearchParams({response_type:'code',client_id:env.KAKAO_REST_API_KEY,redirect_uri:url.origin+'/auth/kakao/callback',state}).toString();return authRedirect(target.href,[authCookie(stateCookie,state,600)]);
}
if(p==='/auth/kakao/callback'&&req.method==='GET'){
 const clear=authCookie(stateCookie,'',0),state=url.searchParams.get('state')||'';
 if(!authConfigured(env)||!state||state.length>200||state!==cookieValue(req,stateCookie))return authRedirect('/?auth_error=invalid_state',[clear]);
 const row=await db.prepare('SELECT return_to,expires_at FROM oauth_states WHERE state_hash=?').bind(await hash(state)).first();const consumed=await db.prepare('DELETE FROM oauth_states WHERE state_hash=?').bind(await hash(state)).run();
 if(!row||!consumed.meta.changes||row.expires_at<Date.now())return authRedirect('/?auth_error=invalid_state',[clear]);
 const destination=localReturn(row.return_to),errorPath=code=>destination+(destination.includes('?')?'&':'?')+'auth_error='+code;
 if(url.searchParams.has('error'))return authRedirect(errorPath('cancelled'),[clear]);const code=url.searchParams.get('code');if(!code||code.length>1000)return authRedirect(errorPath('failed'),[clear]);
 try{
  const result=await providerJSON('https://kauth.kakao.com/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=utf-8'},body:new URLSearchParams({grant_type:'authorization_code',client_id:env.KAKAO_REST_API_KEY,client_secret:env.KAKAO_CLIENT_SECRET,redirect_uri:url.origin+'/auth/kakao/callback',code})});
  if(!result.access_token)throw Error('token');const profile=await providerJSON('https://kapi.kakao.com/v2/user/me',{headers:{Authorization:'Bearer '+result.access_token}});if(!profile.id||!/^\d+$/.test(String(profile.id)))throw Error('profile');
  const nickname=clean(profile.kakao_account?.profile?.nickname||profile.properties?.nickname,40)||'카카오 사용자';const providerId=String(profile.id);
  await db.prepare('INSERT INTO app_users(id,kakao_id,nickname,created_at) VALUES(?,?,?,?) ON CONFLICT(kakao_id) DO UPDATE SET nickname=excluded.nickname').bind(crypto.randomUUID(),providerId,nickname,new Date().toISOString()).run();const user=await db.prepare('SELECT id FROM app_users WHERE kakao_id=?').bind(providerId).first();
  const old=cookieValue(req,sessionCookie);if(old)await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hash(old)).run();await db.prepare('DELETE FROM auth_sessions WHERE expires_at<?').bind(Date.now()).run();
  const token=crypto.randomUUID()+crypto.randomUUID();await db.prepare('INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(token),user.id,Date.now()+604800000).run();return authRedirect(destination,[clear,authCookie(sessionCookie,token,604800)]);
 }catch{return authRedirect(errorPath('failed'),[clear]);}
}
if(p==='/api/auth/logout'&&req.method==='POST'){const token=cookieValue(req,sessionCookie);if(token)await db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').bind(await hash(token)).run();return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':authCookie(sessionCookie,'',0)}});}
if(p==='/api/account/rooms'&&req.method==='GET'){const user=await account(req,db);if(!user)fail('로그인 후 확인할 수 있어요.',401);const rows=await db.prepare('SELECT DISTINCT r.id FROM rooms r LEFT JOIN room_members m ON m.room_id=r.id WHERE m.user_id=? OR r.creator_user_id=? ORDER BY r.created_at DESC').bind(user.id,user.id).all();return json({ids:rows.results.map(r=>r.id)});}
const recovery=p.match(/^\/api\/rooms\/([a-f0-9-]{36})\/recovery\/(issue|restore)$/);
if(recovery&&req.method==='POST'){
 const [,id,action]=recovery,b=await body(req),room=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();
 if(!room)fail('모임을 찾을 수 없어요.',404);
 if(action==='issue'){
  const role=b.role==='owner'?'owner':'member';let subject;
  if(role==='member'){subject=await mine(req,db,id);if(!subject)fail('본인 참여 권한이 필요해요.',403);if(subject.user_id)fail('계정에 연결된 참여 정보는 카카오 로그인으로 복원해주세요.',409);}
  else{if(!await rosterCreator(req,db,room))fail('모임 생성자만 발급할 수 있어요.',403);if(room.creator_user_id)fail('계정에 연결된 모임은 카카오 로그인으로 복원해주세요.',409);subject={id};}
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
  if(!m||m.user_id)fail('카카오 로그인 또는 기존 참여 정보를 확인해주세요.',409);
  const current=await mine(req,db,id);if(current&&current.id!==m.id)fail('이미 다른 참여자로 접속 중입니다. 별도 브라우저에서 복구해주세요.',409);
 }else if(room.creator_user_id)fail('카카오 로그인으로 복원해주세요.',409);
 const token=crypto.randomUUID()+crypto.randomUUID(),tokenHash=await hash(token);
 const update=row.role==='member'?db.prepare('UPDATE room_members SET token_hash=? WHERE id=? AND room_id=? AND user_id IS NULL AND EXISTS(SELECT 1 FROM access_recovery WHERE code_hash=?)').bind(tokenHash,row.subject_id,id,digest):db.prepare('UPDATE rooms SET owner_hash=?,roster_creator_hash=? WHERE id=? AND creator_user_id IS NULL AND EXISTS(SELECT 1 FROM access_recovery WHERE code_hash=?)').bind(tokenHash,tokenHash,id,digest);
 const changes=await db.batch([update,db.prepare('DELETE FROM access_recovery WHERE code_hash=?').bind(digest)]);
 if(!changes[0].meta.changes)fail('이미 사용된 코드입니다.',409);
 return json(row.role==='member'?{memberToken:token}:{ownerToken:token});
}
const link=p.match(/^\/api\/rooms\/([a-f0-9-]{36})\/account$/);
if(link&&req.method==='POST'){
 const user=await account(req,db);if(!user)fail('로그인 후 연결해주세요.',401);const id=link[1],token=req.headers.get('authorization')?.replace(/^Bearer /,'');let linked=false;
 if(token&&token.length<=200){const member=await db.prepare('SELECT id,user_id FROM room_members WHERE room_id=? AND token_hash=?').bind(id,await hash(token)).first();if(member){if(member.user_id&&member.user_id!==user.id)fail('다른 계정에 연결된 참여 정보예요.',409);try{await db.prepare('UPDATE room_members SET user_id=? WHERE id=? AND (user_id IS NULL OR user_id=?)').bind(user.id,member.id,user.id).run();linked=true;}catch{fail('이 계정은 이미 다른 이름으로 참여했어요.',409);}}}
 const owner=req.headers.get('X-Room-Owner-Token');if(owner&&owner.length<=200){const r=await db.prepare('UPDATE rooms SET creator_user_id=?,owner_hash=NULL WHERE id=? AND owner_hash=? AND creator_user_id IS NULL').bind(user.id,id,await hash(owner)).run();linked=linked||!!r.meta.changes;}
 if(!linked)fail('연결할 기존 참여 권한을 확인할 수 없어요.',403);await db.prepare("DELETE FROM access_recovery WHERE room_id=? AND (role='owner' OR subject_id IN (SELECT id FROM room_members WHERE room_id=? AND user_id=?))").bind(id,id,user.id).run();const participant=await db.prepare('SELECT id FROM room_members WHERE room_id=? AND user_id=?').bind(id,user.id).first();if(participant)await db.prepare('UPDATE rooms SET creator_user_id=NULL WHERE id=? AND creator_user_id=?').bind(id,user.id).run();return json({ok:true});
}
return undefined;}
