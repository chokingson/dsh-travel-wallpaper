import {readFile} from 'node:fs/promises';
import manifest from './package.json' with {type:'json'};

const text=value=>typeof value==='string'?value.trim().slice(0,6000):'';
export function publicHttpsUrl(value){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:'';}catch{return '';}
}
const paragraphs=value=>Array.isArray(value)?value.slice(0,20).map(text).filter(Boolean):[];

// Public package data only: never read user preferences, credentials or accounts.
export function createAboutSupport({baseUrl=new URL('./',import.meta.url),read=readFile}={}){
  const load=async()=>{try{const value=JSON.parse(await read(new URL('about-support.json',baseUrl),'utf8'));if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}catch{return null;}};
  const code=async config=>{
    if(config?.support?.enabled!==true)return null;
    try{const bytes=await read(new URL('assets/support/wechat-appreciation.png',baseUrl));return Buffer.isBuffer(bytes)&&bytes.length<=32*1024*1024&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?bytes:null;}catch{return null;}
  };
  return {
    async describe(){
      const config=await load(),image=await code(config),support=config?.support||{};
      return {
        projectName:text(config?.projectName)||'旅行壁纸',version:manifest.version,
        notice:config?'':'关于与支持资料待配置，其他功能不受影响。',
        introduction:text(config?.introduction),githubUrl:publicHttpsUrl(config?.githubUrl),feedbackUrl:publicHttpsUrl(config?.feedbackUrl),supportPageUrl:publicHttpsUrl(config?.supportPageUrl),supportPageNote:text(config?.supportPageNote),wechat:text(config?.wechat),independence:text(config?.independence),materialNotice:text(config?.materialNotice),
        support:{enabled:support.enabled===true,qrAvailable:Boolean(image),qrUrl:image?'/api/planet-news?supportCode':null,status:support.enabled===false?'赞赏码已暂停公开展示。':image?'作者提供的微信赞赏码':'赞赏码待配置，其他功能不受影响。',paragraphs:paragraphs(support.paragraphs),equalAccess:text(support.equalAccess),privacy:text(support.privacy),savedCodeNotice:text(support.savedCodeNotice)},
        materials:Array.isArray(config?.materials)?config.materials.slice(0,20).map(item=>({name:text(item?.name),authors:text(item?.authors),files:paragraphs(item?.files),conditions:text(item?.conditions),verification:text(item?.verification),links:Array.isArray(item?.links)?item.links.slice(0,12).map(link=>({label:text(link?.label),url:publicHttpsUrl(link?.url)})).filter(link=>link.url):[]})):[],
      };
    },
    async image(){return code(await load());},
  };
}
