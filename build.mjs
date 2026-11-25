import {readFileSync,writeFileSync,mkdirSync,readdirSync,copyFileSync} from 'node:fs';
import vm from 'node:vm';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8').replace(/^\uFEFF/,'');
const root=new URL('./',import.meta.url), out=new URL('dist/',root);
mkdirSync(new URL('server/',out),{recursive:true});
const assets={};
for(const name of readdirSync(root).filter(n=>/\.(html|css|js)$/.test(n))){
 const type=name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript';
 assets[name==='index.html'?'/':'/'+name]={type:type+'; charset=utf-8',body:read(name)};
 copyFileSync(new URL(name,root),new URL(name,out));
}
for(const m of read('index.html').matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g))if(!/^https?:/.test(m[1])&&!assets['/'+m[1]])throw Error('Missing asset: '+m[1]);
const ctx={window:{}};vm.runInNewContext(read('stops_data.js'),ctx);
let source=read('worker/index.js').replace(/^import .*\r?\n/,'').replace('/*ASSETS*/ {}',()=>JSON.stringify(assets)).replace('/*STOP_IDS*/ []',()=>JSON.stringify(ctx.window.DT_SNIPER_STOPS.map(s=>s.id)));
source+='\n'+read('worker/addons.js')+'\n'+read('worker/auth.js');
for(const file of ['analysis/rail-data.mjs','analysis/core.mjs','analysis/fairness.mjs','analysis/accuracy.mjs','analysis/odsay.mjs','analysis/kakao-transit.mjs','analysis/provider-plan.mjs','analysis/improvement.mjs','analysis/manual.mjs','analysis/local-estimate.mjs','analysis/weighted-centre.mjs','analysis/correction-centres.mjs','analysis/shortlist.mjs','analysis/protective-search.mjs','analysis/method-b.mjs','analysis/recommendation-policy.mjs'])source+='\n'+read(file).replace(/^import .*$/gm,'').replace(/^export /gm,'');
source+='\n'+read('worker/performance.js').replace(/^export /gm,'');
source+='\n'+read('worker/final.js').replace('/*FINAL_STOPS*/ []',()=>JSON.stringify(ctx.window.DT_SNIPER_STOPS));
writeFileSync(new URL('server/index.js',out),source);
console.log('Built DT Sniper Final: '+ctx.window.DT_SNIPER_STOPS.length+' stops');
