import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { runCodex } from '../bridge/src/codex.js';
const data={symbol:'EURUSD',timeframe:'H1',mode:'auto',drawings:[],instruction:''};
function fixture({code=0,text='Analisis contoh',hang=false}={}) {
  let child,seen;
  return {
    spawnProcess(executable,args,options){
      seen={executable,args,options};child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
      child.stdin.on('finish',()=>{if(hang)return;void (async()=>{if(text!==null)await writeFile(args[args.indexOf('--output-last-message')+1],text);child.emit('close',code);})();});
      return child;
    },
    terminate(){queueMicrotask(()=>child.emit('close',1));},
    seen:()=>seen,
  };
}
const settings={executable:'native-codex',server:{command:'node',args:['mcp.js']},timeoutMs:1000};
test('runner sends stdin with shell disabled and captures final text only',async()=>{
  const f=fixture();const result=await runCodex(data,{...settings,...f});assert.deepEqual(result,{text:'Analisis contoh',screenshot:null});assert.equal(f.seen().options.shell,false);assert.ok(!JSON.stringify(f.seen().args).includes('EURUSD'));
});
test('runner rejects failed exits, missing/empty output, and unavailable chart',async()=>{
  for(const [options,expected] of [[{code:3},'CODEX_EXIT'],[{text:null},'INVALID_OUTPUT'],[{text:''},'EMPTY_OUTPUT'],[{text:'ANALYSIS_UNAVAILABLE: chart salah'},'CHART_UNAVAILABLE']])await assert.rejects(runCodex(data,{...settings,...fixture(options)}),{code:expected});
});
test('runner terminates timed out job and aborts shutdown',async()=>{
  await assert.rejects(runCodex(data,{...settings,timeoutMs:20,...fixture({hang:true})}),{code:'TIMEOUT'});
  const controller=new AbortController();const promise=runCodex(data,{...settings,signal:controller.signal,...fixture({hang:true})});setTimeout(()=>controller.abort(),20);await assert.rejects(promise,{code:'SHUTDOWN'});
});
