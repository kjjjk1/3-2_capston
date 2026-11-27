(()=>{
 const validId=s=>typeof s==='string'&&/^[a-f0-9-]{36}$/.test(s);
 const error=message=>{throw Object.assign(Error(message),{status:400});};
 const str=(v,n)=>typeof v==='string'&&v.length<=n?v:error('백업의 문자열 형식이 잘못되었습니다.');
 const number=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:error('백업의 숫자 범위를 확인해주세요.');
 function normalize(data,stops){
  if(!data||data.format!=='dt-sniper-browser-backup'||data.version!==1||!Array.isArray(data.rooms)||data.rooms.length>100)error('지원하는 DT Sniper 백업 파일이 아닙니다.');
  const stopIds=new Set(stops.map(s=>s.id)),roomIds=new Set();
  const rooms=data.rooms.map(r=>{
   if(!validId(r.id)||roomIds.has(r.id)||!Array.isArray(r.members)||r.members.length>100||!Array.isArray(r.history)||r.history.length>2000)error('모임 ID 또는 목록을 확인해주세요.');roomIds.add(r.id);
   const memberIds=new Set(),meetingIds=new Set();
   const members=r.members.map(m=>{if(!validId(m.id)||memberIds.has(m.id)||(m.stopId&&!stopIds.has(m.stopId)))error('참여자 ID 또는 정류장을 확인해주세요.');memberIds.add(m.id);const name=str(m.name,20).trim();if(!name)error('참여자 이름이 비어 있습니다.');return {id:m.id,name,stopId:m.stopId||'',managed:m.stopId?2:1,token:crypto.randomUUID()+crypto.randomUUID()};});
   const history=r.history.map(h=>{
    if(!validId(h.id)||meetingIds.has(h.id)||!Array.isArray(h.records)||h.records.length>100||![0,1].includes(h.regular)||!Number.isFinite(Date.parse(h.created_at))||!['estimated','api'].includes(h.calculation_mode))error('이동 기록 형식을 확인해주세요.');meetingIds.add(h.id);
    const seen=new Set(),records=h.records.map(p=>{if(!validId(p.member_id)||seen.has(p.member_id))error('기록의 참여자 ID를 확인해주세요.');seen.add(p.member_id);return {member_id:p.member_id,name:str(p.name,20),minutes:number(p.minutes,0,10000),walk:number(p.walk,0,1000000),transfers:number(p.transfers,0,100),relative:number(p.relative,-10000,10000),originStopName:p.originStopName?str(p.originStopName,150):null};});
    return {id:h.id,room_id:r.id,run_id:validId(h.run_id)?h.run_id:crypto.randomUUID(),venue:str(h.venue,150),regular:h.regular,created_at:h.created_at,candidate_id:str(h.candidate_id||'',100),calculation_mode:h.calculation_mode,local_demo:true,records};
   });
   const photo=r.photo||null;if(photo&&(!/^data:image\/jpeg;base64,/.test(photo)||photo.length>300000))error('백업의 사진 형식을 확인해주세요.');
   return {id:r.id,title:str(r.title,60),mode:'통합',ownerToken:crypto.randomUUID()+crypto.randomUUID(),photo,members,history,runs:{},revision:0};
  });return rooms;
 }
 function exportState(state){return {format:'dt-sniper-browser-backup',version:1,createdAt:new Date().toISOString(),rooms:Object.values(state.rooms).map(r=>({id:r.id,title:r.title,photo:r.photo||null,members:r.members.map(m=>({id:m.id,name:m.name,stopId:m.stopId})),history:r.history}))};}
 window.DTBrowserBackup={normalize,exportState};
})();
