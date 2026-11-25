export function createAnalysisTimer(now=()=>performance.now()){
 const started=now(),totals={db:0,candidate:0,evaluation:0,api:0},counts={db:0,candidate:0,evaluation:0,api:0},requests=[];
 const add=(stage,elapsed,meta,ok=true)=>{totals[stage]+=Math.max(0,elapsed);counts[stage]++;if(stage==='api')requests.push({...meta,durationMs:Math.round(Math.max(0,elapsed)*10)/10,ok});};
 const measure=async(stage,fn,meta)=>{const start=now();let ok=false;try{const value=await fn();ok=true;return value;}finally{add(stage,now()-start,meta,ok);}};
 const sync=(stage,fn)=>{const start=now();try{return fn();}finally{add(stage,now()-start);}};
 const database=source=>{
  const originals=new WeakMap();
  const statement=original=>{const wrapped=new Proxy(original,{get(target,key){if(key==='bind')return(...args)=>statement(target.bind(...args));if(['first','all','run'].includes(key))return(...args)=>measure('db',()=>target[key](...args));const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});originals.set(wrapped,original);return wrapped;};
  return new Proxy(source,{get(target,key){if(key==='prepare')return(...args)=>statement(target.prepare(...args));if(key==='batch')return items=>measure('db',()=>target.batch(items.map(item=>originals.get(item)||item)));const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
 };
 const snapshot=()=>{const totalMs=Math.max(0,now()-started),round=v=>Math.round(v*10)/10;return {scope:'analysis_handler',totalMs:round(totalMs),dbMs:round(totals.db),dbOperations:counts.db,candidateMs:round(totals.candidate),evaluationMs:round(totals.evaluation),apiMs:round(totals.api),apiRequests:counts.api,apiAverageMs:counts.api?round(totals.api/counts.api):0,apiMaxMs:requests.length?Math.max(...requests.map(r=>r.durationMs)):0,otherMs:round(Math.max(0,totalMs-Object.values(totals).reduce((a,b)=>a+b,0))),requests:requests.map(r=>({...r}))};};
 return {now,add,measure,sync,database,snapshot};
}
