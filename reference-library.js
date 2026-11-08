import{mkdir,readFile,writeFile,rename}from'node:fs/promises';
import{join}from'node:path';import{randomUUID}from'node:crypto';
const builtins=[['deepseek','DS大肥鱼'],['gpt','GPT 龙娘'],['claude','Claude 大小姐']];
const validRef=id=>typeof id==='string'&&/^(?:[a-f0-9]{32}|builtin-(?:deepseek|gpt|claude))$/.test(id);
function checkedName(name){if(typeof name!=='string'||name.length>40||/[\x00-\x1f\x7f]/.test(name))throw Error('角色名称最多40字，不能包含控制字符');return name.trim()?name:'自定义';}
export function createReferenceLibrary(directory){
 const file=join(directory,'library.json');let queue=Promise.resolve();
 const fresh=()=>({version:1,groups:builtins.map(([id,name])=>({id,name,builtin:true,hidden:false})),references:Object.fromEntries(builtins.map(([id])=>['builtin-'+id,id])),slots:['','','']});
 const load=async()=>{try{const value=JSON.parse(await readFile(file,'utf8'));if(value.version!==1||!Array.isArray(value.groups)||!value.references||!Array.isArray(value.slots)||value.slots.length!==3)throw Error('角色分类档案损坏，请保留原文件后恢复备份');return value;}catch(error){if(error.code==='ENOENT')return fresh();throw error;}};
 const group=(data,id)=>{let found=data.groups.find(g=>g.id===id);for(let i=0;found?.redirect&&i<data.groups.length;i++)found=data.groups.find(g=>g.id===found.redirect);return found;};
 const mutate=fn=>{const operation=queue.catch(()=>{}).then(async()=>{const data=await load(),result=await fn(data);await mkdir(directory,{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(data,null,2));await rename(tmp,file);return result;});queue=operation;return operation;};
 const read=async()=>{await queue.catch(()=>{});return load();};
 return{
  async list(){const data=await read();return{groups:data.groups.filter(g=>!g.hidden&&!g.redirect).map(g=>({...g})),hiddenIds:data.groups.filter(g=>g.hidden).map(g=>g.id),slots:data.slots.map(referenceId=>({referenceId,name:group(data,data.references[referenceId])?.name||'自定义',identityId:group(data,data.references[referenceId])?.id||''}))};},
  async resolve(referenceId){if(!referenceId)return{id:'none',name:'观察世界'};if(!validRef(referenceId))throw Error('参考图编号无效');const data=await read();return group(data,data.references[referenceId])||{id:'custom',name:'自定义'};},
  async identity(identityId){const data=await read();return group(data,identityId)||null;},
  assign({referenceId,name='',slot}){if(!validRef(referenceId))return Promise.reject(Error('参考图编号无效'));if(!Number.isInteger(slot)||slot<0||slot>2)return Promise.reject(Error('自定义槽位须为1到3'));return mutate(data=>{const label=checkedName(name);let identity=data.groups.find(g=>!g.redirect&&g.name===label);if(!identity){identity={id:randomUUID(),name:label,builtin:false,hidden:false};data.groups.push(identity);}identity.hidden=false;data.references[referenceId]=identity.id;data.slots[slot]=referenceId;return{identityId:identity.id,name:identity.name,referenceId,slot};});},
  rename({identityId,name}){return mutate(data=>{const identity=group(data,identityId);if(!identity)throw Error('角色分类不存在');if(identity.builtin)throw Error('预设角色名称固定');const label=checkedName(name),target=data.groups.find(g=>!g.redirect&&g.name===label&&g.id!==identity.id);if(target){for(const key of Object.keys(data.references))if(group(data,data.references[key])?.id===identity.id)data.references[key]=target.id;identity.redirect=target.id;identity.hidden=true;target.hidden=false;return target;}identity.name=label;identity.hidden=false;return identity;});},
  hide(identityId){return mutate(data=>{let identity=group(data,identityId);if(!identity&&identityId==='custom'){identity={id:'custom',name:'自定义',hidden:true};data.groups.push(identity);}if(!identity)throw Error('角色分类不存在');identity.hidden=true;return{hidden:true,id:identity.id};});},
  reveal(referenceId){return mutate(data=>{const identity=group(data,data.references[referenceId]);if(identity)identity.hidden=false;return identity;});},
 };
}
