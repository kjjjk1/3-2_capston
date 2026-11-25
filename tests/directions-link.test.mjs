import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('final-ui.js','utf8');
function fixture(){
 const a=source.indexOf(' function routeLink(');
 const code=source.slice(a,source.indexOf('\n }',a)+4);
 const box={Number,encodeURIComponent,routeOriginMemberId:'',context:()=>({}),E:s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),result:{origins:[{memberId:'a',name:'A',stopName:'출발 A',lat:36.3,lon:127.4},{memberId:'b',name:'B',stopName:'출발 B',lat:36.4,lon:127.5}]}};
 vm.createContext(box);vm.runInContext(code,box);return {box,c:{candidate:{name:'도착',lat:36.35,lon:127.45},paths:[{memberId:'a'},{memberId:'b'}]}};
}
test('shared visitors can select any analyzed attendee instead of requiring a personal token',()=>{
 const {box,c}=fixture();let html=box.routeLink(c);assert.ok(html.includes('routeOriginMember'));assert.ok(!html.includes('disabled'));assert.ok(!html.includes('href='));
 box.routeOriginMemberId='b';html=box.routeLink(c);assert.ok(html.includes('B 출발지에서'));assert.ok(html.includes(encodeURIComponent('출발 B')+',36.4,127.5/'));assert.ok(html.includes(encodeURIComponent('도착')+',36.35,127.45'));assert.ok(html.includes('rel="noopener noreferrer"'));
 box.routeOriginMemberId='unknown';assert.ok(!box.routeLink(c).includes('href='));
});
test('personal membership preselects that origin; missing coordinates never create a broken URL',()=>{
 const {box,c}=fixture();box.context=()=>({memberId:'a'});assert.ok(box.routeLink(c).includes('A 출발지에서'));
 box.result.origins[0].lat=NaN;assert.ok(!box.routeLink(c).includes('href='));
});


test('compensation display explains every attendee rather than only the worst two',()=>{
 const a=source.indexOf(' function compensationPanel('),b=source.indexOf('\n function carePanel',a);
 const box={result:{regular:true,recommendationPolicy:'balance'},E:String,num:n=>String(n),signed:n=>(n>0?'+':'')+n};
 vm.createContext(box);vm.runInContext(source.slice(a,b),box);
 const members=[{name:'A',past:10,projected:6,gain:4},{name:'B',past:-10,projected:-6,gain:4},{name:'C',past:0,projected:0,gain:0}];
 const html=box.compensationPanel({compensation:{members,netGain:8,beforeGap:20,afterGap:12,improvedCount:2,worsenedCount:0}});
 for(const m of members)assert.ok(html.includes('<td>'+m.name+'</td>'));
 assert.ok(html.includes('보상 점수'));assert.ok(html.includes('open'));assert.ok(html.includes('20분 → 12분'));
});
