import{mkdir,readFile,rename,unlink,writeFile}from'node:fs/promises';
import{dirname}from'node:path';
import{randomUUID}from'node:crypto';

const uncertain=()=>Object.assign(Error('上次渠道生图请求的结果不明，已停止自动重发；请检查渠道生成记录。'),{code:'SUBMISSION_UNCERTAIN'});
const localCodes=new Set(['NOT_LOGGED_IN','LOGIN_REQUIRED','AUTH_REQUIRED','INVALID_CONFIG','CONFIG_INVALID','VALIDATION_ERROR','LOCAL_VALIDATION_FAILED','UNSUPPORTED_CHANNEL','ERR_INVALID_URL']);
const localMessages=[
 /^(?:ChatGPT|Google|Grok)\s*订阅 未登录：请到 旅行壁纸 > 渠道设置 完成订阅登录/,
 /^请先在旅行壁纸的渠道设置中保存API配置$/,
 /^不支持的生图渠道$/,
 /^API地址需为HTTPS，或本机HTTP地址，不含账号、查询参数$/,
 /^prompt must be a non-empty string$/,
 /^订阅生图最多支持 \d+ 张参考图，当前 \d+ 张$/,
 /^(?:invalid oauth blob|oauth blob needs accessToken or refreshToken|Antigravity token endpoint returned no access token)$/,
 /^xAI (?:size (?:请使用 WIDTHxHEIGHT；也可直接传 aspect_ratio|必须是正整数宽高|与 aspect_ratio 不一致)|不支持(?:比例|清晰度) )/,
];

function rejected(error){
 if(error?.code==='SUBMISSION_UNCERTAIN'||error?.responseAccepted===true||error?.accepted===true)return null;
 const status=[error?.responseStatus,error?.status,error?.statusCode,error?.response?.status].map(Number).find(value=>Number.isInteger(value)&&value>=100&&value<=599);
 if(status>=200&&status<300)return null;
 if(error?.beforeSubmission===true||localCodes.has(error?.code))return{failure:'before-submission'};
 if(status>=400&&status<500)return{failure:'rejected',responseStatus:status};
 if(status)return null;
 const message=typeof error?.message==='string'?error.message:'';
 const legacy=message.match(/^(?:codex|grok) HTTP (4\d\d)\b/)||message.match(/^(?:OpenAI API|兼容 OpenAI 的 API|Google Gemini API|字节火山 Seedream API)请求失败（HTTP (4\d\d)）/)||message.match(/^订阅登录或刷新失败（HTTP (4\d\d)）/);
 if(legacy)return{failure:'rejected',responseStatus:Number(legacy[1])};
 // Antigravity may try multiple endpoints. A mixed rejection/transport result is uncertain.
 if(message.startsWith('antigravity image generation failed: ')){
  const outcomes=message.slice('antigravity image generation failed: '.length).split(' | ').map(part=>part.match(/^[a-z\d.-]+(?::\d+)?: HTTP (4\d\d)\b/i));
  if(outcomes.length&&outcomes.every(Boolean))return{failure:'rejected',responseStatus:Number(outcomes[0][1])};
  return null;
 }
 return localMessages.some(pattern=>pattern.test(message))?{failure:'before-submission'}:null;
}

async function cache(file,bytes){
 await mkdir(dirname(file),{recursive:true});
 const temp=file+'.'+randomUUID()+'.tmp';
 try{await writeFile(temp,bytes);await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}
}

export async function recoverCloudImage({channel,context={},generate,now=()=>new Date()}){
 if(context.cacheFile){try{return await readFile(context.cacheFile);}catch(error){if(error.code!=='ENOENT')throw error;}}
 if(context.resume?.kind==='cloud'&&['submitted','received','uncertain'].includes(context.resume.state))throw uncertain();
 const submittedAt=now().toISOString();
 await context.checkpoint?.({kind:'cloud',state:'submitted',channel,submittedAt});
 let bytes;
 try{
  bytes=await generate();
  if(!(bytes instanceof Uint8Array)||!bytes.byteLength)throw Error('渠道未返回可保存的图片字节');
 }catch(error){
  const failure=rejected(error);
  if(failure){await context.checkpoint?.({kind:'cloud',state:'failed',channel,submittedAt,failedAt:now().toISOString(),...failure});throw error;}
  await Promise.resolve().then(()=>context.checkpoint?.({kind:'cloud',state:'uncertain',channel,submittedAt,uncertainAt:now().toISOString()})).catch(()=>{});
  throw uncertain();
 }
 if(context.cacheFile){
  try{await cache(context.cacheFile,bytes);}catch{
   await Promise.resolve().then(()=>context.checkpoint?.({kind:'cloud',state:'uncertain',channel,submittedAt,uncertainAt:now().toISOString()})).catch(()=>{});
   throw uncertain();
  }
 }
 // Bytes must be durable before this checkpoint; a checkpoint error can recover from cache.
 await context.checkpoint?.({kind:'cloud',state:'received',channel,submittedAt,receivedAt:now().toISOString()});
 return bytes;
}
