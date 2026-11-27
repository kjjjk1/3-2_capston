(()=>{
 const renderOrigin='https://three-2-capston.onrender.com';
 const isPages=location.hostname.endsWith('.github.io'),routeApiAllowed=false,localDemo=true;
 const serverURL=path=>path;
 let localReady;
 function localAdapter(){if(window.DTLocalDemo)return Promise.resolve(window.DTLocalDemo);return localReady||(localReady=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=new URL('browser-demo.js',document.baseURI).href;script.onload=()=>window.DTLocalDemo?resolve(window.DTLocalDemo):reject(appError('브라우저 시연 파일을 확인해주세요.'));script.onerror=()=>{localReady=null;reject(appError('브라우저 시연 파일을 불러오지 못했어요. browser-demo.js를 같은 위치에 업로드해주세요.'));};document.head.append(script);}));}
 function unavailable(response){
  if(location.protocol==='file:')return '파일을 더블클릭하지 말고 GitHub Pages 또는 정적 웹 서버로 열어주세요.';
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
  if(localDemo&&url.startsWith('/api/'))return (await localAdapter()).request(url,options);
  throw appError('브라우저 버전은 내부 모임 요청만 처리합니다.',404);
 }
 async function requestJSON(url,options){return readJSON(await request(url,options));}
 window.DTApi={readJSON,requestJSON,request,serverURL,unavailable,isPages,routeApiAllowed,renderOrigin,localDemo};
})();
