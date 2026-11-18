import {spawn} from 'node:child_process';
import http from 'node:http';
import {mkdirSync,existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createDB,createBucket} from './local-store.mjs';
import {createPostgresDB,createPostgresBucket,databaseDiagnostic} from './postgres-store.mjs';
import {seedNetwork} from './server-network.mjs';
import worker from './dist/server/index.js';
process.chdir(fileURLToPath(new URL('./',import.meta.url)));
if(process.env.NODE_ENV!=='production'&&existsSync('.env'))for(const line of readFileSync('.env','utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
if(process.env.REQUIRE_REMOTE_DB==='true'&&!process.env.DATABASE_URL)throw Error('Set DATABASE_URL in the hosting environment');
let DB,BUCKET;
try{if(process.env.DATABASE_URL){DB=await createPostgresDB(process.env.DATABASE_URL,{ca:process.env.DATABASE_SSL_CA});BUCKET=createPostgresBucket(DB);}else{const dataDirectory=process.env.DTS_DATA_DIR||'data';mkdirSync(dataDirectory,{recursive:true});DB=createDB(join(dataDirectory,'dt-sniper-final.sqlite'));BUCKET=createBucket(join(dataDirectory,'photos'));}}catch(error){console.error(JSON.stringify(databaseDiagnostic(error)));process.exit(1);}
await seedNetwork(DB);
const env={DB,BUCKET,...Object.fromEntries(['ODSAY_API_KEY','KAKAO_LOCAL_REST_API_KEY','NAVER_MAP_CLIENT_ID','ODSAY_DAILY_LIMIT','KAKAO_TRANSIT_REST_API_KEY','KAKAO_TRANSIT_DAILY_LIMIT','SHORTLIST_COUNT','KAKAO_REST_API_KEY','KAKAO_CLIENT_SECRET'].map(k=>[k,process.env[k]]))};
const port=Number(process.env.PORT)||5197;
const host=process.env.HOST||'127.0.0.1';
const originValue=process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL;
const publicOrigin=originValue?new URL(originValue):null;
if(process.env.NODE_ENV==='production'&&!publicOrigin)throw Error('Set PUBLIC_ORIGIN to the public HTTPS origin');
if(publicOrigin&&(publicOrigin.protocol!=='https:'||publicOrigin.username||publicOrigin.password||publicOrigin.pathname!=='/'||publicOrigin.search||publicOrigin.hash))throw Error('PUBLIC_ORIGIN must be an HTTPS origin');

const server=http.createServer(async(req,res)=>{try{
 if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`&&req.headers.host!==publicOrigin?.host){res.writeHead(403);res.end('Invalid host');return;}
 if(req.url==='/healthz'&&['GET','HEAD'].includes(req.method)){await DB.prepare('SELECT 1 AS ok').first();res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify({status:'ok'}));return;}
 const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>350000){res.writeHead(413);res.end('Too large');return;}chunks.push(chunk);}
 const request=new Request((publicOrigin?.origin||'http://'+req.headers.host)+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
 const response=await worker.fetch(request,env);const headers=Object.fromEntries(response.headers);const cookies=response.headers.getSetCookie();if(cookies.length)headers['set-cookie']=cookies;
 res.writeHead(response.status,headers);if(response.body){for await(const chunk of response.body)res.write(Buffer.from(chunk));}res.end();
}catch{if(!res.headersSent)res.writeHead(500);res.end('Local server error');}});
server.listen(port,host,()=>{
 const localUrl='http://127.0.0.1:'+port;
 console.log('DT Sniper Final: '+(publicOrigin?.origin||localUrl));
 if(process.argv.includes('--open-browser')){
  const browser=spawn('explorer.exe',[localUrl],{windowsHide:true,stdio:'ignore'});
  browser.on('error',()=>console.log('Open this address in your browser: '+localUrl));
  browser.unref();
 }
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(async()=>{await DB.close();process.exit(0);}));
