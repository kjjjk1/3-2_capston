import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync,mkdirSync,writeFileSync,existsSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
export function createDB(file=':memory:'){
 const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY)');
 for(const name of readdirSync(new URL('drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()){
  if(db.prepare('SELECT name FROM schema_migrations WHERE name=?').get(name))continue;
  db.exec('BEGIN');try{db.exec(readFileSync(new URL('drizzle/'+name,import.meta.url),'utf8'));db.prepare('INSERT INTO schema_migrations VALUES(?)').run(name);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {prepare(sql){const make=args=>({bind(...next){return make(next);},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},execute(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};},async run(){return this.execute();}});return make([]);},async batch(items){db.exec('BEGIN');try{const out=items.map(x=>x.execute());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}},close(){db.close();}};
}
export function createBucket(dir){mkdirSync(dir,{recursive:true});const file=key=>join(dir,Buffer.from(key).toString('hex'));return {async put(key,bytes){writeFileSync(file(key),bytes);},async get(key){return existsSync(file(key))?{body:readFileSync(file(key))}:null;},async delete(key){if(existsSync(file(key)))unlinkSync(file(key));}};}
