import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { loadCodexSettings, runCodex } from './codex.js';
import { claimJob, finishJob, recoverExpired } from './jobs.js';
const log=(event,details={})=>console.log(JSON.stringify({time:new Date().toISOString(),event,...details}));
async function main() {
  const ownerUid=process.env.OWNER_UID;
  if(!ownerUid || ownerUid==='OWNER_UID')throw new Error('Isi OWNER_UID di bridge/.env sebelum menjalankan bridge.');
  if(!process.env.GOOGLE_APPLICATION_CREDENTIALS)throw new Error('GOOGLE_APPLICATION_CREDENTIALS wajib menunjuk file service account di luar repository.');
  const timeoutMs=Number(process.env.JOB_TIMEOUT_MS||180000);
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>900000)throw new Error('JOB_TIMEOUT_MS harus 1000–900000.');
  const settings=await loadCodexSettings();
  const app=initializeApp({credential:applicationDefault(),projectId:process.env.FIREBASE_PROJECT_ID||'tradingview-remote'});
  const db=getFirestore(app);
  let stopping=false,running=false,unsubscribe=()=>{},activeController;
  let pending=[];
  async function pump() {
    if(stopping||running)return;
    running=true;
    try {
      await recoverExpired(db,ownerUid);
      for(const ref of pending) {
        if(stopping)break;
        const job=await claimJob(db,ref,ownerUid,timeoutMs);
        if(!job)continue;
        log('job_claimed',{jobId:ref.id});
        activeController=new AbortController();
        if(stopping)activeController.abort();
        let result=null,error=null;
        try {result=await runCodex(job.input,{...settings,timeoutMs,signal:activeController.signal});}catch(e){error=e;}
        // Retry persistence only, never the Codex invocation.
        let saved=false;
        for(let attempt=0;attempt<3&&!saved;attempt++) {
          try {saved=await finishJob(db,job,result,error);if(!saved)break;} catch {log('persist_retry',{jobId:ref.id,attempt:attempt+1});await new Promise(r=>setTimeout(r,1000*(attempt+1)));}
        }
        log(saved?(error?'job_failed':'job_completed'):'result_not_saved',{jobId:ref.id,code:error?.code});
        activeController=null;
        if(!saved || error?.code === 'KILL_UNCONFIRMED'){stopping=true;process.exitCode=1;break;}
      }
    } catch(e) {log('worker_error',{code:String(e.code||'FIRESTORE_ERROR')});}
    finally {running=false;if(stopping)await shutdown();}
  }
  let closed=false;
  async function shutdown() {
    stopping=true;unsubscribe();clearInterval(interval);activeController?.abort();
    if(running||closed)return;
    closed=true;await db.terminate();await deleteApp(app);log('bridge_stopped');
  }
  const interval=setInterval(()=>{void pump();},5000);
  unsubscribe=db.collection('analysisRequests').where('userId','==',ownerUid).where('status','==','pending').limit(100).onSnapshot(s=>{
    pending=s.docs.sort((a,b)=>(a.data().createdAt?.toMillis()||0)-(b.data().createdAt?.toMillis()||0)).map(d=>d.ref);void pump();
  },e=>{log('listener_failed',{code:String(e.code||'UNKNOWN')});process.exitCode=1;void shutdown();});
  process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
  log('bridge_started',{timeoutMs,concurrency:1});
}
main().catch(e=>{console.error(JSON.stringify({event:'startup_failed',message:e.message}));process.exitCode=1;});
