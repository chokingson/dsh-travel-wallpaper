import{mkdir,open,unlink}from'node:fs/promises';
import{isAbsolute,resolve,join,extname}from'node:path';import{pipeline}from'node:stream/promises';
const shorten=(value,budget)=>{let output='';for(const char of value){if(Buffer.byteLength(output+char)>budget)break;output+=char;}return output;};
export function wallpaperFileName(picture,extension='png'){
 const clean=value=>String(value||'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim();
 const role=clean(picture.rolesEnabled===false?'观察世界':picture.referenceName||picture.character||picture.story?.character||'自定义').slice(0,40),day=/^\d{4}-\d\d-\d\d$/.test(picture.day||'')?picture.day:'日期未记录';
 const size=Number.isSafeInteger(picture.width)&&Number.isSafeInteger(picture.height)?picture.width+'×'+picture.height:'尺寸未记录',tail=' · '+role+' · '+day+'-'+size;
 return shorten(clean(picture.world)||'未记录世界',Math.max(20,220-Buffer.byteLength(tail)))+tail+'.'+extension;
}
export function normalizeDownloadDirectory(value){
 if(typeof value!=='string'||value.length>2048||/[\x00-\x1f]/.test(value))throw Error('下载目录格式无效');
 const path=value.trim();if(!path)return'';if(!isAbsolute(path))throw Error('下载目录请填写绝对路径，或留空使用系统下载目录');return resolve(path);
}
export async function saveDownload(directory,filename,source){
 const folder=normalizeDownloadDirectory(directory);if(!folder)throw Error('请先保存自定义下载目录');
 let name=String(filename).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/^[. ]+|[. ]+$/g,'')||'旅行壁纸.png';
 const extension=extname(name);let stem=shorten(name.slice(0,name.length-extension.length),220)||'旅行壁纸';if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem))stem='_'+stem;
 await mkdir(folder,{recursive:true});
 for(let index=0;index<10000;index++){
  const path=join(folder,stem+(index?' ('+index+')':'')+extension);let file;
  try{file=await open(path,'wx');}catch(error){if(error.code==='EEXIST')continue;throw error;}
  try{await pipeline(source,file.createWriteStream());return path;}
  catch(error){await file.close().catch(()=>{});await unlink(path).catch(()=>{});throw error;}
 }
 throw Error('同名文件过多，请更换下载目录');
}
