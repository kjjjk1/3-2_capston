/* Sharing prepares text locally. Nothing is sent before the user chooses Share. */
(()=>{
 const rounded=n=>Number.isFinite(n)?String(Math.round(n)):'확인 안됨';
 function directions(origin,dest){if(!origin||![origin.lat,origin.lon,dest.lat,dest.lon].every(Number.isFinite))return '';return 'https://map.kakao.com/link/by/traffic/'+encodeURIComponent(origin.stopName||origin.name)+','+origin.lat+','+origin.lon+'/'+encodeURIComponent(dest.name)+','+dest.lat+','+dest.lon;}
 function text(snapshot,candidate,memberId=null){
  const paths=candidate.paths.filter(p=>!memberId||p.memberId===memberId);if(!paths.length)throw Error('공유할 참여자 경로가 없습니다.');
  const estimated=snapshot.calculationMode==='estimated';
  const parts=['DT Sniper 모임 경로 안내','모임 장소: '+candidate.candidate.name,estimated?'자체 추정 · API 미검증':'API 예상시간 · 실제 탑승시간을 측정한 값이 아닙니다.'];
  for(const p of paths){const origin=snapshot.origins?.find(o=>o.memberId===p.memberId);parts.push('',p.name,'출발: '+(origin?.stopName||'출발 정류장 확인 필요'),'도착: '+candidate.candidate.name,'예상 '+rounded(p.expectedMinutes)+'분 / 도보 '+rounded(p.walkMetres)+'m / 환승 '+rounded(p.transfers)+'회');
   if(!estimated&&p.status==='verified'&&p.segments?.length)for(const segment of p.segments)parts.push((segment.lines||[]).join(' / ')+' '+(segment.from||'')+' → '+(segment.to||''));
   else parts.push(estimated?'상세 노선은 검증되지 않았습니다.':'상세 노선 정보가 제공되지 않았습니다.');
   const url=directions(origin,candidate.candidate);if(url)parts.push('대중교통 길찾기: '+url);
  }
  parts.push('','지도 앱의 경로와 예상시간은 조회 시점에 따라 달라질 수 있습니다.');return parts.join('\n');
 }
 function open({snapshot,candidate,memberId=null}){
  const content=text(snapshot,candidate,memberId),dialog=document.createElement('dialog');dialog.className='route-share-dialog';dialog.setAttribute('aria-label','경로 공유 내용 확인');
  const heading=document.createElement('h2');heading.textContent=memberId?'개인 경로 공유':'전체 경로 공유';
  const notice=document.createElement('p');notice.textContent='참여자 이름과 출발지가 포함됩니다. 내용을 확인한 뒤 공유하세요. 휴대폰 공유창에 카카오톡이 있으면 선택할 수 있습니다.';
  const preview=document.createElement('textarea');preview.readOnly=true;preview.value=content;preview.rows=13;preview.setAttribute('aria-label','공유할 경로 안내');
  const actions=document.createElement('div');actions.className='route-share-actions';const share=document.createElement('button'),copy=document.createElement('button'),close=document.createElement('button'),status=document.createElement('p');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');share.type=copy.type=close.type='button';share.className='primary';copy.className=close.className='quiet';share.textContent='공유하기 ↗';copy.textContent='내용 복사';close.textContent='닫기';
  const copyText=async()=>{try{await navigator.clipboard.writeText(content);status.textContent='공유 내용을 복사했어요. 카카오톡 등에 붙여넣으세요.';}catch{preview.focus();preview.select();status.textContent='공유 내용을 선택했어요. 직접 복사해주세요.';}};
  copy.onclick=copyText;share.onclick=async()=>{if(!navigator.share){await copyText();return;}try{await navigator.share({title:'DT Sniper · '+candidate.candidate.name,text:content});status.textContent='공유창 처리를 완료했어요.';}catch(error){if(error.name!=='AbortError'){status.textContent='공유창을 열지 못했어요. 내용 복사를 이용해주세요.';}}};
  close.onclick=()=>dialog.close();dialog.addEventListener('close',()=>dialog.remove(),{once:true});actions.append(share,copy,close);dialog.append(heading,notice,preview,actions,status);document.body.append(dialog);dialog.showModal();
 }
 window.DTRouteShare={text,directions,open};
})();
