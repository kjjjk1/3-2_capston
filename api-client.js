(()=>{
 function unavailable(response){
  if(location.protocol==='file:')return '이 파일을 직접 열면 모임 서버에 연결할 수 없어요. Render 본 앱이나 start-local.cmd로 실행해주세요.';
  if(location.hostname.endsWith('.github.io')&&!window.DT_STATIC_DEMO)return '현재 GitHub Pages 주소에서는 모임 서버를 실행할 수 없어요. Render 본 앱 주소로 접속해주세요.';
  if([502,503,504].includes(response?.status))return '모임 서버가 중지되었거나 시작 중이에요. Render 서비스 상태를 확인하고 잠시 후 다시 시도해주세요.';
  return '모임 서버에서 올바른 응답을 받지 못했어요. 접속 주소와 서버 상태를 확인해주세요.';
 }
 const appError=(message,status=503)=>Object.assign(new Error(message),{status,apiError:true});
 async function readJSON(response){
  let value;try{const text=await response.text();value=JSON.parse(text);if(!value||typeof value!=='object')throw Error();}catch{throw appError(unavailable(response),response.status||503);}
  if(!response.ok)throw appError(typeof value.error==='string'?value.error:'요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.',response.status);
  return value;
 }
 async function requestJSON(url,options){
  if(location.protocol==='file:'||(location.hostname.endsWith('.github.io')&&!window.DT_STATIC_DEMO))throw appError(unavailable());
  try{return await readJSON(await fetch(url,options));}catch(e){if(e.apiError)throw e;throw appError('모임 서버에 연결하지 못했어요. 인터넷 연결과 Render 서비스 상태를 확인해주세요.');}
 }
 window.DTApi={readJSON,requestJSON,unavailable};
})();
