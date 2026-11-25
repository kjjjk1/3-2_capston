import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAnalysisTimer} from '../worker/performance.js';
import {createDB} from '../local-store.mjs';

test('timing separates stages, includes failed API requests, and does not change returned values',async()=>{
 let clock=0;const timer=createAnalysisTimer(()=>clock);
 assert.equal(await timer.measure('db',async()=>{clock+=7;return 42;}),42);
 assert.equal(timer.sync('candidate',()=>{clock+=11;return 'candidate';}),'candidate');
 await assert.rejects(timer.measure('api',async()=>{clock+=15;throw Error('timeout');},{candidateIndex:1,memberIndex:2}),/timeout/);
 await timer.measure('api',async()=>{clock+=5;return 'route';},{candidateIndex:1,memberIndex:3});
 clock+=3;const p=timer.snapshot();assert.equal(p.totalMs,41);assert.equal(p.dbMs,7);assert.equal(p.candidateMs,11);assert.equal(p.apiMs,20);assert.equal(p.apiAverageMs,10);assert.equal(p.apiMaxMs,15);assert.equal(p.otherMs,3);assert.equal(p.apiRequests,2);assert.deepEqual(p.requests.map(r=>r.ok),[false,true]);
 assert.deepEqual(Object.keys(p.requests[0]).sort(),['candidateIndex','durationMs','memberIndex','ok'].sort());
});

test('timed DB preserves binding, query results, batch rollback, and the underlying database',async()=>{
 const original=createDB(),timer=createAnalysisTimer(),db=timer.database(original);
 try{
  await db.prepare('INSERT INTO rooms(id,title,mode,created_at) VALUES(?,?,?,?)').bind('r','before','통합','today').run();
  await db.batch([db.prepare('UPDATE rooms SET title=? WHERE id=?').bind('after','r')]);
  assert.equal((await db.prepare('SELECT title FROM rooms WHERE id=?').bind('r').first()).title,'after');
  await assert.rejects(db.batch([db.prepare('UPDATE rooms SET title=? WHERE id=?').bind('bad','r'),db.prepare('INSERT INTO rooms(id,title,mode,created_at) VALUES(?,?,?,?)').bind('r','duplicate','통합','today')]));
  assert.equal((await original.prepare('SELECT title FROM rooms WHERE id=?').bind('r').first()).title,'after');assert.equal(timer.snapshot().dbOperations,4);
 }finally{original.close();}
});
