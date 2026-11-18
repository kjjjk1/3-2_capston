import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateNetwork} from './analysis/method-b.mjs';
export async function seedNetwork(DB){
 if(await DB.prepare('SELECT id FROM transit_network WHERE id=1').first())return false;
 const network=JSON.parse(readFileSync(new URL('./data/transit-network.json',import.meta.url),'utf8').replace(/^\uFEFF/,''));
 const box={window:{}};vm.runInNewContext(readFileSync(new URL('./stops_data.js',import.meta.url),'utf8'),box);
 validateNetwork(network,box.window.DT_SNIPER_STOPS);
 await DB.prepare('INSERT INTO transit_network(id,payload,imported_at) VALUES(1,?,?)').bind(JSON.stringify(network),new Date().toISOString()).run();
 return true;
}
