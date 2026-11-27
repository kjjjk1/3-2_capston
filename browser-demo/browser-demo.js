/* GitHub Pages prototype: browser storage only. No cloud API requests. */
(()=>{
 const json=(value,status=200)=>Response.json(value,{status});
 const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
 const uid=()=>crypto.randomUUID();
 function indexedStore(){
  let connection;
  const open=()=>connection||(connection=new Promise((resolve,reject)=>{const r=indexedDB.open('dt-sniper-browser-demo-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('브라우저 저장소를 열지 못했어요. 저장소 사용을 허용해주세요.'));}));
  return {async read(){const db=await open();return new Promise((resolve,reject)=>{const r=db.transaction('state').objectStore('state').get('app');r.onsuccess=()=>resolve(r.result||{rooms:{},codes:{}});r.onerror=()=>reject(r.error);});},async write(value){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('state','readwrite');tx.objectStore('state').put(value,'app');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('브라우저 저장 공간이 부족하거나 저장이 차단되어 있어요.'));tx.onabort=()=>reject(Error('브라우저 기록을 저장하지 못했어요.'));});}};
 }
 let enginePromise;
 function loadEngine(){
  if(typeof Worker==='function')return enginePromise||(enginePromise=Promise.resolve((()=>{
   const worker=new Worker(new URL('browser-demo-worker.js',document.baseURI)),pending=new Map();let sequence=0;
   worker.onmessage=({data})=>{const item=pending.get(data.id);if(!item)return;pending.delete(data.id);data.error?item.reject(Error(data.error)):item.resolve(data.result);};
   worker.onerror=()=>{worker.terminate();enginePromise=null;for(const item of pending.values())item.reject(Error('브라우저 분석 파일을 불러오지 못했어요. 페이지를 새로고침해주세요.'));pending.clear();};
   return {analyze:input=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({id,input});})};
  })()));
  if(window.DTLocalEngine)return Promise.resolve(window.DTLocalEngine);return enginePromise||(enginePromise=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('browser-demo-engine.js',document.baseURI).href;script.onload=()=>window.DTLocalEngine?resolve(window.DTLocalEngine):reject(Error('브라우저 분석 파일을 확인해주세요.'));script.onerror=()=>{enginePromise=null;reject(Error('브라우저 분석 파일을 불러오지 못했어요. browser-demo-engine.js를 같은 폴더에 업로드해주세요.'));};document.head.append(script);}));}
 function create({store=indexedStore(),stops=window.DT_SNIPER_STOPS||[],engine=loadEngine}={}){
  const stopMap=new Map(stops.map(s=>[s.id,s]));let queue=Promise.resolve();
  const clean=(s,n)=>typeof s==='string'?s.trim().normalize('NFKC').slice(0,n):'';
  function person(b,optional=false){const name=clean(b.name,20),stopId=clean(b.stopId,40);if(!name)fail('이름을 입력해주세요.');if((!optional||stopId)&&!stopMap.has(stopId))fail('목록에서 출발 정류장을 선택해주세요.');return {name,stopId};}
  function history(room){const balances={};for(const m of room.history)if(m.regular)for(const r of m.records)balances[r.member_id]=(balances[r.member_id]||0)+r.relative;return {balances,meetings:room.history,canDelete:true};}
  function view(room,headers){const token=headers.get('authorization')?.replace(/^Bearer /,''),me=room.members.find(m=>m.token===token),owner=headers.get('x-room-owner-token')===room.ownerToken;return {id:room.id,title:room.title,mode:'통합',isOwner:true,sharedAccess:true,photoUrl:room.photo||null,localDemo:true,members:room.members.map((m,slot)=>({id:m.id,name:m.name,slot,ready:!!m.stopId,managed:m.managed,canEdit:true,editableStopId:m.stopId||null,claimable:m.managed!==3})),me:me?{id:me.id,name:me.name,stopId:me.stopId}:null};}
  const allow=(room,h)=>{if(!view(room,h).isOwner)fail('이 브라우저에서 모임을 만들거나 참여한 뒤 이용해주세요.',403);};
  function unique(room,name,except){if(room.members.some(m=>m.name===name&&m.id!==except))fail('이미 등록된 이름이에요.',409);}
  async function handle(path,options={}){
   const url=new URL(path,'https://browser.demo'),p=url.pathname,method=options.method||'GET',headers=new Headers(options.headers);
   let b={};if(typeof options.body==='string'){try{b=JSON.parse(options.body);}catch{fail('입력 내용을 확인해주세요.');}}
   const state=await store.read();state.codes||={};
   const save=()=>store.write(state);
   if(p==='/api/browser/backup'&&method==='GET')return json(window.DTBrowserBackup.exportState(state));
   if(p==='/api/browser/import'&&method==='POST'){
    const imported=window.DTBrowserBackup.normalize(b,stops);
    if(imported.some(r=>Object.hasOwn(state.rooms,r.id)))fail('같은 ID의 모임이 이미 있습니다. 기존 기록은 덮어쓰지 않았습니다.',409);
    for(const r of imported)state.rooms[r.id]=r;
    await save();return json({imported:imported.length,rooms:imported.map(r=>({id:r.id,title:r.title,ownerToken:r.ownerToken}))},201);
   }
   if(p==='/api/auth/session')return json({configured:false,user:null,localDemo:true});
   if(p==='/api/account/rooms')return json({ids:Object.keys(state.rooms),localDemo:true});
   if(p==='/api/config')return json({localDemo:true,routeApiAllowed:false,kakaoLocal:false,kakaoTransit:false,odsay:false,networkReady:true,candidateCount:100,shortlistCount:5,naverMapClientId:''});
   if(p==='/api/places')fail('브라우저 시연에서는 정류장 이름으로 검색해주세요. 외부 API를 사용하지 않습니다.');
   if(p==='/api/rooms'&&method==='POST'){
    const title=clean(b.title,60);if(!title)fail('모임 이름을 입력해주세요.');
    const room={id:uid(),title,ownerToken:uid()+uid(),photo:b.photo||null,members:[],history:[],runs:{},revision:0};state.rooms[room.id]=room;
    let memberToken;if(b.name||b.stopId){const personData=person(b);memberToken=uid()+uid();room.members.push({id:uid(),...personData,token:memberToken,managed:3});}
    await save();const own=new Headers(headers);own.set('X-Room-Owner-Token',room.ownerToken);if(memberToken)own.set('Authorization','Bearer '+memberToken);
    return json({room:view(room,own),ownerToken:room.ownerToken,...(memberToken?{memberToken}:{})},201);
   }
   if(p==='/api/recovery/restore'){
    const row=state.codes[b.code];if(!row||row.expiresAt<Date.now())fail('이 브라우저에 저장된 유효한 복구 코드가 없습니다.',403);
    return restore(row.roomId,b.code);
   }
   async function restore(id,code){const row=state.codes[code],room=state.rooms[id];if(!row||row.roomId!==id||row.expiresAt<Date.now()||!room)fail('코드가 만료되었거나 이 브라우저의 모임이 아닙니다.',403);let response;
    if(row.role==='owner'){room.ownerToken=uid()+uid();response={ownerToken:room.ownerToken};}else{const m=room.members.find(m=>m.id===row.memberId);if(!m)fail('참여자를 찾을 수 없어요.',404);m.token=uid()+uid();response={memberToken:m.token};}
    delete state.codes[code];await save();return json({roomId:id,...response});
   }
   const match=p.match(/^\/api\/rooms\/([a-f0-9-]{36})(?:\/(participants|join|me|settings|photo|analysis|confirm|history|recovery)(?:\/(.*))?)?$/);
   if(!match)fail('브라우저 시연에서 지원하지 않는 요청입니다.',404);
   const [,id,action,subject]=match,room=state.rooms[id];
   if(!room)fail('이 브라우저에 저장된 모임이 없어요. 홈에서 새 모임이나 4명 예시 모임을 열어주세요. 서버 모임은 Render 주소에서 확인할 수 있어요.',404);
   room.runs||={};
   if(!action&&method==='GET')return json(view(room,headers));
   if(action==='join'&&method==='POST'){
    if(view(room,headers).me)fail('이미 참여한 모임이에요.',409);const data=person(b);let m;
    if(b.memberId){m=room.members.find(m=>m.id===b.memberId&&m.name===data.name&&m.managed!==3);if(!m)fail('등록된 참여자를 확인해주세요.',409);Object.assign(m,data);}else{unique(room,data.name);m={id:uid(),...data};room.members.push(m);}
    m.managed=3;m.token=uid()+uid();room.revision++;await save();const next=new Headers(headers);next.set('Authorization','Bearer '+m.token);return json({room:view(room,next),memberToken:m.token},201);
   }
   if(action==='recovery'&&subject==='restore')return restore(id,b.code);
   allow(room,headers);
   if(action==='recovery'&&subject==='issue'){
    const role=b.role==='owner'?'owner':'member',me=view(room,headers).me;if(role==='owner'&&headers.get('X-Room-Owner-Token')!==room.ownerToken)fail('모임 생성자 권한이 필요해요.',403);if(role==='member'&&!me)fail('참여 권한이 필요해요.',403);
    for(const [key,row]of Object.entries(state.codes))if(row.roomId===id&&row.role===role&&row.memberId===(me?.id||null))delete state.codes[key];
    const code=uid().replaceAll('-','')+uid().replaceAll('-',''),expiresAt=Date.now()+365*86400000;state.codes[code]={roomId:id,role,memberId:me?.id||null,expiresAt};await save();return json({code,role,expiresAt});
   }
   if(action==='participants'){
    if(method==='POST'){const data=person(b,true);unique(room,data.name);room.members.push({id:uid(),...data,managed:data.stopId?2:1,token:uid()+uid()});}
    else{const index=room.members.findIndex(m=>m.id===subject);if(index<0)fail('참여자를 찾을 수 없어요.',404);if(method==='DELETE')room.members.splice(index,1);else if(method==='PUT'){const data=person(b,true);unique(room,data.name,subject);Object.assign(room.members[index],data,{managed:data.stopId?2:1});}else fail('지원하지 않는 요청입니다.',405);}
    room.revision++;await save();return json(view(room,headers),method==='POST'?201:200);
   }
   if(action==='me'&&method==='PUT'){const me=view(room,headers).me;if(!me)fail('내 참여 정보를 찾을 수 없어요.',403);const data=person(b);unique(room,data.name,me.id);Object.assign(room.members.find(m=>m.id===me.id),data);room.revision++;await save();return json(view(room,headers));}
   if(action==='settings'&&method==='PUT'){if(b.title!==undefined){const title=clean(b.title,60);if(!title)fail('모임 이름을 입력해주세요.');room.title=title;}await save();return json(view(room,headers));}
   if(action==='photo'&&method==='PUT'){const blob=options.body;if(!(blob instanceof Blob)||blob.size>200000||blob.type!=='image/jpeg')fail('200KB 이하의 JPEG 사진을 선택해주세요.');room.photo=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});await save();return json(view(room,headers));}
   if(action==='history'){
    if(method==='DELETE'){if(b.all!==true&&(!Array.isArray(b.meetingIds)||!b.meetingIds.length))fail('삭제할 기록을 선택해주세요.');room.history=b.all===true?[]:room.history.filter(m=>!b.meetingIds.includes(m.id));room.revision++;await save();}
    return json(history(room));
   }
   if(action==='analysis'&&method==='POST'){
    if(b.useApi!==false)fail('브라우저 시연은 API OFF 자체 추정만 지원합니다.');
    const ids=b.memberIds;if(!Array.isArray(ids)||ids.length<2||ids.length>6||new Set(ids).size!==ids.length)fail('참석자를 2~6명 선택해주세요.');
    const members=ids.map(id=>room.members.find(m=>m.id===id));if(members.some(m=>!m||!stopMap.has(m.stopId)))fail('참석자 전원의 출발지를 입력해주세요.');
    if(!['regular','casual'].includes(b.meetingType))fail('모임 유형을 확인해주세요.');if(b.targetMemberId&&!ids.includes(b.targetMemberId))fail('배려 대상은 이번 참석자 중 선택해주세요.');
    const recommendationPolicy=b.recommendationPolicy??'balance';if(!['balance','protect'].includes(recommendationPolicy))fail('추천 기준을 확인해주세요.');
    let previousRun=null;
    if(b.retryRunId){previousRun=room.runs[b.retryRunId];if(!previousRun||previousRun.revision!==room.revision||previousRun.payload.retryUsed||previousRun.payload.retryParentId||Date.now()-previousRun.payload.createdAt>3600000||JSON.stringify(previousRun.payload.memberIds)!==JSON.stringify(ids)||previousRun.payload.regular!==(b.meetingType==='regular')||(previousRun.payload.recommendationPolicy||'balance')!==recommendationPolicy)fail('이 분석에서는 재탐색할 수 없습니다. 새로 분석해주세요.',409);if(!previousRun.payload.retryPool?.length)fail('새로운 후보가 없습니다.',422);}
    const calculate=await engine(),payload=await calculate.analyze({recommendationPolicy,previous:previousRun?.payload,members:members.map(m=>({...m,stop_id:m.stopId})),stops,history:history(room),regular:b.meetingType==='regular',targetMemberId:b.targetMemberId||null});
    payload.runId=uid();payload.localDemo=true;payload.createdAt=Date.now();if(previousRun){previousRun.payload.retryUsed=true;room.runs[payload.runId]={payload,revision:room.revision};}else room.runs={[payload.runId]:{payload,revision:room.revision}};await save();const {retryPool,retryPlan,...visible}=payload;
    return new Response(JSON.stringify({type:'progress',done:1,total:1,message:'브라우저 자체 추정 완료'})+'\n'+JSON.stringify({type:'result',...visible})+'\n',{headers:{'Content-Type':'application/x-ndjson; charset=utf-8'}});
   }
   if(action==='confirm'&&method==='POST'){
    const old=room.history.find(m=>m.run_id===b.runId);if(old){if(old.candidate_id!==b.candidateId)fail('이미 다른 장소로 확정했어요.',409);return json({meetingId:old.id,duplicate:true});}
    const run=room.runs[b.runId];if(!run||run.revision!==room.revision||Date.now()-run.payload.createdAt>3600000)fail('참여자나 기록이 바뀌었어요. 다시 분석해주세요.',409);
    const payload=run.payload;if(!Object.values(payload.alternatives).includes(b.candidateId))fail('추천 대안 중에서 선택해주세요.');const c=payload.candidates.find(c=>c.candidate.id===b.candidateId);if(!c?.eligible||c.paths.some(p=>p.status!=='estimated'||!Number.isFinite(p.expectedMinutes)))fail('모든 참석자의 시간이 확인된 장소를 선택해주세요.');
    const meeting={id:uid(),room_id:id,run_id:b.runId,venue:c.candidate.name,regular:payload.regular?1:0,created_at:new Date().toISOString(),candidate_id:c.candidate.id,calculation_mode:'estimated',local_demo:true,records:c.paths.map(p=>({member_id:p.memberId,name:p.name,minutes:p.expectedMinutes,walk:p.walkMetres,transfers:p.transfers,relative:p.relative,originStopName:payload.origins.find(o=>o.memberId===p.memberId)?.stopName||null}))};room.history.push(meeting);room.revision++;await save();return json({meetingId:meeting.id,duplicate:false},201);
   }
   fail('브라우저 시연에서 지원하지 않는 요청입니다.',405);
  }
  return {request(path,options){const pending=queue.then(()=>globalThis.navigator?.locks?globalThis.navigator.locks.request('dt-sniper-browser-demo-state',()=>handle(path,options)):handle(path,options)).catch(error=>json({error:error.status?error.message:(error.message||'브라우저 저장·분석에 실패했어요.')},error.status||503));queue=pending.then(()=>undefined);return pending;}};
 }
 let instance;
 window.DTLocalDemo={create,request:(path,options)=>(instance||(instance=create())).request(path,options)};
})();
