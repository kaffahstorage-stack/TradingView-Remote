import test from 'node:test';
import assert from 'node:assert/strict';
import { claimJob, finishJob, recoverExpired } from '../bridge/src/jobs.js';
const valid={userId:'owner',symbol:'EURUSD',timeframe:'H1',mode:'auto',drawings:[],instruction:'',status:'pending'};
// Serialized transactions with staged writes model Firestore's atomic commit boundary.
function memoryDb(seed) {
  const records=new Map(Object.entries(seed));let queue=Promise.resolve();
  const db={doc:p=>({path:p,id:p.split('/').at(-1)}),records};
  function snap(ref){return {exists:records.has(ref.path),data:()=>records.get(ref.path),ref};}
  db.runTransaction=fn=>{const run=queue.then(async()=>{const writes=[];const value=await fn({get:async r=>snap(r),set:(r,d)=>writes.push(()=>records.set(r.path,d)),update:(r,d)=>writes.push(()=>records.set(r.path,{...records.get(r.path),...d})),delete:r=>writes.push(()=>records.delete(r.path))});writes.forEach(w=>w());return value;});queue=run.catch(()=>{});return run;};
  db.collection=()=>{const q={where:()=>q,get:async()=>({docs:[...records.keys()].filter(k=>k.startsWith('analysisRequests/')).map(k=>snap(db.doc(k)))})};return q;};return db;
}
test('concurrent workers claim a request only once and serialize the shared chart',async()=>{
  const db=memoryDb({'analysisRequests/a':{...valid},'analysisRequests/b':{...valid}}),ref=db.doc('analysisRequests/a');
  const claims=await Promise.all([claimJob(db,ref,'owner',1000,0),claimJob(db,ref,'owner',1000,0)]);
  assert.equal(claims.filter(Boolean).length,1);assert.equal(await claimJob(db,db.doc('analysisRequests/b'),'owner',1000,0),null);
  const job=claims.find(Boolean);assert.equal(await finishJob(db,{...job,token:'stale'},null,null),false);
  await finishJob(db,job,{text:'hasil',screenshot:null},null);
  assert.equal(db.records.get(ref.path).status,'completed');assert.ok(await claimJob(db,db.doc('analysisRequests/b'),'owner',1000,0));
});
test('reject another owner and invalid request before executing Codex',async()=>{
  const db=memoryDb({'analysisRequests/a':{...valid,timeframe:'SHELL'}}),ref=db.doc('analysisRequests/a');
  assert.equal(await claimJob(db,ref,'other',1000,0),null);assert.equal(db.records.get(ref.path).status,'pending');
  assert.equal(await claimJob(db,ref,'owner',1000,0),null);assert.equal(db.records.get(ref.path).status,'failed');
});
test('expired interrupted job fails rather than replaying drawings',async()=>{
  const db=memoryDb({'analysisRequests/a':{...valid}}),ref=db.doc('analysisRequests/a');
  const job=await claimJob(db,ref,'owner',1000,0);await recoverExpired(db,'owner',61001);
  assert.equal(db.records.get(ref.path).status,'failed');assert.equal(await finishJob(db,job,{text:'late'},null),false);assert.equal(await claimJob(db,ref,'owner',1000,62000),null);
});

test('unconfirmed termination blocks the shared chart until manual recovery',async()=>{
  const db=memoryDb({'analysisRequests/a':{...valid},'analysisRequests/b':{...valid}});
  const job=await claimJob(db,db.doc('analysisRequests/a'),'owner',1000,0);
  await finishJob(db,job,null,{code:'KILL_UNCONFIRMED',message:'Periksa proses'});
  assert.equal(db.records.get('bridgeLocks/tradingview').blocked,true);
  assert.equal(await claimJob(db,db.doc('analysisRequests/b'),'owner',1000,999999),null);
});
