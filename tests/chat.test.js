import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { chatRequest, validateRequest, requestsDrawingRemoval } from '../shared/validation.js';
import { heartbeatConnected, screenshotSource, notificationText, conversationUrl } from '../shared/chat.js';
import { healthFlags, packScreenshot, readScreenshotFile } from '../bridge/src/tradingview.js';
import { buildPrompt } from '../bridge/src/prompt.js';
import { shouldNotify } from '../web/src/notifications.js';

test('free text chat validates length while preserving legacy requests',()=>{
  const request=chatRequest('Tolong analisis XAUUSD M5 dan gambar supply-demand.');
  assert.equal(request.requestType,'chat');assert.equal(request.symbol,null);
  assert.deepEqual(validateRequest({...request,command:'whoami'}),request);
  for(const message of ['', '   ', 'a'.repeat(1501), '\u0000'])assert.throws(()=>chatRequest(message));
  assert.throws(()=>validateRequest({...request,symbol:'BTCUSD'}));
  const prompt=buildPrompt(request);assert.ok(prompt.includes('bukan kepastian'));assert.ok(prompt.includes('capture_screenshot'));assert.ok(prompt.includes('batas bawah/atas'));
});
test('drawing deletion capability requires explicit drawing-removal words',()=>{
  assert.equal(requestsDrawingRemoval('Berikan entry SL TP'),false);
  assert.equal(requestsDrawingRemoval('Hapus transaksi lama'),false);
  assert.equal(requestsDrawingRemoval('Hapus drawing trendline lama'),true);
  assert.ok(buildPrompt(chatRequest('Analisis BTCUSD')).includes('Pertahankan SEMUA drawing lama'));
});
test('connected requires exact health booleans and heartbeat age <=60 seconds',()=>{
  const heartbeat={checkedAt:100000,cdp_connected:true,api_available:true};
  assert.equal(heartbeatConnected(heartbeat,160000),true);
  assert.equal(heartbeatConnected(heartbeat,160001),false);
  assert.equal(heartbeatConnected(heartbeat,99999),false);
  assert.equal(heartbeatConnected({...heartbeat,api_available:'true'},110000),false);
  assert.equal(heartbeatConnected(null),false);
  assert.deepEqual(healthFlags({content:[{type:'text',text:JSON.stringify({cdp_connected:true,api_available:true})}]}),{cdp_connected:true,api_available:true});
  assert.deepEqual(healthFlags({isError:true,structuredContent:{cdp_connected:true,api_available:true}}),{cdp_connected:false,api_available:false});
  assert.deepEqual(healthFlags({content:[]}),{cdp_connected:false,api_available:false});
});
test('screenshot raster compression fits Firestore and rejects arbitrary local paths',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'screenshot-test-'));
  try {
    const png=await sharp({create:{width:2000,height:1200,channels:3,background:'#eeeeee'}}).png().toBuffer();
    const packed=await packScreenshot(png);assert.ok(packed.data.length<=480000);assert.equal(packed.mimeType,'image/jpeg');assert.ok(screenshotSource(packed).startsWith('data:image/jpeg;base64,'));
    await writeFile(path.join(root,'chart.png'),png);
    assert.deepEqual(await readScreenshotFile(path.join(root,'chart.png'),root),png);
    await assert.rejects(readScreenshotFile('package.json',root));
    assert.equal(screenshotSource({mimeType:'image/svg+xml',data:'PHN2Zz4='}),null);
    assert.equal(screenshotSource({mimeType:'image/png',data:'https://evil.test/image'}),null);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('notify only new completion transitions; deep links encode request ID',()=>{
  assert.equal(shouldNotify(undefined,'completed'),false);assert.equal(shouldNotify('completed','completed'),false);assert.equal(shouldNotify('processing','completed'),true);
  assert.equal(notificationText({result:{summary:'XAUUSD M5 selesai — Supply 4075–4078, Demand 4037–4040.'}}),'XAUUSD M5 selesai — Supply 4075–4078, Demand 4037–4040.');
  assert.equal(conversationUrl('/TradingView-Remote/','job-1'),'/TradingView-Remote/?request=job-1');
});
