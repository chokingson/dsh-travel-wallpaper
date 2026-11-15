import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {createHash,randomUUID}from'node:crypto';
import {nextDayRules}from'./story-outcome.js';import{partyContext}from'./party.js';
const queues=new Map(),preparing=new Map();const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day=date=>new Date(date.getTime()+8*3600000).toISOString().slice(0,10);
const invalid=message=>Object.assign(Error(message),{status:409});
const changed=()=>invalid('当前剧情已更新，请重新选择。自定义草稿已保留。');
export function storyScope(config){return hash({world:config.world,era:config.era,source:config.tripSource,caseId:config.tripCaseId,timeId:config.tripTimeId,generationId:config.tripGenerationId,tripPrompt:config.tripPrompt,rolesEnabled:config.rolesEnabled!==false,party:partyContext(config),legacyCharacters:config.party?null:config.characters}).slice(0,32);}
export function storyVersion(context){return hash({scopeKey:context.scopeKey,issueId:context.issueId,outcome:context.storyOutcome,settingsVersion:context.settingsVersion}).slice(0,32);}
export function createStoryOptions({directory,getContext,getConfig,getBooking,write,accept,taskStatus,now=()=>new Date()}){
 const file=join(resolve(directory),'story-actions.json');
 const read=async()=>{try{const data=JSON.parse(await readFile(file,'utf8'));if(data.version!==1||!data.options||!data.receipts||!Array.isArray(data.plans))throw Error('剧情安排档案无效，请保留文件后恢复');return data;}catch(error){if(error.code==='ENOENT')return{version:1,options:{},receipts:{},plans:[]};throw error;}};
 const mutate=operation=>{const pending=(queues.get(file)||Promise.resolve()).catch(()=>{}).then(async()=>{const data=await read(),result=await operation(data);await mkdir(resolve(directory),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(data,null,2));await rename(temporary,file);return result;});queues.set(file,pending);return pending;};
 const settled=async()=>{await queues.get(file)?.catch(()=>{});return read();};
 const validContext=async()=>{const context=await getContext();if(!context?.valid||!context.scopeKey||!context.version)throw invalid('当前剧情尚不可读取，请先完成当前世界的壁纸或重试读取。');return context;};
 const kindOf=kind=>{if(!['today','tomorrow'].includes(kind))throw Error('剧情类型无效');return kind;};
 const optionKey=(context,kind)=>context.scopeKey+':'+context.version+':'+kind;
 const receiptStatus=async receipt=>receipt.taskId?{...receipt,...await taskStatus(receipt.taskId)}:receipt.result;
 return{
  async context(){return validContext();},
  async prepare(kind){
   kindOf(kind);const context=await validContext(),key=optionKey(context,kind),cached=(await settled()).options[key];if(cached)return cached;
   const flightKey=file+':'+key;if(preparing.has(flightKey))return preparing.get(flightKey);
   const generate=async()=>{
   const rules=kind==='tomorrow'?`三条分别依照后台完整规则创作：${JSON.stringify(nextDayRules.map(({id,definition})=>({id,definition})))}。输出不显示类别词或规则解释。`:'根据本次已经发生的剧情，创作三种不同的后续可能，不添加固定的情节方向或结果模板。';
   const task=`为旅行壁纸准备${kind==='today'?'今日':'次日'}剧情选项。${rules}选项是尚未发生的候选，不改写已提交的事实；每项写具体将发生的剧情。仅返回JSON：{"choices":[{"id":"A","text":"具体剧情"},{"id":"B","text":"具体剧情"},{"id":"C","text":"具体剧情"}]}。\n当前世界和已提交事实：${JSON.stringify(context)}`;
   const raw=await write(task);let result;try{result=JSON.parse(raw.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('选项暂未准备好，可重试或使用自定义剧情。');}
   if(!Array.isArray(result?.choices)||result.choices.length!==3||result.choices.some((item,index)=>item.id!=='ABC'[index]||typeof item.text!=='string'||!item.text.trim()||item.text.length>1500))throw Error('剧情选项不完整，可重试或使用自定义剧情。');
   const latest=await validContext();if(latest.scopeKey!==context.scopeKey||latest.version!==context.version)throw changed();
   return mutate(data=>data.options[key]??=( {kind,scopeKey:context.scopeKey,version:context.version,choices:result.choices.map(item=>({id:item.id,text:item.text.trim()})),createdAt:now().toISOString()} ));
   };const pending=generate().finally(()=>preparing.delete(flightKey));preparing.set(flightKey,pending);return pending;
  },
  async current(){const context=await validContext(),data=await settled(),config=await getConfig();return{...context,plan:[...data.plans].reverse().find(plan=>plan.scopeKey===context.scopeKey&&!plan.consumedAt&&!plan.canceledAt)||null,hour:config.hour};},
  async status(requestId){if(typeof requestId!=='string')throw Error('请求编号无效');const receipt=(await settled()).receipts[hash(requestId)];return receipt?receiptStatus(receipt):await taskStatus('story-'+hash(requestId).slice(0,24));},
  async submit(input){
   kindOf(input.kind);if(typeof input.requestId!=='string'||!/^[-a-zA-Z\d_]{1,120}$/.test(input.requestId))throw Error('请求编号无效');
   if(!['option','custom','random'].includes(input.source)||input.source==='random'&&input.kind!=='tomorrow')throw Error('剧情来源无效');
   if(input.source==='option'&&(input.text||!['A','B','C'].includes(input.choice))||input.source==='custom'&&input.choice||input.source==='random'&&(input.text||input.choice))throw Error('选项和自定义只能选一种，互斥提交');
   if(input.source==='custom'&&(typeof input.text!=='string'||!input.text.trim()||input.text.length>4000))throw Error('自定义剧情须为1至4000字');
   const fingerprint=hash({kind:input.kind,scopeKey:input.scopeKey,version:input.version,source:input.source,choice:input.choice,text:input.text});
   return mutate(async data=>{
    const key=hash(input.requestId),existing=data.receipts[key];if(existing){if(existing.fingerprint!==fingerprint)throw Error('同一请求编号的内容不能更改');const status=await receiptStatus(existing);if(status?.state!=='not-found')return status;}
    const context=await validContext();if(input.scopeKey!==context.scopeKey||input.version!==context.version)throw changed();
    const option=data.options[optionKey(context,input.kind)]?.choices.find(item=>item.id===input.choice);
    if(input.source==='option'&&!option)throw invalid('选项尚未准备好，请重新读取或使用自定义剧情');
    const text=input.source==='custom'?input.text:option?.text||'';
    if(input.kind==='tomorrow'){
     const config=await getConfig(),date=day(new Date(now().getTime()+86400000));
     const booking=await getBooking?.();if(input.source!=='random'&&booking?.day===date&&!['canceled','completed'].includes(booking.state))throw invalid('明日已有盲盒旅行预订；请先取消盲盒，或保留盲盒并放弃当前世界的次日剧情。');
     for(const plan of data.plans)if(plan.scopeKey===context.scopeKey&&!plan.consumedAt&&!plan.canceledAt)plan.canceledAt=now().toISOString();
     const plan=input.source==='random'?null:{id:randomUUID(),scopeKey:context.scopeKey,version:context.version,choice:input.source==='option'?input.choice:'',text,day:date,hour:config.hour,source:input.source,createdAt:now().toISOString()};
     if(plan)data.plans.push(plan);const result={state:'saved',plan};data.receipts[key]={fingerprint,result};return result;
    }
    const taskId='story-'+key.slice(0,24),receipt={fingerprint,taskId,requestId:input.requestId,state:'accepting',text,scopeKey:context.scopeKey,version:context.version};
    // The acceptance callback creates a deterministic task ID in task1's durable journal.
    const result=await accept({...receipt,kind:'today',context});data.receipts[key]={...receipt,...result};return{...receipt,...result};
   });
  },
  async forRun(scopeKey,date){const data=await settled(),plan=[...data.plans].reverse().find(plan=>plan.scopeKey===scopeKey&&plan.day<=date&&!plan.consumedAt&&!plan.canceledAt);return plan?{...plan,scheduledDay:plan.day,day:date}:null;},
  async consume(id,issueId){return mutate(data=>{const plan=data.plans.find(plan=>plan.id===id);if(plan&&!plan.consumedAt){plan.consumedAt=now().toISOString();plan.issueId=issueId;}return plan||null;});},
  async assertCanBook(date){const context=await getContext(),data=await settled();if(data.plans.some(plan=>plan.scopeKey===context.scopeKey&&plan.day===date&&!plan.consumedAt&&!plan.canceledAt))throw invalid('明日已有当前世界的次日剧情；请先在次日剧情中确认“恢复随机”，再预订盲盒旅行。');},
 };
}
