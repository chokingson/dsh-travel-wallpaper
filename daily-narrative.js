import{readFile,mkdir,writeFile,rename}from'node:fs/promises';import{join}from'node:path';import{randomUUID,createHash}from'node:crypto';
export function planKey(config){const keys=['rolesEnabled','characters','imageToImage','referenceId','referenceInstructions','tripPrompt','world','era','rules','tags','textPrompt','style','extraPrompt','textContent','textDensity','textCarrier','carrierInstructions','sourceMode','keywords','days','width','height','usePromptSkills','promptMode'];return createHash('sha256').update(JSON.stringify(keys.map(k=>config[k]))).digest('hex').slice(0,32);}
export function createDailyNarrative(directory){let queue=Promise.resolve();
 const transaction=(day,fn,scope=day)=>{if(!/^\d{4}-\d\d-\d\d$/.test(day)||!/^\d{4}-\d\d-\d\d(?:-[a-f\d]{8})?$/.test(scope)||scope.slice(0,10)!==day)return Promise.reject(Error('旅行日期或批次无效'));const operation=queue.catch(()=>{}).then(async()=>{const file=join(directory,scope+'.json');let data;try{data=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;data={day,scope,plans:{}};}const result=await fn(data);await mkdir(directory,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(data,null,2));await rename(temp,file);return result;});queue=operation;return operation;};
 return{
  plan(day,key,create,scope=day){return transaction(day,async data=>{if(!data.plans[key]){data.plans[key]=await create(data.plot);data.plot??=data.plans[key].story;}return data.plans[key];},scope);},
  diary(day,create,scope=day){return transaction(day,async data=>{if(data.diary)return{diary:data.diary,created:false};data.diary=await create();return{diary:data.diary,created:true};},scope);},
 };
}
