import {readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {createDB} from '../local-store.mjs';
import {validateNetwork} from '../analysis/method-b.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const path=process.argv[2]?resolve(process.argv[2]):resolve(root,'data/transit-network.json');
const network=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const ctx={window:{}};vm.runInNewContext(readFileSync(resolve(root,'stops_data.js'),'utf8'),ctx);
validateNetwork(network,ctx.window.DT_SNIPER_STOPS);
mkdirSync(resolve(root,'data'),{recursive:true});const db=createDB(resolve(root,'data/dt-sniper-final.sqlite'));
try{await db.prepare('INSERT INTO transit_network(id,payload,imported_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,imported_at=excluded.imported_at').bind(JSON.stringify(network),new Date().toISOString()).run();console.log('Imported '+network.routes.length+' directed route segments. Existing meeting history preserved.');}finally{db.close();}
