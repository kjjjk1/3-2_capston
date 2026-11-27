(()=>{
 if(!window.DTApi?.localDemo)return;
 const host=document.querySelector('#page-find');if(!host)return;
 const section=document.createElement('section');section.className='card browser-data-tools';section.innerHTML=`<h2>이 브라우저의 모임과 기록</h2><p class="subtle">기록은 이 브라우저에만 저장됩니다. 다른 기기로 옮기거나 사이트 데이터를 지우기 전 백업을 내려받으세요. 백업에는 참여자 이름과 출발지가 포함되며, 접속 토큰은 포함하지 않습니다.</p><div class="browser-data-actions"><button type="button" class="quiet" id="browserExport">기록 백업 내려받기</button><label class="quiet room-file-label">백업 파일 가져오기<input type="file" id="browserImport" accept="application/json,.json" hidden></label></div><div id="browserSavedRooms"></div><details><summary>서버 종료 전 기존 모임 가져오기</summary><p class="subtle">Render가 켜져 있을 때 한 번 가져올 수 있습니다. 아래 버튼을 누를 때만 서버의 참여자·기록을 조회하며 경로 API는 호출하지 않습니다. 사진과 서버 접근 권한은 복사하지 않습니다.</p><label>기존 모임 링크 또는 방 ID<input id="serverRoomImportId" maxlength="2048" placeholder="기존 모임의 링크 또는 방 ID"></label><button type="button" class="quiet" id="serverRoomImport">서버 기록을 이 브라우저로 가져오기</button></details><p id="browserDataStatus" role="status" aria-live="polite"></p>`;host.append(section);
 const status=section.querySelector('#browserDataStatus'),buttons=()=>section.querySelectorAll('button,input');
 const say=text=>status.textContent=text;
 const api=(path,method='GET',data)=>window.DTApi.requestJSON('/api'+path,{method,headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});
 async function work(fn){buttons().forEach(e=>e.disabled=true);try{await fn();}catch(e){say(e.message||'기록 처리에 실패했습니다.');}finally{buttons().forEach(e=>e.disabled=false);}}
 async function list(){const {ids}=await api('/account/rooms'),root=section.querySelector('#browserSavedRooms');root.replaceChildren();for(const id of ids){const r=await api('/rooms/'+id),a=document.createElement('a'),url=new URL(location.href);url.search='';url.searchParams.set('room',id);a.href=url.href;a.textContent=r.title;a.className='recent-room-link';root.append(a);}}
 async function install(data){const r=await api('/browser/import','POST',data);try{const owners=JSON.parse(localStorage.getItem('dt-sniper-room-owners-v1')||'{}');for(const room of r.rooms)owners[room.id]=room.ownerToken;localStorage.setItem('dt-sniper-room-owners-v1',JSON.stringify(owners));}catch{}await list();say(r.imported+'개 모임을 가져왔습니다. 위 목록에서 모임을 열어주세요. 기존 기록은 덮어쓰지 않았습니다.');}
 section.querySelector('#browserExport').onclick=()=>work(async()=>{const data=await api('/browser/backup'),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='DT-Sniper-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);say(data.rooms.length+'개 모임의 백업을 내려받았습니다. 파일을 안전한 곳에 보관해주세요.');});
 section.querySelector('#browserImport').onchange=event=>work(async()=>{const file=event.target.files?.[0];if(!file)return;if(file.size>20*1024*1024)throw Error('20MB 이하의 백업 파일을 선택해주세요.');let data;try{data=JSON.parse(await file.text());}catch{throw Error('JSON 백업 파일을 확인해주세요.');}await install(data);event.target.value='';});
 section.querySelector('#serverRoomImport').onclick=()=>work(async()=>{const value=section.querySelector('#serverRoomImportId').value.trim();let id=value;try{id=new URL(value).searchParams.get('room')||value;}catch{}if(!/^[a-f0-9-]{36}$/.test(id))throw Error('모임 링크 또는 방 ID를 확인해주세요.');
  const read=async suffix=>{const response=await fetch(window.DTApi.renderOrigin+'/api/rooms/'+id+suffix,{credentials:'omit',signal:AbortSignal.timeout(30000)});return window.DTApi.readJSON(response);};
  say('서버의 참여자와 기록을 읽고 있습니다…');const [r,h]=await Promise.all([read(''),read('/history')]);
  if(r.members.some(m=>m.ready&&!m.editableStopId&&!(r.me?.id===m.id&&r.me.stopId)))throw Error('서버가 출발지를 제공하지 않아 가져올 수 없습니다. 서버를 종료하기 전에 출발지 조회 권한을 확인해주세요.');
  await install({format:'dt-sniper-browser-backup',version:1,rooms:[{id:r.id,title:r.title,members:r.members.map(m=>({id:m.id,name:m.name,stopId:m.editableStopId||(r.me?.id===m.id?r.me.stopId:'')})),history:h.meetings}]});
 });
 navigator.storage?.persist?.().catch(()=>{});list().catch(e=>say(e.message));
 window.addEventListener('dt-history-changed',()=>list().catch(()=>{}));
 window.addEventListener('dt-room-rendered',()=>list().catch(()=>{}));
})();
