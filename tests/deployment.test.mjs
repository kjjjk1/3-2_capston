import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('production server serves UI, rejects unknown hosts and persists rooms across restarts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dt-deploy-'));
 const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const env={...process.env,DATABASE_URL:'',REQUIRE_REMOTE_DB:'false',NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),PUBLIC_ORIGIN:'https://demo.example',DTS_DATA_DIR:dir};
 for(const k of Object.keys(env))if(/KEY|SECRET/.test(k))delete env[k];
 let child;
 const start=async()=>{child=spawn(process.execPath,['server.mjs'],{env,stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Startup timeout')),15000);child.stdout.on('data',chunk=>{if(String(chunk).includes('DT Sniper Final:')){clearTimeout(timer);resolve();}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Unexpected server exit '+code));});});};
 const stop=async()=>{if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}};
 const call=(path,options={})=>fetch(`http://127.0.0.1:${port}${path}`,options);
 try{
  await start();
  assert.equal((await call('/')).status,200);
  const pagesOrigin='https://kjjjk1.github.io';
  const preflight=await call('/api/rooms',{method:'OPTIONS',headers:{Origin:pagesOrigin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,authorization,x-room-owner-token'}});
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),pagesOrigin);
  const pagesConfig=await call('/api/config',{headers:{Origin:pagesOrigin}});assert.equal(pagesConfig.headers.get('access-control-allow-origin'),pagesOrigin);assert.equal((await pagesConfig.json()).routeApiAllowed,false);
  assert.equal((await call('/api/config',{headers:{Origin:'https://attacker.test'}})).status,403);
  const config=await call('/api/config');assert.equal(config.status,200);const value=await config.json();assert.equal(value.networkReady,true);
  const health=await call('/healthz');assert.deepEqual(await health.json(),{status:'ok'});
  const hostStatus=await new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port,path:'/healthz',headers:{Host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(hostStatus,403);
  assert.equal((await call('/.env')).status,404);
  const box={window:{}};vm.runInNewContext(readFileSync('stops_data.js','utf8'),box);
  const created=await call('/api/rooms',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://demo.example'},body:JSON.stringify({title:'Deployment test',name:'A',stopId:box.window.DT_SNIPER_STOPS[0].id})});
  assert.equal(created.status,201);const room=(await created.json()).room;
  await stop();await start();
  const afterConfig=await (await call('/api/config')).json();assert.equal(afterConfig.networkImportedAt,value.networkImportedAt);
  const stored=await call('/api/rooms/'+room.id);assert.equal(stored.status,200);assert.equal((await stored.json()).title,'Deployment test');
 }finally{await stop();await rm(dir,{recursive:true,force:true});}
});
