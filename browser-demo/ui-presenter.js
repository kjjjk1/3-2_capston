(()=>{
 const minute=n=>Number.isFinite(n)?String(Math.round(n)):'—';
 const burden=n=>!Number.isFinite(n)?'확인 중':Math.round(Math.abs(n))===0?'평균과 비슷하게 이동':`평균보다 ${minute(Math.abs(n))}분 ${n>0?'더':'덜'} 이동`;
 const states={
 improved:['개선','good','이전보다 이동 부담 차이가 줄어요','이번 장소를 선택하면 참여자 간 누적 이동 부담 차이가 줄어들어요.'],
 maintained:['유지','neutral','이전과 비슷하게 유지돼요','이번 장소에서는 누적 이동 부담의 차이가 유지돼요.'],
 worsened:['주의','warn','이전보다 이동 부담 차이가 커져요','이번 장소를 선택하면 참여자 간 누적 이동 부담 차이가 이전보다 커져요.'],
 balanced_start:['주의','warn','고르게 시작했던 부담에 차이가 생겨요','이전 부담은 균등했어요. 이번 장소를 선택하면 누적 이동 부담에 차이가 생겨요.'],
 first_meeting:['첫 모임','neutral','첫 이동 기록을 만들어요','이전 정기 모임 기록이 없어 이번 이동시간의 균형을 비교해요.'],
 casual:['일회성','neutral','이번 이동시간만 비교해요','일회성 모임은 지난 기록을 반영하지 않고, 정기 모임 누적에도 더하지 않아요.'],
 unverified:['확인 필요','neutral','아직 모든 경로를 확인하지 못했어요','일부 경로를 확인하지 못해 전체 평균과 공정성을 판단할 수 없어요.']};
 const fairness=f=>{const v=states[f?.status]||states.unverified;return {badge:v[0],tone:v[1],title:v[2],description:v[3]};};
 const shortPlaceName=value=>{const chars=Array.from(String(value??''));return chars.length>=5?chars.slice(0,5).join('')+'...':chars.join('');};
 const timeExtremes=paths=>{const times=paths.filter(p=>['verified','estimated'].includes(p.status)&&Number.isFinite(p.expectedMinutes)).map(p=>p.expectedMinutes);const min=Math.min(...times),max=Math.max(...times);return paths.map(p=>!['verified','estimated'].includes(p.status)||!Number.isFinite(p.expectedMinutes)||times.length<2||max===min?'':p.expectedMinutes===max?'longest':p.expectedMinutes===min?'shortest':'');};
 window.DTUI={minute,burden,fairness,shortPlaceName,timeExtremes};
})();
