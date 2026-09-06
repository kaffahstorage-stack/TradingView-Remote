import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestsDrawingRemoval, SYMBOL_PATTERN, TIMEFRAMES } from '../../shared/validation.js';
import { parse } from 'smol-toml';
import { buildPrompt } from './prompt.js';
export const ALLOWED_TOOLS = ['tv_health_check','chart_get_state','chart_set_symbol','chart_set_timeframe','chart_get_visible_range','symbol_info','data_get_ohlcv','data_get_study_values','draw_list','draw_shape','draw_get_properties','capture_screenshot'];
export class JobError extends Error { constructor(code, message) {super(message);this.code=code;} }
// TOML literals are arguments to a native process, never shell command text.
export function toml(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([k,v])=>`${JSON.stringify(k)}=${toml(v)}`).join(',')}}`;
  throw new Error('Nilai konfigurasi Codex tidak valid.');
}
export function safeServer(config) {
  const server=config.mcp_servers?.tradingview;
  if (!server || typeof server.command !== 'string' || !Array.isArray(server.args) || server.args.some(a=>typeof a!=='string')) throw new Error('Daftarkan MCP tradingview stdio (command + args) dalam config.toml Codex.');
  return {command:server.command,args:server.args,env:{...(server.env||{}),TV_CDP_HOST:'127.0.0.1',CDP_HOST:'127.0.0.1',TV_CDP_PORT:'9222',CDP_PORT:'9222'},enabled:true,required:true,enabled_tools:ALLOWED_TOOLS,startup_timeout_sec:30,tool_timeout_sec:45,default_tools_approval_mode:'auto'};
}
export async function loadCodexSettings(env=process.env) {
  const executable=env.CODEX_EXECUTABLE || 'codex';
  if (/\.(cmd|bat|ps1)$/i.test(executable)) throw new Error('CODEX_EXECUTABLE harus binary native, bukan .cmd/.bat/.ps1.');
  const configPath=env.CODEX_CONFIG_PATH || path.join(env.CODEX_HOME || path.join(homedir(),'.codex'),'config.toml');
  const server=safeServer(parse(await readFile(configPath,'utf8')));
  return {executable,server};
}
export function codexArgs(server, output) {
  const config={approval_policy:'never',web_search:'disabled','features.shell_tool':false,'features.unified_exec':false,'features.js_repl':false,'features.apps':false,'features.multi_agent':false,'apps._default.enabled':false,mcp_servers:{tradingview:server}};
  return ['exec','--ignore-user-config','--ignore-rules','--strict-config','--ephemeral','--skip-git-repo-check','--sandbox','read-only','--color','never',...Object.entries(config).flatMap(([k,v])=>['-c',`${k}=${toml(v)}`]),'--output-schema',fileURLToPath(new URL('./response.schema.json', import.meta.url)),'--output-last-message',output,'-'];
}
export function childEnvironment(env=process.env) {
  // Do not pass the bridge service-account path, API keys or arbitrary env secrets.
  const allowed=['PATH','Path','PATHEXT','SystemRoot','WINDIR','COMSPEC','TEMP','TMP','HOME','USERPROFILE','APPDATA','LOCALAPPDATA','CODEX_HOME'];
  return Object.fromEntries(allowed.filter(k=>env[k]).map(k=>[k,env[k]]));
}
function killTree(child) {
  if (!child.pid) return;
  if(process.platform==='win32') {
    const killer=spawn('taskkill.exe',['/pid',String(child.pid),'/T','/F'],{shell:false,windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>child.kill('SIGKILL'));
  } else {try {process.kill(-child.pid,'SIGKILL');} catch {child.kill('SIGKILL');}}
}
export async function runCodex(data,{executable,server,timeoutMs,signal,spawnProcess=spawn,terminate=killTree}) {
  const prompt=buildPrompt(data);
  const jobServer = {...server, enabled_tools: [...ALLOWED_TOOLS, ...(requestsDrawingRemoval(data.instruction) ? ['draw_remove_one'] : [])]};
  if(signal?.aborted) throw new JobError('SHUTDOWN','Bridge dihentikan sebelum analisis.');
  const dir=await mkdtemp(path.join(tmpdir(),'tv-remote-'));
  try {
    const output=path.join(dir,'result.txt');
    await new Promise((resolve,reject)=>{
      const child=spawnProcess(executable,codexArgs(jobServer,output),{cwd:dir,env:childEnvironment(),shell:false,windowsHide:true,detached:process.platform!=='win32',stdio:['pipe','pipe','pipe']});
      let bytes=0, failure, forceTimer;
      const stop=(error)=>{if(failure)return;failure=error;forceTimer=setTimeout(()=>{cleanup();reject(new JobError('KILL_UNCONFIRMED','Tidak dapat memastikan proses Codex berhenti. Hentikan proses di laptop sebelum menjalankan bridge lagi.'));},10000);terminate(child);};
      const abort=()=>stop(new JobError('SHUTDOWN','Bridge dihentikan. Drawing yang sempat dibuat mungkin tetap ada.'));
      const timeout=setTimeout(()=>stop(new JobError('TIMEOUT','Analisis melewati batas waktu. Periksa chart sebelum mengirim ulang.')),timeoutMs);
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted) abort();
      function cleanup(){clearTimeout(timeout);clearTimeout(forceTimer);signal?.removeEventListener('abort',abort);}
      const drain=chunk=>{bytes+=chunk.length;if(bytes>4*1024*1024)stop(new JobError('OUTPUT_LIMIT','Keluaran Codex melebihi batas aman.'));};
      child.stdout.on('data',drain);child.stderr.on('data',drain);
      child.stdin.on('error',()=>{});
      child.on('error',()=>{cleanup();reject(new JobError('CODEX_START','Codex tidak dapat dijalankan. Periksa executable dan login Codex di laptop.'));});
      child.on('close',code=>{cleanup();if(failure)reject(failure);else if(code!==0)reject(new JobError('CODEX_EXIT',`Codex berhenti dengan kode ${code ?? 'tidak diketahui'}. Periksa login, konfigurasi MCP, dan koneksi TradingView.`));else resolve();});
      child.stdin.end(prompt);
    });
    const info=await stat(output).catch(()=>null);
    if(!info || info.size>100000)throw new JobError('INVALID_OUTPUT','Codex tidak menghasilkan jawaban teks yang valid.');
    const text=(await readFile(output,'utf8')).trim();
    if(!text)throw new JobError('EMPTY_OUTPUT','Codex menghasilkan jawaban kosong.');
    if(text.startsWith('ANALYSIS_UNAVAILABLE:'))throw new JobError('CHART_UNAVAILABLE','Data chart tidak tersedia atau tidak cocok. Periksa TradingView dan MCP di laptop.');
        if (text.startsWith('{')) {
      let result;
      try { result = JSON.parse(text); } catch { throw new JobError('INVALID_OUTPUT', 'Jawaban Codex bukan JSON yang valid.'); }
      if (result.dataAvailable !== true) throw new JobError('CHART_UNAVAILABLE', 'Data chart tidak tersedia. Periksa TradingView di laptop.');
      if (typeof result.text !== 'string' || !result.text.trim() || typeof result.summary !== 'string') throw new JobError('INVALID_OUTPUT', 'Format hasil Codex tidak valid.');
      return {text:result.text.slice(0,20000), summary:result.summary.slice(0,220), symbol:typeof result.symbol === 'string' && SYMBOL_PATTERN.test(result.symbol) ? result.symbol : null, timeframe:TIMEFRAMES.includes(result.timeframe) ? result.timeframe : null, screenshot:null};
    }
    // Preserve compatibility with older Codex CLI output and existing requests.
    return {text:text.slice(0,20000),screenshot:null};
  } finally {await rm(dir,{recursive:true,force:true});}
}
