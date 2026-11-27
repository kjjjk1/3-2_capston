self.window=self;
importScripts('browser-demo-engine.js');
self.onmessage=({data})=>{try{self.postMessage({id:data.id,result:self.DTLocalEngine.analyze(data.input)});}catch(error){self.postMessage({id:data.id,error:error.message||'브라우저 분석에 실패했습니다.'});}};
