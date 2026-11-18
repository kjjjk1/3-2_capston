import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';import {readFileSync} from 'node:fs';
import {createDB} from '../local-store.mjs';
import {seedNetwork} from '../server-network.mjs';
import worker from '../dist/server/index.js';
const box={window:{}};vm.runInNewContext(readFileSync('demo-room.js','utf8'),box);const example=box.window.DTExample;

test('example link prepares four real campus stops, reuses its own room and analyzes without route API',async t=>{
 const DB=createDB();t.after(()=>DB.close());await seedNetwork(DB);
 let apiCalls=0;const env={DB,FETCH:async()=>{apiCalls++;throw Error('No route API permitted');}};
 const request=async(path,{method='GET',data,headers={}}={})=>{const response=await worker.fetch(new Request('https://demo.test/api'+path,{method,headers:{...headers,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined}),env);const raw=await response.text();const value=response.headers.get('content-type')?.includes('ndjson')?raw.trim().split('\n').map(JSON.parse).at(-1):JSON.parse(raw);if(!response.ok)throw Object.assign(Error(value.error),{status:response.status});return value;};
 let saved;const prepared=await example.prepare({request,onCreated:c=>saved=c});assert.equal(prepared.room.members.length,4);assert.ok(prepared.room.members.every(m=>m.ready));
 const records=(await DB.prepare('SELECT name,stop_id FROM room_members WHERE room_id=? ORDER BY slot').bind(prepared.roomId).all()).results;
 assert.deepEqual(records.map(r=>({...r})),Array.from(example.participants,p=>({name:p.name,stop_id:p.stopId})));
 const again=await example.prepare({request,cached:saved,onCreated:()=>assert.fail('Room must be reused')});assert.equal(again.roomId,prepared.roomId);assert.equal(again.room.members.length,4);
 const result=await request('/rooms/'+prepared.roomId+'/analysis',{method:'POST',headers:{'X-Room-Owner-Token':prepared.ownerToken},data:{memberIds:prepared.room.members.map(m=>m.id),meetingType:'regular',provider:'kakao',useApi:false}});
 assert.equal(result.status,'estimated');assert.ok(result.alternatives.fairnessId);assert.equal(result.calls,0);assert.equal(apiCalls,0);assert.equal((await DB.prepare('SELECT COUNT(*) n FROM meeting_history').first()).n,0);
 const other=await example.prepare({request,onCreated:()=>{}});assert.notEqual(other.roomId,prepared.roomId);assert.equal(other.room.members.length,4);
});

test('temporary server failures do not silently create another example room',async()=>{
 let writes=0;await assert.rejects(example.prepare({cached:{roomId:'00000000-0000-0000-0000-000000000000',ownerToken:'private'},onCreated:()=>{},request:async(path,options={})=>{if(options.method==='POST')writes++;throw Object.assign(Error('Unavailable'),{status:503});}}),/Unavailable/);assert.equal(writes,0);
});
