import {mkdir,readFile,readdir,writeFile,rename,unlink}from'node:fs/promises';import{join,resolve}from'node:path';import{createHash,randomUUID}from'node:crypto';
import sharp from'sharp';import{specialties,itemImagePrompt,specialtyCatalogVersion}from'./specialties-catalog.js';
import{approvedWorldData}from'./world-cases-v2-data.js';import{worldAliases}from'./world-cases.js';import{worldContext}from'./world-context.js';
import{effectiveConfig}from'./mode-config.js';import{activeParty}from'./party.js';import{createTaskStore,taskSummary,scheduleDay}from'./scheduled-tasks.js';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const queues=new Map();
const parseJson=async(file,fallback)=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}};
async function atomic(file,data){await mkdir(resolve(file,'..'),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,data);await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}}
async function imageFormat(bytes){if(!(bytes instanceof Uint8Array)||!bytes.byteLength)throw Error('收藏品图片尚未完成');const meta=await sharp(bytes,{limitInputPixels:36_000_000}).metadata();if(!['png','jpeg','webp'].includes(meta.format))throw Error('收藏品图片格式无效');return meta.format;}
const whiteItemImage=bytes=>sharp(bytes,{limitInputPixels:36_000_000}).rotate().flatten({background:'#ffffff'}).resize(1024,1024,{fit:'contain',background:'#ffffff'}).png().toBuffer();
export function specialtyWorld(config){
 const canonical=worldAliases[config.tripCaseId]||config.tripCaseId;
 const preset=config.tripSource==='builtin'?approvedWorldData.find(world=>world.id===canonical):null;
 const id=preset?'builtin:'+preset.id:config.tripSource==='dsh'&&config.tripGenerationId?'dsh:'+config.tripGenerationId:'custom:'+digest({world:config.world,tripPrompt:config.tripPrompt,rules:config.rules}).slice(0,32);
 return {id,source:preset?'builtin':config.tripSource||'user',worldCaseId:preset?.id||'',world:config.world||preset?.world||'未命名世界',facts:worldContext(config).facts,...(!worldContext(config).structured?{userWorldRules:config.rules||'',userWorldText:config.tripPrompt||''}:{})};
}
function presetWorld(world){return{id:'builtin:'+world.id,source:'builtin',worldCaseId:world.id,world:world.world,facts:{world:world.world,environment:world.environment,society:world.society,rules:world.rules,motifs:world.motifs}};}
export function chooseSpecialtySource(current,random=Math.random){
 if(random()<0.5)return{branch:'current',world:structuredClone(current)};
 const pool=approvedWorldData.filter(world=>'builtin:'+world.id!==current.id),index=Math.min(pool.length-1,Math.max(0,Math.floor(random()*pool.length)));
 return{branch:'other',world:presetWorld(pool[index])};
}
export function validateDynamicItem(value){
 if(!value||value.living!==false)throw Error('物品设定须明确不为活体；灵魂与现象可以保留');
 const result={living:false};for(const key of ['name','appearance','properties','localUse','visualManifestation','category']){
  if(typeof value[key]!=='string'||!value[key].trim()||value[key].length>(key==='name'?100:key==='category'?40:2000))throw Error('物品资料不完整：'+key);result[key]=value[key].trim();
 }return result;
}
export function createSpecialties({directory,design,writeStory,render,readAsset,now=()=>new Date(),random=Math.random}){
 const root=resolve(directory),store=createTaskStore({directory:root,now});let running=null,disposed=false,controller;
 const itemFile=id=>join(root,'items',digest(id)+'.json'),imageFile=id=>join(root,'images',digest(id)+'.png'),deliveryFile=id=>join(root,'deliveries',id+'.json');
 const serialize=operation=>{const next=(queues.get(root)||Promise.resolve()).catch(()=>{}).then(operation);queues.set(root,next);return next;};
 const entries=async()=>{
  const names=await readdir(join(root,'deliveries')).catch(error=>{if(error.code==='ENOENT')return [];throw error;});const records=[];let skipped=0;
  for(const name of names){if(!/^gift-[a-f\d]{32}\.json$/.test(name))continue;try{const record=await parseJson(join(root,'deliveries',name),null);if(record?.state!=='completed'||record.id+'.json'!==name||typeof record.story!=='string'||record.item?.id!==record.itemId||typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt))||['id','name','world','appearance','properties','localUse','visualManifestation'].some(key=>typeof record.item?.[key]!=='string'||!record.item[key].trim())||!Array.isArray(record.party))throw Error('收藏记录不完整');records.push(record);}catch{skipped++;}}
  records.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||b.id.localeCompare(a.id));return{records,skipped};
 };
 const run=async task=>{
  const id=task.id,sessionId=task.sessionId;controller=new AbortController();
  const guard=async()=>{controller.signal.throwIfAborted();const current=await store.get(id);if(disposed||current?.state!=='running'||current.sessionId!==sessionId)throw new DOMException('收藏任务已中止','AbortError');};
  const checkpoint=async patch=>{await guard();task=await store.progress(id,patch);};
  try{
   if((await parseJson(deliveryFile(id),null))?.state==='completed'){await store.complete(id);return;}
   await guard();let item=task.item;
   if(!item){
    if(task.selection.world.worldCaseId)item=specialties.find(item=>item.worldCaseId===task.selection.world.worldCaseId);
    else {await checkpoint({stage:'design'});const definition=validateDynamicItem(await design({sourceWorld:task.selection.world,travelWorld:task.travelWorld,storyOutcome:task.storyOutcome,party:task.party,date:task.day},{signal:controller.signal,config:task.config}));await guard();item={...definition,id:'dynamic:'+id,world:task.selection.world.world,worldCaseId:'',number:'',catalogVersion:0,sourceWorld:task.selection.world};item.prompt=itemImagePrompt(item);}
    if(!item)throw Error('来源世界缺少固定物品');await checkpoint({stage:'story',item:structuredClone(item)});
   }
   if(!task.story){
    const data=await writeStory({date:task.day,mode:task.party.length?'travel':'world',party:task.party,sourceWorld:task.selection.world,travelWorld:task.travelWorld,item,storyOutcome:task.storyOutcome,userRequest:task.userRequest},{signal:controller.signal,config:task.config});await guard();
    if(typeof data?.story!=='string'||data.story.trim().length<20||data.story.length>1800)throw Error('送达经历尚未完整写成');
    const senderIds=Array.isArray(data.senderIds)?[...new Set(data.senderIds.filter(id=>task.party.some(actor=>actor.id===id)))]:[];
    await checkpoint({stage:'image',story:data.story.trim(),senderIds});
   }
   let bytes;
   if(item.worldCaseId){bytes=await readAsset(item);if(!bytes)throw Object.assign(Error('正式物品图尚待完成，经历已保留，图片就绪后继续入藏'),{code:'REMOTE_PENDING'});await imageFormat(bytes);}
   else {
    bytes=await readFile(imageFile(item.id)).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(!bytes){
     const cacheFile=join(root,id+'-image.bin');bytes=await render(item.prompt,{...task.config,rolesEnabled:false,party:null,characters:'',imageToImage:false,referenceId:'',referenceInstructions:'',style:'二次元动漫风格',width:1024,height:1024,textDensity:'none'},
      {signal:controller.signal,resume:task.renderState,cacheFile,checkpoint:renderState=>checkpoint({stage:'image',renderState})});
     await guard();await imageFormat(bytes);bytes=await whiteItemImage(bytes);await guard();await atomic(imageFile(item.id),bytes);
     await unlink(cacheFile).catch(error=>{if(error.code!=='ENOENT')throw error;});
    }else await imageFormat(bytes);
   }
   await guard();await checkpoint({stage:'committing'});
   const storedItem={...item,sourceWorld:task.selection.world};
   await atomic(itemFile(item.id),JSON.stringify(storedItem,null,2));await guard();
   await atomic(deliveryFile(id),JSON.stringify({id,taskId:id,state:'completed',key:task.key,item:storedItem,itemId:item.id,day:task.day,createdAt:now().toISOString(),sourceWorld:task.selection.world,travelWorld:task.travelWorld,party:task.party,senderIds:task.senderIds||[],mode:task.party.length?'travel':'world',story:task.story,sourceIssueId:task.sourceIssueId,storyOutcome:task.storyOutcome},null,2));
   await store.complete(id,{itemId:item.id});
  }catch(error){if(!disposed)await store.fail(id,error);}finally{controller=null;}
 };
 return{
  async enqueue(record){return serialize(async()=>{
   if(record?.state!=='published')throw Error('只有已完成的旅行才能收到特产');
   const config=effectiveConfig(record.recipe||{}),outcome=record.storyOutcome||record.images?.[0]?.storyOutcome;
   if(outcome?.status!=='committed'||!outcome.description)throw Error('旅行事件尚未完成提交');
   const party=config.rolesEnabled===false?[]:structuredClone(record.images?.[0]?.party||activeParty(config));
   const travelWorld=specialtyWorld(config),date=scheduleDay(now()),trip=config.tripGenerationId||(config.tripCaseId?config.tripCaseId+':'+(config.tripTimeId||''):config.tripPrompt||'');
   const key=digest({day:date,world:travelWorld.id,trip,party:party.map(actor=>({id:actor.id,referenceId:actor.referenceId}))});
   const id='gift-'+key.slice(0,32),existing=await store.get(id);if(existing)return existing;
   const selection=chooseSpecialtySource(travelWorld,random);
   return store.create({id,type:'specialty',day:date,dueAt:now().toISOString(),autoRetry:true,key,travelWorld,selection,party,storyOutcome:structuredClone(outcome),sourceIssueId:record.issueId||record.day,userRequest:config.interactionPrompt||'',config:structuredClone(config),catalogVersion:specialtyCatalogVersion});
  });},
  async tick(){if(disposed)return;if(running)return running;running=(async()=>{for(const pending of await store.list({type:'specialty',all:true})){if(disposed)return;if(!['waiting','running','retrying','waiting-remote'].includes(pending.state))continue;const claimed=await store.claim(pending.id,{recoverOwn:true});if(claimed)await run(claimed);}})().finally(()=>{running=null;});return running;},
  async retry(id){const task=await store.get(id);if(task?.type!=='specialty')throw Error('收藏任务不存在');await store.retry(id);},
  async list(){
   const {records,skipped}=await entries(),groups=new Map();for(const record of records){if(!groups.has(record.itemId))groups.set(record.itemId,{...record.item,lastReceivedAt:record.createdAt,deliveryCount:0,deliveryId:record.id});groups.get(record.itemId).deliveryCount++;}
   const items=[...groups.values()],collected=new Set(items.map(item=>item.id)),progress=specialties.filter(item=>collected.has(item.id)).length;
   return{items,progress,total:50,skipped,checklist:specialties.map(item=>({number:item.number,world:item.world,worldCaseId:item.worldCaseId,collected:collected.has(item.id),...(collected.has(item.id)?{itemId:item.id}:{})})),pending:(await store.list({type:'specialty',all:true})).filter(task=>!['completed','canceled'].includes(task.state)).map(task=>({...taskSummary(task),name:task.item?.name||'',storyReady:Boolean(task.story),sourceIssueId:task.sourceIssueId}))};
  },
  async details(id){const {records}=await entries(),deliveries=records.filter(record=>record.itemId===id);if(!deliveries.length)throw Object.assign(Error('尚未收到这件收藏'),{status:404});return{item:deliveries[0].item,deliveries};},
  async image(id){const {item}=await this.details(id);let bytes=item.worldCaseId?await readAsset(specialties.find(preset=>preset.id===id)):await readFile(imageFile(id));if(!bytes)throw Object.assign(Error('正式物品图缺失，请保留记录并恢复图片'),{status:404});let format=await imageFormat(bytes);if(!item.worldCaseId&&(await sharp(bytes).metadata()).hasAlpha){bytes=await whiteItemImage(bytes);await atomic(imageFile(id),bytes);format='png';}return{bytes,mediaType:'image/'+(format==='jpg'?'jpeg':format)};},
  dispose(){disposed=true;controller?.abort();},
 };
}
