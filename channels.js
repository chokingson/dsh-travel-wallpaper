import { SubscriptionManager } from './vendor/subscriptions.js';

const definitions = [
  { provider:'chatgpt-sub', label:'ChatGPT 订阅', vendor:'codex' },
  { provider:'google-sub', label:'Google 订阅（Antigravity）', vendor:'antigravity' },
  { provider:'openai', label:'OpenAI API', endpoint:'https://api.openai.com/v1', model:'gpt-image-2' },
  { provider:'openai-compatible', label:'兼容 OpenAI 的 API', endpoint:'', model:'' },
  { provider:'google', label:'Google Gemini API', endpoint:'https://generativelanguage.googleapis.com/v1beta', model:'gemini-3.1-flash-image' },
  { provider:'seedream', label:'字节火山 Seedream API', endpoint:'https://ark.cn-beijing.volces.com/api/v3', model:'doubao-seedream-4-5-251128' },
];
const ref = provider => `TRAVEL_WALLPAPER_${provider.toUpperCase().replaceAll('-','_')}`;
function checkedEndpoint(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !(url.protocol==='https:' || (url.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)))) throw new Error('API地址需为HTTPS，或本机HTTP地址，不含账号、查询参数');
  return url.href.replace(/\/$/,'');
}
function decodeImage(value) {
  if (typeof value !== 'string' || value.length > 56_000_000 || !/^[A-Za-z0-9+/\s]+={0,2}$/.test(value)) throw new Error('渠道返回的图片内容无效或过大');
  const bytes = Buffer.from(value,'base64');
  const png=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  const jpeg=bytes[0]===255&&bytes[1]===216;
  const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if (!png&&!jpeg&&!webp) throw new Error('渠道没有返回PNG、JPEG或WebP图片');
  return bytes;
}
const closestRatio = (width=1920,height=1080) => ['1:1','16:9','9:16','4:3','3:4','3:2','2:3','21:9'].sort((a,b)=>{const n=x=>{const[w,h]=x.split(':').map(Number);return Math.abs(Math.log(w/h/(width/height)));};return n(a)-n(b);})[0];
export function createChannels(ctx) {
  const subscriptions = new SubscriptionManager(ctx);
  const read = async provider => {
    try { const raw=(await ctx.credentials?.resolve(ref(provider)))?.value; return raw?JSON.parse(raw):null; } catch { return null; }
  };
  return {
    async describe() {
      return Promise.all(definitions.map(async definition=>{
        const stored=definition.vendor?null:await read(definition.provider);
        const status=definition.vendor?await subscriptions.loginStatus(definition.vendor):null;
        return { provider:definition.provider,label:definition.label,subscription:Boolean(definition.vendor),configured:status?status.state==='logged-in':Boolean(stored?.key),
          endpoint:stored?.endpoint||definition.endpoint||'',model:stored?.model||definition.model||'' };
      }));
    },
    async login(provider) {
      const definition=definitions.find(item=>item.provider===provider&&item.vendor);
      if (!definition) throw new Error('请选择支持登录的订阅渠道');
      return subscriptions.beginLogin(definition.vendor);
    },
    async configure({provider,key,endpoint,model}) {
      const definition=definitions.find(item=>item.provider===provider&&!item.vendor);
      if (!definition || typeof key!=='string' || !key.trim() || key.length>8192 || typeof model!=='string' || !model.trim() || model.length>200) throw new Error('请填写有效的API密钥与模型名');
      await ctx.credentials.set(ref(provider),JSON.stringify({key:key.trim(),endpoint:checkedEndpoint(endpoint||definition.endpoint),model:model.trim()}));
    },
    async generate(prompt,config,reference) {
      const definition=definitions.find(item=>item.provider===config.imageChannel);
      if (!definition) throw new Error('不支持的生图渠道');
      const signal=AbortSignal.timeout(300_000);
      const image=reference?{data:Buffer.from(reference.data,'base64'),mediaType:reference.mediaType}:null;
      if (definition.vendor) {
        const images=await subscriptions.generate({vendor:definition.vendor,prompt,size:definition.vendor==='antigravity'?closestRatio(config.width,config.height):`${config.width||1920}x${config.height||1080}`,
          ...(config.imageQuality&&config.imageQuality!=='default'?{quality:config.imageQuality}:{}),referenceImages:image?[image]:[],signal});
        return decodeImage(images[0]?.b64_json);
      }
      const account=await read(definition.provider);
      if (!account?.key) throw new Error('请先在旅行壁纸的渠道设置中保存API配置');
      const endpoint=checkedEndpoint(account.endpoint);
      const headers={Authorization:`Bearer ${account.key}`};
      let url,body;
      if (definition.provider==='google') {
        url=`${endpoint}/models/${encodeURIComponent(account.model)}:generateContent`;
        delete headers.Authorization; headers['x-goog-api-key']=account.key;
        body=JSON.stringify({contents:[{role:'user',parts:[{text:prompt},...(reference?[{inlineData:{mimeType:reference.mediaType,data:reference.data}}]:[])]}],generationConfig:{responseModalities:['TEXT','IMAGE'],imageConfig:{aspectRatio:closestRatio(config.width,config.height)}}});
      } else if (definition.provider==='seedream') {
        url=`${endpoint}/images/generations`;
        body=JSON.stringify({model:account.model,prompt,size:`${config.width}x${config.height}`,response_format:'b64_json',watermark:false,...(reference?{image:`data:${reference.mediaType};base64,${reference.data}`}:{})});
      } else if (reference) {
        url=`${endpoint}/images/edits`;body=new FormData();body.set('model',account.model);body.set('prompt',prompt);body.set('n','1');
        body.set('size',config.width>config.height?'1536x1024':config.width<config.height?'1024x1536':'1024x1024');
        body.set('image',new Blob([image.data],{type:image.mediaType}),'reference.'+(image.mediaType==='image/webp'?'webp':image.mediaType==='image/jpeg'?'jpg':'png'));
      } else {
        url=`${endpoint}/images/generations`;body=JSON.stringify({model:account.model,prompt,n:1,size:config.width>config.height?'1536x1024':config.width<config.height?'1024x1536':'1024x1024'});
      }
      if (typeof body==='string') headers['content-type']='application/json';
      const response=await fetch(url,{method:'POST',headers,body,signal,redirect:'error'});
      if (!response.ok) throw new Error(`${definition.label}请求失败（HTTP ${response.status}），请检查账号额度、模型和地址`);
      const payload=await response.json();
      if (definition.provider==='google') {
        const data=payload.candidates?.flatMap(item=>item.content?.parts||[]).find(part=>part.inlineData?.data)?.inlineData?.data;
        return decodeImage(data);
      }
      const row=payload.data?.[0];
      if (!row?.b64_json) throw new Error('API未返回base64图片；请选择支持base64的模型和响应格式');
      return decodeImage(row.b64_json);
    },
  };
}
