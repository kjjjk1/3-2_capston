// Offline audit only: does not call providers or read .env.
import {readFileSync,writeFileSync} from 'node:fs';
import {rankVerified,summarize} from '../analysis/fairness.mjs';
const [input,output]=process.argv.slice(2);
if(!input||!output)throw Error('Usage: node scripts/evaluate-shortlist.mjs full-candidate-results.json report.json');
const data=JSON.parse(readFileSync(input,'utf8').replace(/^\uFEFF/,''));
if(!Array.isArray(data.candidates)||!data.candidates.length||!Array.isArray(data.shortlistIds))throw Error('candidates and shortlistIds required');
const memberIds=data.memberIds;
if(!Array.isArray(memberIds)||memberIds.length<2||new Set(memberIds).size!==memberIds.length)throw Error('Distinct memberIds required');
const ids=new Set();for(const c of data.candidates){
 if(!c.candidate?.id||ids.has(c.candidate.id)||!Array.isArray(c.paths)||c.paths.length!==memberIds.length)throw Error('Invalid candidate or participant set');ids.add(c.candidate.id);
 const people=new Set(c.paths.map(p=>p.memberId));
 if(people.size!==memberIds.length||memberIds.some(id=>!people.has(id))||c.paths.some(p=>!Number.isFinite(p.expectedMinutes)||p.expectedMinutes<0||p.status==='unverified'))throw Error('Every candidate needs every member verified');
}
if(data.shortlistIds.some(id=>!ids.has(id)))throw Error('Shortlist ID missing from reference set');
const all=rankVerified(data.candidates,data.balances||{},data.regular!==false,{maxIncreaseRatio:.10});
const compressed=rankVerified(data.candidates.filter(c=>data.shortlistIds.includes(c.candidate.id)),data.balances||{},data.regular!==false,{maxIncreaseRatio:.10});
const errors=[];
for(const c of data.candidates)for(const p of c.paths)if(Number.isFinite(p.estimatedMinutes))errors.push(Math.abs(p.estimatedMinutes-p.expectedMinutes));
const metric=c=>data.regular!==false?c.projectedStd:c.summary.std;
const report={referenceCandidates:data.candidates.length,shortlistCandidates:data.shortlistIds.length,referenceWinner:all[0]?.candidate.id??null,shortlistWinner:compressed[0]?.candidate.id??null,referenceWinnerRetained:all[0]?data.shortlistIds.includes(all[0].candidate.id):null,
 meanDifferenceMinutes:all[0]&&compressed[0]?compressed[0].summary.average-all[0].summary.average:null,
 fairnessMetricDifferenceMinutes:all[0]&&compressed[0]?metric(compressed[0])-metric(all[0]):null,
 shortlistWinnerWithinReference10Percent:all.length&&compressed.length?compressed[0].summary.average<=Math.min(...data.candidates.map(c=>summarize(c.paths.map(p=>p.expectedMinutes)).average))*1.10+1e-9:null,
 estimateMeanAbsoluteErrorMinutes:errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:null,
 note:'Reference means the supplied candidate set, not all possible places. Each policy uses its own efficiency baseline; compare baseline impact as well.'};
writeFileSync(output,JSON.stringify(report,null,2));console.log('Saved offline validation report. No external API calls.');
