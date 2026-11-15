import{test}from'node:test';
import assert from'node:assert/strict';
import{mkdtemp,readFile,readdir,rm}from'node:fs/promises';
import{join}from'node:path';
import{tmpdir}from'node:os';
import{recoverCloudImage}from'./cloud-render-recovery.js';

const bytes=Buffer.from('saved raw image bytes');
const uncertain=error=>error.code==='SUBMISSION_UNCERTAIN';
const fixture=async()=>{const dir=await mkdtemp(join(tmpdir(),'cloud-render-recovery-')),states=[];const context={cacheFile:join(dir,'image.raw'),checkpoint:async state=>{states.push(state);context.resume=state;}};return{dir,states,context};};

test('missing subscription login is safely retryable and never persists credential diagnostics',async()=>{
 const{dir,states,context}=await fixture();let calls=0;const generate=async()=>{if(++calls===1)throw Error('ChatGPT 订阅 未登录：请到 旅行壁纸 > 渠道设置 完成订阅登录 secret-token-value');return bytes;};
 try{await assert.rejects(recoverCloudImage({channel:'chatgpt-sub',context,generate}),error=>error.code!=='SUBMISSION_UNCERTAIN');assert.equal(context.resume.state,'failed');assert.doesNotMatch(JSON.stringify(states),/secret-token-value|未登录/);assert.deepEqual(await recoverCloudImage({channel:'chatgpt-sub',context,generate}),bytes);assert.equal(calls,2);assert.deepEqual(states.map(state=>state.state),['submitted','failed','submitted','received']);}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('explicit API HTTP 429 rejection can retry successfully using the same checkpoint',async()=>{
 const{dir,states,context}=await fixture();let calls=0;const generate=async()=>{if(++calls===1)throw Error('OpenAI API请求失败（HTTP 429），请检查账号额度、模型和地址');return bytes;};
 try{await assert.rejects(recoverCloudImage({channel:'openai',context,generate}),/HTTP 429/);assert.equal(context.resume.state,'failed');assert.equal(context.resume.responseStatus,429);assert.deepEqual(await recoverCloudImage({channel:'openai',context,generate}),bytes);assert.equal(calls,2);assert.equal(states.at(-1).state,'received');}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('accepted timeout, undecodable response and mixed vendor failures never trigger a second paid submission',async()=>{
 for(const error of[Object.assign(Error('accepted but timed out with credential-secret'),{name:'TimeoutError',responseStatus:200}),SyntaxError('Unexpected token in accepted response'),Error('渠道没有返回PNG、JPEG或WebP图片'),Error('codex HTTP 500: OpenAI API请求失败（HTTP 429）'),Error('antigravity image generation failed: first.example: HTTP 429: quota | second.example: fetch failed')]){
  const{dir,states,context}=await fixture();let calls=0;const generate=async()=>{calls++;throw error;};
  try{await assert.rejects(recoverCloudImage({channel:'google-sub',context,generate}),uncertain);assert.equal(context.resume.state,'uncertain');await assert.rejects(recoverCloudImage({channel:'google-sub',context,generate}),uncertain);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(states),/credential-secret|Unexpected token|quota|fetch failed/);}
  finally{await rm(dir,{recursive:true,force:true});}
 }
});

test('durable bytes recover after the received checkpoint fails without repeating generation',async()=>{
 const{dir,context}=await fixture();let calls=0;const save=context.checkpoint;context.checkpoint=async state=>{if(state.state==='received')throw Error('checkpoint storage unavailable');await save(state);};const generate=async()=>{calls++;return bytes;};
 try{await assert.rejects(recoverCloudImage({channel:'openai',context,generate}),/checkpoint storage unavailable/);assert.equal(context.resume.state,'submitted');assert.deepEqual(await readFile(context.cacheFile),bytes);assert.deepEqual(await readdir(dir),['image.raw']);assert.deepEqual(await recoverCloudImage({channel:'openai',context,generate}),bytes);assert.equal(calls,1);}
 finally{await rm(dir,{recursive:true,force:true});}
});

test('uncached submitted, received or uncertain checkpoints block generation after restart',async()=>{
 for(const state of['submitted','received','uncertain']){let called=false;await assert.rejects(recoverCloudImage({channel:'openai',context:{resume:{kind:'cloud',state,channel:'openai'}},generate:async()=>{called=true;return bytes;}}),uncertain);assert.equal(called,false);}
});

test('an uncertainty checkpoint error cannot turn an accepted failure into an ordinary retry',async()=>{
 let calls=0;const context={checkpoint:state=>{if(state.state==='uncertain')throw Error('checkpoint unavailable');context.resume=state;}};
 const generate=async()=>{calls++;throw Object.assign(Error('accepted but timed out'),{responseStatus:200});};
 await assert.rejects(recoverCloudImage({channel:'openai',context,generate}),uncertain);await assert.rejects(recoverCloudImage({channel:'openai',context,generate}),uncertain);assert.equal(calls,1);
});

test('explicit pre-submission flags and existing vendor rejection formats stay retryable',async()=>{
 for(const error of[Object.assign(Error('local diagnostics with secret'),{beforeSubmission:true}),Object.assign(Error('unknown wording'),{code:'LOGIN_REQUIRED'}),Object.assign(Error('unknown wording'),{responseStatus:403}),Error('codex HTTP 429: rate limited'),Error('API地址需为HTTPS，或本机HTTP地址，不含账号、查询参数'),Error('请先在旅行壁纸的渠道设置中保存API配置'),Error('prompt must be a non-empty string'),Error('antigravity image generation failed: first.example: HTTP 429: quota | second.example: HTTP 403: denied')]){
  const{dir,context}=await fixture();try{await assert.rejects(recoverCloudImage({channel:'openai',context,generate:async()=>{throw error;}}),actual=>actual===error);assert.equal(context.resume.state,'failed');}
  finally{await rm(dir,{recursive:true,force:true});}
 }
});
