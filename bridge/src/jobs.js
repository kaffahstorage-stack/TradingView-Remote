import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomUUID } from 'node:crypto';
import { validateRequest } from '../../shared/validation.js';
const stamp=()=>FieldValue.serverTimestamp();
export async function claimJob(db,ref,ownerUid,timeoutMs,now=Date.now()) {
  const lockRef=db.doc('bridgeLocks/tradingview');
  const token=randomUUID();
  return db.runTransaction(async tx=>{
    const [snap,lock]=await Promise.all([tx.get(ref),tx.get(lockRef)]);
    const d=snap.data();
    if(!snap.exists || d.status!=='pending' || d.userId!==ownerUid)return null;
    if(lock.exists && (lock.data().blocked || lock.data().expiresAt.toMillis()>now))return null;
    let input;
    try { input=validateRequest(d); } catch {tx.update(ref,{status:'failed',completedAt:stamp(),error:{code:'VALIDATION',message:'Field permintaan tidak valid. Buat permintaan baru.'}});return null;}
    const expiresAt=Timestamp.fromMillis(now+timeoutMs+60000);
    tx.set(lockRef,{token,jobId:ref.id,expiresAt});
    tx.update(ref,{status:'processing',startedAt:stamp(),claimToken:token,leaseExpiresAt:expiresAt});
    return {input,token,ref};
  });
}
export async function finishJob(db,job,result,error) {
  const lockRef=db.doc('bridgeLocks/tradingview');
  return db.runTransaction(async tx=>{
    const [snap,lock]=await Promise.all([tx.get(job.ref),tx.get(lockRef)]);
    if(snap.data()?.claimToken!==job.token || snap.data()?.status!=='processing')return false;
    tx.update(job.ref,{status:error?'failed':'completed',completedAt:stamp(),result:error?null:result,error:error?{code:error.code||'BRIDGE_ERROR',message:error.code?error.message:'Bridge tidak dapat menyelesaikan analisis. Periksa log lokal.'}:null});
    if(lock.data()?.token===job.token) {
      if(error?.code === 'KILL_UNCONFIRMED') tx.update(lockRef,{blocked:true});
      else tx.delete(lockRef);
    }
    return true;
  });
}
export async function recoverExpired(db,ownerUid,now=Date.now()) {
  // Never requeue: drawing side effects cannot be rolled back or replayed safely.
  const snapshots=await db.collection('analysisRequests').where('userId','==',ownerUid).where('status','==','processing').get();
  for(const snap of snapshots.docs) {
    const lease=snap.data().leaseExpiresAt;
    if(!lease || lease.toMillis()>now)continue;
    await db.runTransaction(async tx=>{
      const fresh=await tx.get(snap.ref);
      const d=fresh.data();
      if(d?.status==='processing' && d.leaseExpiresAt?.toMillis()<=now)tx.update(snap.ref,{status:'failed',completedAt:stamp(),result:null,error:{code:'LEASE_EXPIRED',message:'Bridge terputus atau berhenti. Periksa drawing di chart sebelum mengirim permintaan baru.'}});
    });
  }
}
