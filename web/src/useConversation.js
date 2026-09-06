import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDocFromServer, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from './firebase.js';
import { notifyCompletion, shouldNotify } from './notifications.js';
import { notificationText } from '../../shared/chat.js';
export function useConversation(user, demo, toast) {
  const [jobs,setJobs]=useState([]), [heartbeat,setHeartbeat]=useState(null), [lastConnection,setLastConnection]=useState(0);
  const [loading,setLoading]=useState(false), [error,setError]=useState(''), [statusError,setStatusError]=useState('');
  const [pageSize,setPageSize]=useState(30), [retry,setRetry]=useState(0), [deepJob,setDeepJob]=useState(null);
  const previous=useRef(new Map()), notify=useRef(toast);
  notify.current=toast;
  const uid=user?.uid;
  useEffect(()=>{previous.current.clear();setJobs([]);setDeepJob(null);setPageSize(30);},[uid]);
  useEffect(()=>{
    if(!uid || demo) return;
    let cancelled=false;
    setLoading(true);setError('');
    const q=query(collection(db,'analysisRequests'),where('userId','==',uid),orderBy('createdAt','desc'),limit(pageSize));
    const unsubscribe=onSnapshot(q,{includeMetadataChanges:true},snapshot=>{
      if(cancelled)return;
      const rows=snapshot.docs.map(d=>({id:d.id,...d.data()}));
      // Metadata from cache is never used as evidence of a live Firebase connection.
      if(!snapshot.metadata.fromCache && navigator.onLine) {
        for(const row of rows) {
          if(shouldNotify(previous.current.get(row.id),row.status)) {
            notify.current(notificationText(row));
            void notifyCompletion(row).catch(()=>notify.current('Analisis selesai. Notifikasi sistem tidak dapat ditampilkan.'));
          }
          previous.current.set(row.id,row.status);
        }
      }
      setJobs(rows);setLoading(false);setError('');
    },e=>{if(!cancelled){setError(friendly(e));setLoading(false);}});
    return()=>{cancelled=true;unsubscribe();};
  },[uid,demo,pageSize,retry]);
  useEffect(()=>{
    setHeartbeat(null);setLastConnection(0);setStatusError('');
    if(!uid || demo)return;
    let cancelled=false,checking=false;
    const statusRef=doc(db,'bridgeStatus',uid);
    const unsubscribe=onSnapshot(statusRef,{includeMetadataChanges:true},snap=>{
      if(!cancelled && !snap.metadata.fromCache){setHeartbeat(snap.data()||null);}
    },e=>{if(!cancelled){setHeartbeat(null);setStatusError(friendly(e));}});
    async function check(){
      if(checking || cancelled)return;
      if(!navigator.onLine){setLastConnection(0);return;}
      checking=true;
      let timer;
      try {
        const snap=await Promise.race([getDocFromServer(statusRef),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Firebase tidak merespons. Periksa koneksi internet.')),12000);})]);
        if(!cancelled && navigator.onLine){setHeartbeat(snap.data()||null);setLastConnection(Date.now());setStatusError('');}
      } catch(e){if(!cancelled){setLastConnection(0);setStatusError(friendly(e));}}
      finally{clearTimeout(timer);checking=false;}
    }
    const offline=()=>setLastConnection(0);
    void check();const timer=setInterval(()=>void check(),20000);
    window.addEventListener('online',check);window.addEventListener('offline',offline);
    return()=>{cancelled=true;unsubscribe();clearInterval(timer);window.removeEventListener('online',check);window.removeEventListener('offline',offline);};
  },[uid,demo,retry]);
  useEffect(()=>{
    if(!uid || demo)return;
    const id=new URLSearchParams(location.search).get('request');
    if(!id || !/^[A-Za-z0-9_-]{1,128}$/.test(id))return;
    let cancelled=false;
    const unsubscribe=onSnapshot(doc(db,'analysisRequests',id),snap=>{
      if(!cancelled && snap.exists() && snap.data().userId===uid)setDeepJob({id:snap.id,...snap.data()});
    },e=>{if(!cancelled)setError(friendly(e));});
    return()=>{cancelled=true;unsubscribe();};
  },[uid,demo,retry]);
  const rows=deepJob&&!jobs.some(j=>j.id===deepJob.id)?[...jobs,deepJob]:jobs;
  return {jobs:rows.filter(row=>row.userId===uid),heartbeat,lastConnection,loading,error:error||statusError,loadMore:()=>setPageSize(n=>n+30),hasMore:jobs.length>=pageSize,retry:()=>setRetry(n=>n+1)};
}
export function friendly(e) {
  return ({'permission-denied':'Akses Firestore ditolak. Terapkan rules chat dan bridgeStatus; pastikan UID akun sesuai.', 'failed-precondition':'Riwayat membutuhkan indeks userId (Ascending) + createdAt (Descending).', 'auth/popup-closed-by-user':'Login dibatalkan. Silakan coba lagi.', 'auth/popup-blocked':'Izinkan pop-up browser untuk masuk dengan Google.', 'auth/unauthorized-domain':'Domain ini belum diizinkan pada Firebase Authentication.', 'auth/operation-not-allowed':'Aktifkan login Google pada Firebase Authentication.', 'unavailable':'Firebase belum tersambung. Periksa internet Anda.', 'auth/network-request-failed':'Tidak dapat masuk. Periksa koneksi internet.'})[e.code] || e.message || 'Terjadi kesalahan. Silakan coba lagi.';
}


