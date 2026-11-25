import {roomAddons,roomOwner} from './addons.js';
const isSharedRoom=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const assets=/*ASSETS*/ {};
const validStops=new Set(/*STOP_IDS*/ []);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join('');
async function body(req,max=4096){if(Number(req.headers.get('content-length'))>max)fail('입력 내용이 너무 길어요.',413);const txt=await req.text();if(txt.length>max)fail('입력 내용이 너무 길어요.',413);try{return JSON.parse(txt);}catch{fail('잘못된 요청이에요.');}}
const clean=(s,max)=>typeof s==='string'?s.trim().slice(0,max):'';
function person(b){const name=clean(b.name,20).normalize('NFKC'),stopId=clean(b.stopId,40);if(!name)fail('이름을 입력해주세요.');if(!validStops.has(stopId))fail('목록에서 출발 정류장을 선택해주세요.');return{name,stopId};}
async function mine(req,db,id){const user=await account(req,db);if(user){const me=await db.prepare('SELECT * FROM room_members WHERE room_id=? AND user_id=?').bind(id,user.id).first();if(me)return me;}const token=req.headers.get('authorization')?.replace(/^Bearer /,'');if(!token||token.length>200)return null;const member=await db.prepare('SELECT * FROM room_members WHERE room_id=? AND token_hash=?').bind(id,await hash(token)).first();if(member?.user_id&&member.user_id!==user?.id)return null;return member;}
async function readRoom(req,db,id){const room=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(id).first();if(!room)fail('모임을 찾을 수 없어요. 링크를 확인해주세요.',404);const members=(await db.prepare('SELECT id,name,slot,stop_id,managed FROM room_members WHERE room_id=? ORDER BY slot').bind(id).all()).results;const me=await mine(req,db,id),creator=await rosterCreator(req,db,room);return{id:room.id,title:room.title,mode:room.mode,sharedAccess:isSharedRoom(id),canAnalyze:isSharedRoom(id),isOwner:await roomOwner(req,db,room),photoUrl:room.photo_key?'/api/rooms/'+id+'/photo?v='+encodeURIComponent(room.photo_key.split('/').at(-1)):null,members:members.map(m=>({id:m.id,name:m.name,slot:m.slot,ready:!!m.stop_id,managed:!!m.managed,canEdit:isSharedRoom(id)||(creator&&[1,2].includes(m.managed)),editableStopId:isSharedRoom(id)||(creator&&[1,2].includes(m.managed))?m.stop_id:null,claimable:m.managed===2||(m.managed===1&&!m.stop_id)})),me:me?{id:me.id,name:me.name,stopId:me.stop_id}:null};}
const appWorker={async fetch(req,env){const url=new URL(req.url),p=url.pathname;try{if(p.startsWith('/auth/')||p.startsWith('/api/')){if(req.method!=='GET'&&!pagesRequest(req,env)&&((req.headers.get('origin')&&req.headers.get('origin')!==url.origin)||req.headers.get('sec-fetch-site')==='cross-site'))fail('다른 사이트에서의 요청은 허용하지 않아요.',403);if(!env.DB)fail('모임 저장소에 연결하지 못했어요.',503);const db=env.DB;const auth=await authRoutes(req,env);if(auth!==undefined)return auth;if(req.method!=='GET')await needAccount(req,env);const final=await finalRoutes(req,env);if(final!==undefined)return final;const extra=await roomAddons(req,env);if(extra!==undefined)return extra;
if(p==='/api/rooms'&&req.method==='POST'){const user=await account(req,db),b=await body(req),{name,stopId}=person(b),title=clean(b.title,60);if(!title)fail('모임 이름을 입력해주세요.');const mode=['버스만','통합','전체'].includes(b.mode)?b.mode:'통합',id=crypto.randomUUID(),memberId=crypto.randomUUID(),memberToken=crypto.randomUUID()+crypto.randomUUID();await db.batch([db.prepare('INSERT INTO rooms(id,title,mode,created_at) VALUES(?,?,?,?)').bind(id,title,mode,new Date().toISOString()),db.prepare('INSERT INTO room_members(id,room_id,token_hash,name,stop_id,slot,user_id) VALUES(?,?,?,?,?,0,?)').bind(memberId,id,await hash(memberToken),name,stopId,user?.id||null)]);return json({room:await readRoom(new Request(req.url,{headers:{cookie:req.headers.get('cookie')||'',Authorization:'Bearer '+memberToken,'X-Room-Owner-Token':req.headers.get('X-Room-Owner-Token')||''}}),db,id),memberToken},201);}
const m=p.match(/^\/api\/rooms\/([a-f0-9-]{36})(?:\/(join|me))?$/);if(!m)fail('요청한 기능을 찾을 수 없어요.',404);const [,id,action]=m;if(!action&&req.method==='GET')return json(await readRoom(req,db,id));
if(action==='join'&&req.method==='POST'){const user=await account(req,db);if(await mine(req,db,id))fail('이미 참여한 모임이에요. 내 정보를 수정해주세요.',409);const b=await body(req),{name,stopId}=person(b);if(!await db.prepare('SELECT id FROM rooms WHERE id=?').bind(id).first())fail('모임을 찾을 수 없어요.',404);const memberId=crypto.randomUUID(),memberToken=crypto.randomUUID()+crypto.randomUUID();try{await db.prepare('INSERT INTO room_members(id,room_id,token_hash,name,stop_id,slot,user_id) VALUES(?,?,?,?,?,COALESCE((SELECT slot+1 FROM room_members WHERE room_id=? ORDER BY slot DESC LIMIT 1),0),?)').bind(memberId,id,await hash(memberToken),name,stopId,id,user?.id||null).run();}catch(err){if(err.status)throw err;if(String(err).includes('UNIQUE'))fail('이미 쓰는 이름이에요. 구분할 수 있게 이름을 바꿔주세요.',409);throw err;}return json({room:await readRoom(new Request(req.url,{headers:{cookie:req.headers.get('cookie')||'',Authorization:'Bearer '+memberToken,'X-Room-Owner-Token':req.headers.get('X-Room-Owner-Token')||''}}),db,id),memberToken},201);}
if(action==='me'&&req.method==='PUT'){const me=await mine(req,db,id);if(!me)fail('내 참여 권한을 확인할 수 없어요. 참여한 브라우저에서 열어주세요.',401);const {name,stopId}=person(await body(req));try{await db.prepare('UPDATE room_members SET name=?,stop_id=? WHERE id=? AND room_id=?').bind(name,stopId,me.id,id).run();}catch(err){if(String(err).includes('UNIQUE'))fail('이미 쓰는 이름이에요.',409);throw err;}return json(await readRoom(req,db,id));}fail('지원하지 않는 요청이에요.',405);
}
const asset=assets[p==='/'||p==='/index.html'?'/':p];if(asset&&['GET','HEAD'].includes(req.method))return new Response(req.method==='HEAD'?null:asset.body,{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}});return new Response('Not found',{status:404});
}catch(err){if(!err.status)console.error(JSON.stringify({event:'room_request_failed',action:p.split('/').at(-1),message:String(err.message||err).slice(0,500)}));return json({error:err.status?err.message:'처리하지 못했어요. 잠시 후 다시 시도해주세요.'},err.status||500);}}};

function pagesOrigin(env){return env.PAGES_ORIGIN||'https://kjjjk1.github.io';}
function pagesRequest(req,env){
 const origin=req.headers.get('origin');if(origin)return origin===pagesOrigin(env);
 try{return new URL(req.headers.get('referer')).origin===pagesOrigin(env);}catch{return false;}
}
export default {async fetch(req,env){
 const url=new URL(req.url),origin=req.headers.get('origin'),api=url.pathname.startsWith('/api/');
 const allowed=origin===pagesOrigin(env),foreign=origin&&origin!==url.origin;
 if((api||url.pathname.startsWith('/auth/'))&&foreign&&!allowed)return json({error:'허용되지 않은 사이트의 요청입니다.'},403);
 let response;
 if(api&&req.method==='OPTIONS'){
  if(!allowed)return json({error:'허용되지 않은 사이트의 요청입니다.'},403);
  const method=req.headers.get('access-control-request-method');
  const requested=(req.headers.get('access-control-request-headers')||'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
  if(!['GET','POST','PUT','DELETE','HEAD'].includes(method)||requested.some(h=>!['authorization','content-type','x-room-owner-token'].includes(h)))response=json({error:'허용되지 않은 요청입니다.'},403);
  else response=new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, PUT, DELETE, HEAD, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, X-Room-Owner-Token','Access-Control-Max-Age':'600'}});
 }else response=await appWorker.fetch(req,env);
 if(api){const headers=new Headers(response.headers);headers.append('Vary','Origin');if(allowed)headers.set('Access-Control-Allow-Origin',origin);return new Response(response.body,{status:response.status,statusText:response.statusText,headers});}
 return response;
}};
