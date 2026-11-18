import {readFileSync,writeFileSync} from 'node:fs';
const files=process.argv.slice(2);if(files.length<3)throw Error('Usage: node scripts/merge-network.mjs output.json source1.json source2.json');
const [output,...inputs]=files,networks=inputs.map(p=>JSON.parse(readFileSync(p,'utf8').replace(/^\uFEFF/,'')));
const keys=new Set(),routes=[];for(const network of networks){if(!network.source||!Array.isArray(network.routes)||!network.routes.length)throw Error('Empty or unlabelled source');for(const r of network.routes){const key=JSON.stringify([r.id,r.direction,r.segment??0]);if(keys.has(key))throw Error('Duplicate route namespace. Resolve overlap before merge.');keys.add(key);routes.push(r);}}
writeFileSync(output,JSON.stringify({source:networks.map(n=>n.source).join(' + '),updatedAt:new Date().toISOString(),sourceSnapshots:networks.map(n=>({source:n.source,updatedAt:n.updatedAt})),routes},null,2));
console.log('Merged '+routes.length+' segments. Import into SQLite after reviewing provider overlap.');
