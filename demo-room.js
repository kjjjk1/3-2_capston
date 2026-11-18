(()=>{
 const participants=Object.freeze([
  {name:'홍길동',stopId:'DJB8002921'},
  {name:'김철수',stopId:'DJB8002722'},
  {name:'이영희',stopId:'DJB8001379'},
  {name:'박민수',stopId:'DJB8002903'}
 ].map(Object.freeze));
 async function prepare({request,cached,onCreated}){
  let room=null,roomId='',ownerToken='';
  if(cached?.roomId&&cached?.ownerToken&&/^[a-f0-9-]{36}$/.test(cached.roomId)){
   roomId=cached.roomId;ownerToken=cached.ownerToken;
   try{room=await request('/rooms/'+roomId,{headers:{'X-Room-Owner-Token':ownerToken}});if(!room.isOwner){room=null;roomId='';ownerToken='';}}catch(e){if(![401,403,404].includes(e.status))throw e;room=null;roomId='';ownerToken='';}
  }
  if(!room){const created=await request('/rooms',{method:'POST',data:{title:'4명 예시 체험 모임',mode:'통합'}});room=created.room;roomId=room.id;ownerToken=created.ownerToken;onCreated({roomId,ownerToken});}
  for(const person of participants){
   const existing=room.members.find(m=>m.name===person.name);
   if(existing)continue;
   room=await request('/rooms/'+roomId+'/participants',{method:'POST',data:person,headers:{'X-Room-Owner-Token':ownerToken}});
  }
  return {room,roomId,ownerToken};
 }
 window.DTExample={participants,prepare};
})();
