(()=>{
 const renderOrigin='https://three-2-capston.onrender.com';
 const isPages=location.hostname.endsWith('.github.io'),routeApiAllowed=!isPages;
 const serverURL=path=>isPages&&path.startsWith('/api/')?renderOrigin+path:path;
 function unavailable(response){
  if(location.protocol==='file:')return '이 파일을 직접 열면 모임 서버에 연결할 수 없어요. Render 본 앱이나 start-local.cmd로 실행해주세요.';
  if([502,503,504].includes(response?.status))return '모임 서버가 중지되었거나 시작 중이에요. Render 서비스 상태를 확인하고 잠시 후 다시 시도해주세요.';
  return '모임 서버에서 올바른 응답을 받지 못했어요. 접속 주소와 서버 상태를 확인해주세요.';
 }
 const appError=(message,status=503)=>Object.assign(new Error(message),{status,apiError:true});
 async function readJSON(response){
  let value;try{const text=await response.text();value=JSON.parse(text);if(!value||typeof value!=='object')throw Error();}catch{throw appError(unavailable(response),response.status||503);}
  if(!response.ok)throw appError(typeof value.error==='string'?value.error:'요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.',response.status);
  return value;
 }
 async function request(url,options={}){
  if(location.protocol==='file:')throw appError(unavailable());
  try{return await fetch(serverURL(url),{...options,credentials:isPages?'omit':'same-origin'});}catch{throw appError('모임 서버에 연결하지 못했어요. GitHub Pages에서도 DB 저장·조회에는 Render 서버 연결이 필요해요. 잠시 후 다시 시도해주세요.');}
 }
 async function requestJSON(url,options){return readJSON(await request(url,options));}
 window.DTApi={readJSON,requestJSON,request,serverURL,unavailable,isPages,routeApiAllowed,renderOrigin};
})();
