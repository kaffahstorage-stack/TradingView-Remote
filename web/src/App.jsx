import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { collection, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ArrowDown, ArrowUpRight, Bell, Check, ChevronDown, Download, LoaderCircle, LogOut, MessageCircle, Send, X } from 'lucide-react';
import { auth, db, provider } from './firebase.js';
import { chatRequest, MAX_INSTRUCTION } from '../../shared/validation.js';
import { heartbeatConnected, screenshotSource } from '../../shared/chat.js';
import { enableNotifications } from './notifications.js';
import { friendly, useConversation } from './useConversation.js';
import './style.css';

const DEMO=new URLSearchParams(location.search).get('demo')==='1' && ['localhost','127.0.0.1'].includes(location.hostname);
const STATUS={pending:'Antre',processing:'Diproses',completed:'Selesai',failed:'Gagal'};
const DEMO_DATE=Date.now();
const demoAnswer={text:'Contoh tampilan, bukan data pasar aktual.\n\nSupply: 4075–4078\nDemand: 4037–4040\n\nArea di atas memperlihatkan format jawaban yang akan Anda terima. Analisis sebenarnya memakai data chart TradingView di laptop Anda.\n\nHasil merupakan analisis, bukan kepastian.',summary:'XAUUSD M5 selesai — Supply 4075–4078, Demand 4037–4040.',symbol:'XAUUSD',timeframe:'M5'};
const initialDemo=[{id:'demo-example',instruction:'Tolong analisis XAUUSD M5 dan gambar supply-demand.',status:'completed',createdAt:DEMO_DATE,result:demoAnswer}];
const timestamp=t=>t?.toMillis?.() ?? (typeof t==='number'?t:Date.now());
const time=t=>new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',hour:'2-digit',minute:'2-digit'}).format(timestamp(t));
function userMessage(job){return job.instruction?.trim() || `Analisis ${job.symbol || 'chart'} ${job.timeframe || ''}${job.drawings?.length?` dengan ${job.drawings.join(', ')}`:''}.`;}
function Modal({title,onClose,children}) {
  const ref=useRef();
  useEffect(()=>{
    const old=document.activeElement;
    ref.current?.querySelector('button')?.focus();
    const handler=e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const elements=[...ref.current.querySelectorAll('button,a[href],input')];const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
    document.addEventListener('keydown',handler);return()=>{document.removeEventListener('keydown',handler);old?.focus();};
  },[onClose]);
  return <div className="modal-backdrop" onClick={onClose}><section ref={ref} className="modal" role="dialog" aria-modal="true" aria-label={title} onClick={e=>e.stopPropagation()}><button className="icon-button modal-close" aria-label="Tutup" onClick={onClose}><X size={20}/></button><h2>{title}</h2>{children}</section></div>;
}
export default function App(){
  const [user,setUser]=useState(DEMO?{uid:'demo'}:null),[authLoading,setAuthLoading]=useState(!DEMO),[authBusy,setAuthBusy]=useState(false);
  const [message,setMessage]=useState(''),[sending,setSending]=useState(false),[toast,setToast]=useState(''),[now,setNow]=useState(Date.now());
  const [demoJobs,setDemoJobs]=useState(initialDemo),[installPrompt,setInstallPrompt]=useState(null),[installHelp,setInstallHelp]=useState(false),[image,setImage]=useState(null);
  const [notifications,setNotifications]=useState(typeof Notification!=='undefined'&&Notification.permission==='granted');
  const [installed,setInstalled]=useState(matchMedia('(display-mode: standalone)').matches),[newMessages,setNewMessages]=useState(false);
  const toastTimer=useRef(),demoTimers=useRef([]),lock=useRef(false),scroll=useRef(),follow=useRef(true),draft=useRef(null),uidRef=useRef(user?.uid);
  const notify=useCallback(text=>{setToast(text);clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),6500);},[]);
  const conversation=useConversation(user,DEMO,notify);
  const jobs=(DEMO?demoJobs:conversation.jobs).slice().sort((a,b)=>timestamp(a.createdAt)-timestamp(b.createdAt));
  const online=!DEMO && now-conversation.lastConnection<45000;
  const connected=online && heartbeatConnected(conversation.heartbeat,now);
  const {needRefresh:[needRefresh],updateServiceWorker}=useRegisterSW({onRegisterError:()=>notify('Fitur offline belum siap. Muat ulang saat koneksi tersedia.')});
  useEffect(()=>{
    if(DEMO)return;
    return onAuthStateChanged(auth,next=>{uidRef.current=next?.uid;setUser(next);setAuthLoading(false);setMessage('');draft.current=null;setImage(null);},e=>{notify(friendly(e));setAuthLoading(false);});
  },[notify]);
  useEffect(()=>{
    const timers=demoTimers.current;
    const tick=setInterval(()=>setNow(Date.now()),1000);
    const before=e=>{e.preventDefault();setInstallPrompt(e);},done=()=>{setInstalled(true);setInstallPrompt(null);};
    window.addEventListener('beforeinstallprompt',before);window.addEventListener('appinstalled',done);
    return()=>{clearInterval(tick);clearTimeout(toastTimer.current);timers.forEach(clearTimeout);window.removeEventListener('beforeinstallprompt',before);window.removeEventListener('appinstalled',done);};
  },[]);
  const last=jobs.at(-1),contentKey=`${jobs.length}-${last?.id}-${last?.status}`;
  useEffect(()=>{
    const target=new URLSearchParams(location.search).get('request');
    const element=target&&document.getElementById(`request-${target}`);
    if(element){element.scrollIntoView({block:'center'});follow.current=false;}
    else if(follow.current)scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'});
    else setNewMessages(true);
  },[contentKey]);
  async function login(){setAuthBusy(true);try{await signInWithPopup(auth,provider);}catch(e){notify(friendly(e));}finally{setAuthBusy(false);}}
  async function logout(){try{await signOut(auth);}catch(e){notify(friendly(e));}}
  async function install(){if(!installPrompt){setInstallHelp(true);return;}try{await installPrompt.prompt();await installPrompt.userChoice;setInstallPrompt(null);}catch{setInstallHelp(true);}}
  async function activate(){try{await enableNotifications();setNotifications(true);notify('Notifikasi aktif saat aplikasi terbuka. Push saat aplikasi tertutup belum dikonfigurasi.');}catch(e){notify(e.message);}}
  async function send(e){
    e.preventDefault();if(lock.current || !user)return;
    let input;try{input=chatRequest(message);}catch(e){notify(e.message);return;}
    if(!online&&!DEMO){notify('Firebase belum tersambung. Pesan tetap tersimpan di kolom input.');return;}
    lock.current=true;setSending(true);const owner=user.uid;
    try {
      follow.current=true;
      if(DEMO){
        const id=crypto.randomUUID();setDemoJobs(rows=>[...rows,{...input,id,createdAt:Date.now(),status:'pending'}]);
        demoTimers.current.push(setTimeout(()=>setDemoJobs(rows=>rows.map(j=>j.id===id?{...j,status:'processing'}:j)),1200),setTimeout(()=>{setDemoJobs(rows=>rows.map(j=>j.id===id?{...j,status:'completed',result:demoAnswer}:j));notify('Simulasi selesai. Tidak ada request Firebase yang dikirim.');},3800));
      } else {
        // Reuse the same document ID for uncertain retry of the same draft; never enqueue twice.
        if(!draft.current || draft.current.message!==message || draft.current.uid!==owner) draft.current={message,uid:owner,ref:doc(collection(db,'analysisRequests'))};
        const existing=jobs.find(j=>j.id===draft.current.ref.id);
        if(!existing)await setDoc(draft.current.ref,{...input,userId:owner,status:'pending',createdAt:serverTimestamp(),startedAt:null,completedAt:null,result:null,error:null});
        if(uidRef.current!==owner)return;
        draft.current=null;
      }
      setMessage('');
    }catch(e){notify(friendly(e));}finally{lock.current=false;setSending(false);}
  }
  const closeImage=useCallback(()=>setImage(null),[]),closeInstall=useCallback(()=>setInstallHelp(false),[]);
  if(authLoading)return <div className="login-page"><LoaderCircle className="spin" aria-label="Memuat sesi login"/></div>;
  if(!user)return <main className="login-page"><section className="login-card"><div className="app-mark"><MessageCircle size={27}/></div><p className="eyebrow">TRADINGVIEW REMOTE</p><h1>Chart Anda.<br/>Percakapan yang berarti.</h1><p>Analisis chart dan gambar area penting.<br/>Cukup tulis apa yang ingin Anda ketahui.</p><button className="google-button" onClick={login} disabled={authBusy}>{authBusy?<LoaderCircle className="spin" size={18}/>:<span className="google-letter">G</span>}Masuk dengan Google<ArrowUpRight size={16}/></button><small>Ruang percakapan pribadi, terhubung ke laptop Anda.</small><button className="text-button" onClick={install}><Download size={14}/>Instal aplikasi</button></section>{toast&&<div className="toast" role="status">{toast}</div>}{installHelp&&<Modal title="Instal TradingView Remote" onClose={closeInstall}><p>Buka website melalui HTTPS di Chrome Android. Pilih menu ⋮ → Tambahkan ke layar utama → Instal.</p><p>Aplikasi dapat dibuka offline. Login dan analisis memerlukan internet.</p></Modal>}</main>;
  return <div className="chat-app"><header className="chat-header"><div className="header-inner"><span><i className={online?'green':''}/>Status: <strong>{online?'Online':'Offline'}</strong></span><span><i className={connected?'green':''}/>TradingView: <strong>{connected?'Connected':'Disconnected'}</strong></span></div></header>
    <main className="messages" ref={scroll} onScroll={e=>{follow.current=e.currentTarget.scrollHeight-e.currentTarget.scrollTop-e.currentTarget.clientHeight<100;if(follow.current)setNewMessages(false);}} aria-label="Riwayat percakapan"><div className="message-width">
      {DEMO&&<p className="demo-note">Preview lokal · pesan dan jawaban contoh · tidak terhubung ke Firebase</p>}
      {conversation.error&&<div className="error-box" role="alert">{conversation.error}<button onClick={conversation.retry}>Coba lagi</button></div>}
      {conversation.hasMore&&<button className="older" onClick={()=>{follow.current=false;conversation.loadMore();}}>Muat percakapan sebelumnya<ChevronDown size={13}/></button>}
      {conversation.loading&&<p className="loading"><LoaderCircle className="spin" size={16}/>Memuat percakapan…</p>}
      {!jobs.length&&!conversation.loading&&<div className="welcome"><div className="welcome-mark"><MessageCircle size={26}/></div><h1>Mau lihat apa di chart hari ini?</h1><p>Tulis simbol, timeframe, dan area yang ingin Anda analisis.<br/>Codex akan membacanya di TradingView Anda.</p><button onClick={()=>setMessage('Tolong analisis XAUUSD M5 dan gambar supply-demand.')}>Analisis XAUUSD M5 <ArrowUpRight size={14}/></button><small>Pastikan bridge dan TradingView aktif di laptop.</small></div>}
      {jobs.map(job=>{const src=screenshotSource(job.result?.screenshot);return <article className="exchange" id={`request-${job.id}`} key={job.id}><div className="user-message"><div className="bubble user-bubble">{userMessage(job)}</div><span className="message-meta">Anda · {time(job.createdAt)} WITA</span></div><div className="assistant-message"><span className="assistant-label"><span className="codex-dot"/>Codex</span><div className={`bubble answer ${job.status==='failed'?'answer-error':''}`}>
        {job.status==='completed'?<><div className="answer-text">{typeof job.result==='string'?job.result:job.result?.text||'Tidak ada jawaban teks.'}</div>{src&&<button className="screenshot-button" aria-label="Perbesar screenshot chart" onClick={()=>setImage(src)}><img src={src} alt="Screenshot chart hasil analisis" loading="lazy"/><span>Buka chart lebih besar <ArrowUpRight size={13}/></span></button>}{job.result?.screenshotError&&<p className="image-note">{job.result.screenshotError}</p>}</>:job.status==='failed'?<><strong>Analisis belum berhasil.</strong><p>{typeof job.error==='string'?job.error:job.error?.message||'Bridge tidak dapat menyelesaikan request.'}</p><button className="text-button" onClick={()=>setMessage(userMessage(job))}>Salin pesan untuk dicoba lagi</button></>:<span className="working"><span className="typing"><i/><i/><i/></span>{job.status==='processing'?'Sedang membaca chart…':'Menunggu bridge di laptop…'}</span>}
      </div><span className={`message-meta job-status ${job.status}`} aria-live="polite">{job.status==='completed'?<Check size={12}/>:job.status==='failed'?<X size={12}/>:<LoaderCircle size={12} className="spin"/>}{STATUS[job.status]||job.status}</span></div></article>;})}
    </div></main>
    <footer className="composer-area"><div className="composer-width">{newMessages&&<button className="new-messages" onClick={()=>{follow.current=true;scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'});setNewMessages(false);}}>Pesan terbaru <ArrowDown size={14}/></button>}
      <form className="composer" onSubmit={send}><textarea aria-label="Pesan analisis" placeholder="Contoh: Tolong analisis XAUUSD di timeframe M5 dan gambar supply-demand." value={message} maxLength={MAX_INSTRUCTION} disabled={sending} rows={2} onChange={e=>setMessage(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send(e);}}}/><button className="send-button" type="submit" aria-label="Kirim pesan" disabled={sending||!message.trim()||(!online&&!DEMO)}>{sending?<LoaderCircle className="spin" size={19}/>:<Send size={19}/>}</button></form>
      <div className="composer-meta"><span>Analisis, bukan kepastian.</span><span>{message.length} / 1.500</span></div><div className="utility-row"><button onClick={activate} disabled={notifications}><Bell size={13}/>{notifications?'Notifikasi aktif':'Aktifkan notifikasi'}</button><button onClick={install} disabled={installed}><Download size={13}/>{installed?'Terinstal':'Instal'}</button>{!DEMO&&<button onClick={logout}><LogOut size={13}/>Keluar</button>}</div>
    </div></footer>
    {toast&&<div className="toast" role="status">{toast}<button aria-label="Tutup notifikasi" onClick={()=>setToast('')}><X size={15}/></button></div>}
    {needRefresh&&<div className="update-bar">Versi baru tersedia.<button onClick={()=>updateServiceWorker(true)}>Perbarui</button></div>}
    {image&&<Modal title="Screenshot chart" onClose={closeImage}><img className="full-chart" src={image} alt="Screenshot chart diperbesar"/><p>Geser atau perbesar gambar untuk melihat level harga.</p></Modal>}
    {installHelp&&<Modal title="Instal TradingView Remote" onClose={closeInstall}><p>Di Chrome Android, pilih ⋮ → Tambahkan ke layar utama → Instal. Gunakan alamat HTTPS untuk memasang aplikasi.</p><p>Notifikasi lokal memerlukan aplikasi tetap terbuka. Push saat aplikasi tertutup belum dikonfigurasi.</p></Modal>}
  </div>;
}
