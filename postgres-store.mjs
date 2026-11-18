import {readFileSync,readdirSync} from 'node:fs';
const statement=Symbol('postgres statement');
// Translate only parameter markers outside SQL strings, quoted identifiers and comments.
export function postgresSQL(sql){
 let out='',quote='',line=false,block=false,n=0;
 for(let i=0;i<sql.length;i++){const c=sql[i],next=sql[i+1];
  if(line){out+=c;if(c==='\n')line=false;continue;}
  if(block){out+=c;if(c==='*'&&next==='/'){out+=next;i++;block=false;}continue;}
  if(quote){out+=c;if(c===quote){if(next===quote){out+=next;i++;}else quote='';}continue;}
  if(c==='-'&&next==='-'){out+='--';i++;line=true;continue;}
  if(c==='/'&&next==='*'){out+='/*';i++;block=true;continue;}
  if(c==="'"||c==='"'){quote=c;out+=c;continue;}
  out+=c==='?'?'$'+(++n):c;
 }
 const ignore=/^\s*INSERT OR IGNORE INTO /i.test(out);
 if(ignore)out=out.replace(/INSERT OR IGNORE INTO /i,'INSERT INTO ').replace(/;?\s*$/,' ON CONFLICT DO NOTHING');
 return out;
}
function normalizeError(e){if(e.code==='23505'){const error=new Error('UNIQUE constraint failed');error.code=e.code;return error;}return e;}
export function postgresAdapter(pool){
 const execute=async(client,sql,args)=>{try{return await client.query(postgresSQL(sql),args);}catch(e){throw normalizeError(e);}};
 return {
  prepare(sql){const make=args=>({[statement]:{sql,args},bind(...values){return make(values);},async first(){return (await execute(pool,sql,args)).rows[0]||null;},async all(){return {results:(await execute(pool,sql,args)).rows};},async run(){const r=await execute(pool,sql,args);return {meta:{changes:r.rowCount??0}};}});return make([]);},
  async batch(items){const client=await pool.connect();try{await client.query('BEGIN');const results=[];for(const item of items){const s=item[statement];if(!s)throw Error('Invalid PostgreSQL statement');const r=await execute(client,s.sql,s.args);results.push({meta:{changes:r.rowCount??0}});}await client.query('COMMIT');return results;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}},
  close(){return pool.end();}
 };
}
export async function migratePostgres(pool){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(714061118)");
  await client.query('CREATE SCHEMA IF NOT EXISTS dt_sniper');
  await client.query('REVOKE ALL ON SCHEMA dt_sniper FROM PUBLIC');
  await client.query('SET LOCAL search_path TO dt_sniper,pg_catalog');
  await client.query('CREATE TABLE IF NOT EXISTS deployment_migrations(name TEXT PRIMARY KEY)');
  for(const name of readdirSync(new URL('./postgres/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort()){
   if((await client.query('SELECT name FROM deployment_migrations WHERE name=$1',[name])).rows.length)continue;
   await client.query(readFileSync(new URL('./postgres/'+name,import.meta.url),'utf8'));
   await client.query('INSERT INTO deployment_migrations(name) VALUES($1)',[name]);
  }
  await client.query('ALTER TABLE deployment_migrations ENABLE ROW LEVEL SECURITY');
  await client.query('REVOKE ALL ON ALL TABLES IN SCHEMA dt_sniper FROM PUBLIC');
  // Supabase roles exist only on hosted projects. Keep browser API roles out of this schema.
  for(const role of ['anon','authenticated'])if((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rows.length){await client.query(`REVOKE ALL ON SCHEMA dt_sniper FROM ${role}`);await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA dt_sniper FROM ${role}`);}
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export function connectionConfig(connectionString,{ca}={}){
 const url=new URL(connectionString);if(!['postgres:','postgresql:'].includes(url.protocol))throw Error('DATABASE_URL must be a PostgreSQL connection string');
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert','options'])url.searchParams.delete(key);
 return {connectionString:url.toString(),ssl:{rejectUnauthorized:true,...(ca?{ca:ca.replaceAll('\\n','\n')}:{})},max:3,connectionTimeoutMillis:15000,idleTimeoutMillis:30000,options:'-c search_path=dt_sniper,pg_catalog'};
}
export async function createPostgresDB(connectionString,options={}){
 const {Pool,types}=await import('pg');
 const pool=new Pool({...connectionConfig(connectionString,options),types:{getTypeParser(oid,format){if(oid===20)return value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw Error('Database integer outside safe range');return n;};return types.getTypeParser(oid,format);}}});
 pool.on('error',()=>console.error('Database connection interrupted'));
 try{await migratePostgres(pool);return postgresAdapter(pool);}catch(e){await pool.end();throw e;}
}
export function createPostgresBucket(DB){return {
 async put(key,bytes){await DB.prepare('INSERT INTO photo_objects(key,body) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').bind(key,Buffer.from(bytes)).run();},
 async get(key){const value=await DB.prepare('SELECT body FROM photo_objects WHERE key=?').bind(key).first();return value?{body:value.body}:null;},
 async delete(key){await DB.prepare('DELETE FROM photo_objects WHERE key=?').bind(key).run();}
};}

// Never log the raw error/message: it may contain credentials or SQL values.
export function databaseDiagnostic(error){
 const code=typeof error?.code==='string'&&/^[A-Z0-9_]{1,40}$/.test(error.code)?error.code:'UNKNOWN';
 const message=String(error?.message||'');
 let reason='Database connection or schema initialization failed; check the pooler URI, password and certificate.';
 if(['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID'].includes(code)||/certificate|self.signed/i.test(message))reason='TLS certificate verification failed. Set DATABASE_SSL_CA to the PEM root certificate from Supabase Database settings.';
 else if(code==='28P01'||/password authentication failed/i.test(message))reason='Database password authentication failed. Check the database password and URL encoding.';
 else if(/tenant or user not found/i.test(message))reason='Pooler user/project mismatch. Copy the exact Session pooler URI from Supabase Connect.';
 else if(code==='ENOTFOUND'||code==='EAI_AGAIN')reason='Database hostname could not be resolved. Check the full Session pooler hostname.';
 else if(['ETIMEDOUT','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'].includes(code)||/timeout/i.test(message))reason='Database network connection failed. Check project status, network restrictions and Session pooler port 5432.';
 else if(code==='42501')reason='Database role cannot initialize the private application schema. Use the project owner connection from Supabase Connect.';
 else if(code==='ERR_INVALID_URL'||/must be a PostgreSQL connection string/i.test(message))reason='DATABASE_URL is not a complete PostgreSQL URI. Copy the full postgresql:// connection string.';
 else if(/unsupported.*(?:options|startup)|invalid.*search_path/i.test(message))reason='Pooler rejected connection options. Confirm Session pooler mode on port 5432.';
 return {event:'database_startup_failed',code,reason};
}
