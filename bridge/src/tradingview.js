import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { FieldValue } from 'firebase-admin/firestore';
import { childEnvironment } from './codex.js';

export function toolData(result) {
  if (result?.isError) throw new Error('MCP_TOOL_FAILED');
  if (result?.structuredContent) return result.structuredContent;
  const block = result?.content?.find(x => x.type === 'text');
  if (!block) throw new Error('MCP_EMPTY_RESPONSE');
  return JSON.parse(block.text);
}
export function healthFlags(result) {
  try { const data = toolData(result); return {cdp_connected:data.cdp_connected === true, api_available:data.api_available === true}; }
  catch { return {cdp_connected:false, api_available:false}; }
}
export async function packScreenshot(bytes) {
  if (bytes.length > 25000000) throw new Error('SCREENSHOT_TOO_LARGE');
  for (const width of [1440, 1100, 800]) {
    const {data, info} = await sharp(bytes, {limitInputPixels: 20000000}).rotate().resize({width, withoutEnlargement:true}).jpeg({quality:72}).toBuffer({resolveWithObject:true});
    const encoded = data.toString('base64');
    if (encoded.length <= 480000) return {mimeType:'image/jpeg',data:encoded,width:info.width,height:info.height,capturedAt:Date.now()};
  }
  throw new Error('SCREENSHOT_TOO_LARGE');
}
export async function readScreenshotFile(file, directory) {
  const root = await realpath(directory), resolved = await realpath(file);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/\.(png|jpe?g|webp)$/i.test(resolved)) throw new Error('SCREENSHOT_PATH_REJECTED');
  if ((await stat(resolved)).size > 25000000) throw new Error('SCREENSHOT_TOO_LARGE');
  return readFile(resolved);
}
export function createTradingView(server, {screenshotDirectory=process.env.TRADINGVIEW_SCREENSHOT_DIR} = {}) {
  let client, transport, connecting, closed = false;
  async function connect() {
    if (closed) throw new Error('MCP_CLOSED');
    if (client) return client;
    if (!connecting) connecting = (async () => {
      const next = new Client({name:'tradingview-remote-bridge',version:'0.2.0'});
      transport = new StdioClientTransport({command:server.command,args:server.args,env:{...childEnvironment(),...server.env},stderr:'pipe'});
      transport.stderr?.on('data', () => {}); // Do not log raw MCP outputs/secrets.
      try { await next.connect(transport, {timeout:10000}); if(closed) {await next.close(); throw new Error('MCP_CLOSED');} client=next; next.onclose=()=>{if(client===next)client=null;}; return next; }
      catch (e) {await transport.close(); throw e;}
      finally {connecting=null;}
    })();
    return connecting;
  }
  async function call(name, args = {}) {
    const current = await connect();
    return current.callTool({name,arguments:args}, undefined, {timeout:12000});
  }
  return {
    async health() {try {return healthFlags(await call('tv_health_check'));} catch {return {cdp_connected:false,api_available:false};}},
    async screenshot(signal) {
      if (signal?.aborted) throw new Error('SHUTDOWN');
      const result = await call('capture_screenshot',{region:'chart',method:'cdp',wait_for_render:true});
      if (signal?.aborted) throw new Error('SHUTDOWN');
      const image = result.content?.find(x => x.type === 'image' && ['image/png','image/jpeg','image/webp'].includes(x.mimeType));
      if (image && !result.isError) return packScreenshot(Buffer.from(image.data,'base64'));
      const data = toolData(result);
      if (data.success !== true || typeof data.file_path !== 'string') throw new Error('SCREENSHOT_UNAVAILABLE');
      const entry = server.args.find(x => path.isAbsolute(x) && /[\\/]src[\\/]server\.js$/i.test(x));
      const directory = screenshotDirectory || (entry && path.join(path.dirname(path.dirname(entry)), 'screenshots'));
      if (!directory) throw new Error('SCREENSHOT_DIRECTORY_REQUIRED');
      return packScreenshot(await readScreenshotFile(data.file_path, directory));
    },
    async close() {closed=true; if(connecting) await connecting.catch(()=>{}); await client?.close(); await transport?.close(); client=null;},
  };
}
export function startHeartbeat(db, ownerUid, tradingView, log, intervalMs = 20000) {
  let stopped=false, active=null;
  const ref=db.doc(`bridgeStatus/${ownerUid}`);
  async function tick() {
    if(stopped || active) return;
    active=(async()=>{
      const flags=await tradingView.health();
      if(!stopped) await ref.set({userId:ownerUid,...flags,checkedAt:FieldValue.serverTimestamp()});
    })();
    try {await active;} catch {log('heartbeat_failed');} finally {active=null;}
  }
  const timer=setInterval(()=>void tick(),intervalMs);
  void tick();
  return async()=>{stopped=true;clearInterval(timer);await active?.catch(()=>{});await ref.set({userId:ownerUid,cdp_connected:false,api_available:false,checkedAt:FieldValue.serverTimestamp()}).catch(()=>{});};
}

