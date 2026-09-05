import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, getDocs, collection, query, where, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
let env;
const data=()=>({userId:'alice',symbol:'COINBASE:BTCUSD',timeframe:'H1',mode:'auto',drawings:['trendline'],instruction:'',status:'pending',createdAt:serverTimestamp(),startedAt:null,completedAt:null,result:null,error:null});
before(async()=>{env=await initializeTestEnvironment({projectId:'demo-tradingview-remote',firestore:{rules:await readFile('firestore.rules','utf8')}});});
after(async()=>{await env?.cleanup();});
test('owner can create/read/query; other users and anonymous cannot read',async()=>{
  const alice=env.authenticatedContext('alice').firestore(),bob=env.authenticatedContext('bob').firestore();
  await assertSucceeds(setDoc(doc(alice,'analysisRequests/own'),data()));
  await assertSucceeds(getDoc(doc(alice,'analysisRequests/own')));
  await assertSucceeds(getDocs(query(collection(alice,'analysisRequests'),where('userId','==','alice'))));
  await assertFails(getDocs(collection(alice,'analysisRequests')));
  await assertFails(getDoc(doc(bob,'analysisRequests/own')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'analysisRequests/own')));
  await assertFails(setDoc(doc(bob,'analysisRequests/spoof'),data()));
  await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(),'analysisRequests/anon'),data()));
});
test('client cannot set result, mutate status, delete, inject extra keys, or use invalid enums',async()=>{
  const db=env.authenticatedContext('alice').firestore();
  await assertSucceeds(setDoc(doc(db,'analysisRequests/immutable'),data()));
  await assertFails(updateDoc(doc(db,'analysisRequests/immutable'),{status:'completed'}));
  await assertFails(deleteDoc(doc(db,'analysisRequests/immutable')));
  for(const [i,bad] of [{command:'whoami'},{symbol:'BTC;id'},{timeframe:'H2'},{mode:'shell'},{drawings:['replay_trade']},{drawings:['trendline','trendline']},{instruction:'x'.repeat(1501)},{result:{text:'spoof'}},{createdAt:new Date(0)},{status:'processing'},{mode:'instruction',instruction:'   '}].entries())await assertFails(setDoc(doc(db,`analysisRequests/invalid-${i}`),{...data(),...bad}));
  await assertSucceeds(setDoc(doc(db,'analysisRequests/custom'),{...data(),symbol:'NASDAQ:AAPL',mode:'instruction',instruction:'Fokus pada support'}));
});

test('real emulator transactions allow only one claim across concurrent workers', async()=>{
  const assert = (await import('node:assert/strict')).default;
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Emulator required; never use production');
  const {initializeApp,deleteApp}=await import('firebase-admin/app');
  const {getFirestore}=await import('firebase-admin/firestore');
  const {claimJob,finishJob}=await import('../bridge/src/jobs.js');
  const app=initializeApp({projectId:'demo-tradingview-remote'},'claim-test');
  const db=getFirestore(app);
  try {
    const ref=db.doc('analysisRequests/concurrent');
    await ref.set({...data(),createdAt:new Date(),userId:'worker-owner'});
    const attempts=await Promise.all(Array.from({length:6},()=>claimJob(db,ref,'worker-owner',1000)));
    assert.equal(attempts.filter(Boolean).length,1);
    const job=attempts.find(Boolean);
    await finishJob(db,job,{text:'Uji emulator',screenshot:null},null);
    assert.equal((await ref.get()).data().status,'completed');
  } finally {await db.terminate();await deleteApp(app);}
});
