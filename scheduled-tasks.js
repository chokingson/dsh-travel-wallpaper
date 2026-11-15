import {mkdir,readFile,readdir,writeFile,rename,open,unlink,stat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export const RETRY_DELAY_MS=3*60_000;
export const MAX_RETRIES=3;
const queues=new Map();
const valid=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id);
export const scheduleDay=date=>new Date(date.getTime()+8*3600_000).toISOString().slice(0,10);
export function scheduleAt(day,hour){if(!/^\d{4}-\d\d-\d\d$/.test(day)||!Number.isInteger(hour)||hour<0||hour>23)throw Error('任务日期或时间无效');return new Date(`${day}T${String(hour).padStart(2,'0')}:00:00+08:00`).toISOString();}
export function nextDailyTime(config,now,task=null){
 if(!config.enabled)return null;
 const day=scheduleDay(now),start=config.tripStartDay&&config.tripStartDay>day?config.tripStartDay:day;
 if(start!==day)return scheduleAt(start,config.hour);
 if(['completed','canceled','error','needs-attention'].includes(task?.state))return scheduleAt(scheduleDay(new Date(now.getTime()+86400_000)),config.hour);
 if(task?.nextRetryAt)return task.nextRetryAt;
 return new Date(Math.max(now.getTime(),Date.parse(scheduleAt(day,config.hour)))).toISOString();
}
export function safeTaskError(error){return String(error?.message||error||'未知错误').replace(/Bearer\s+[^\s"']+/gi,'Bearer [redacted]').replace(/((?:access_token|refresh_token|api[_-]?key|authorization|token)["\s:=]+)[^\s&,"}]+/gi,'$1[redacted]').replace(/sk-[a-zA-Z0-9_-]{10,}/g,'[redacted]').slice(0,1000);}
export function taskSummary(task){if(!task)return null;return Object.fromEntries(['id','type','day','hour','dueAt','state','stage','attempts','nextRetryAt','createdAt','updatedAt','startedAt','finishedAt','lastFailedAt','canceledAt','issueId','error','errorCode','character','completed','total','reason'].filter(k=>task[k]!==undefined).map(k=>[k,task[k]]));}

// One durable file per task. All callers in this runtime share the write queue.
export function createTaskStore({directory,now=()=>new Date(),sessionId=randomUUID()}={}){
 const dir=join(resolve(directory),'tasks');
 const withLock=async operation=>{
  await mkdir(dir,{recursive:true});const path=join(dir,'.store.lock');let handle;
  for(let i=0;i<100&&!handle;i++){
   try{handle=await open(path,'wx');try{await handle.writeFile(JSON.stringify({pid:process.pid}));}catch(error){await handle.close();handle=null;await unlink(path).catch(()=>{});throw error;}}
   catch(error){if(error.code!=='EEXIST')throw error;let stale=false;try{const held=JSON.parse(await readFile(path,'utf8'));if(!Number.isInteger(held.pid)||held.pid<1)stale=Date.now()-(await stat(path)).mtimeMs>5000;else{try{process.kill(held.pid,0);}catch(e){stale=e.code==='ESRCH';}}}catch(e){if(e.code==='ENOENT')continue;if(e instanceof SyntaxError)stale=Date.now()-(await stat(path)).mtimeMs>5000;else throw e;}if(stale)await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e;});else await delay(10);}
  }
  if(!handle)throw Error('任务记录正在由另一个进程更新，请稍后');
  try{return await operation();}finally{await handle.close();await unlink(path);}
 };
 const serial=operation=>{const previous=queues.get(dir)||Promise.resolve(),next=previous.catch(()=>{}).then(()=>withLock(operation));queues.set(dir,next);void next.finally(()=>{if(queues.get(dir)===next)queues.delete(dir);}).catch(()=>{});return next;};
 const file=id=>{if(!valid(id))throw Error('任务编号无效');return join(dir,id+'.json');};
 const read=async id=>{try{return JSON.parse(await readFile(file(id),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 const save=async(task,event,detail={})=>{
  const at=now().toISOString(),events=[...(task.events||[]),...(event?[{at,event,...detail}]:[])];
  const value={...task,updatedAt:at,events};await mkdir(dir,{recursive:true});const target=file(value.id),temp=target+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2));await rename(temp,target);return value;
 };
 const owned=task=>task?.state==='running'&&task.sessionId===sessionId;
 return {
  get:id=>serial(()=>read(id)),
  create:task=>serial(async()=>{const existing=await read(task.id);if(existing)return existing;return save({state:'waiting',attempts:0,createdAt:now().toISOString(),...task},'created');}),
  update:(id,patch,event)=>serial(async()=>{const task=await read(id);if(!task)return null;const next=typeof patch==='function'?await patch(task):{...task,...patch};return next===task?task:save(next,event);}),
  list:({type,limit=50,all=false}={})=>serial(async()=>{const files=await readdir(dir).catch(e=>{if(e.code==='ENOENT')return [];throw e;});const tasks=[];for(const name of files.filter(n=>n.endsWith('.json'))){try{const task=await read(name.slice(0,-5));if(task&&(!type||task.type===type))tasks.push(task);}catch{}}return tasks.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))||b.id.localeCompare(a.id)).slice(0,all?undefined:Math.min(200,Math.max(1,limit)));}),
  claim:(id,{recoverOwn=false}={})=>serial(async()=>{
   const task=await read(id);if(!task)return null;
   let otherAlive=false;if(task.ownerPid&&task.ownerPid!==process.pid){try{process.kill(task.ownerPid,0);otherAlive=true;}catch{}}
   const resumed=task.state==='running'&&(task.sessionId!==sessionId||recoverOwn)&&!otherAlive;
   const due=['waiting','booked','retrying','waiting-remote'].includes(task.state)&&Date.parse(task.nextRetryAt||task.dueAt)<=now().getTime();
   if(!resumed&&!due)return null;
   const sameAttempt=resumed||task.state==='waiting-remote';
   return save({...task,state:'running',sessionId,ownerPid:process.pid,attempts:sameAttempt?task.attempts||1:(task.attempts||0)+1,startedAt:task.startedAt||now().toISOString(),nextRetryAt:null},resumed?'resumed':'started',{attempt:sameAttempt?task.attempts||1:(task.attempts||0)+1});
  }),
  progress:(id,patch)=>serial(async()=>{const task=await read(id);if(!owned(task))return task;return save({...task,...patch},task.stage!==patch.stage&&patch.stage?'stage':null,patch.stage?{stage:patch.stage}:{});}),
  complete:(id,patch={})=>serial(async()=>{const task=await read(id);if(!owned(task))return task;return save({...task,...patch,state:'completed',stage:'done',nextRetryAt:null,finishedAt:now().toISOString(),error:null,errorCode:null},'completed');}),
  fail:(id,error)=>serial(async()=>{
   const task=await read(id);if(!owned(task))return task;
   const waiting=error?.code==='REMOTE_PENDING',uncertain=error?.code==='SUBMISSION_UNCERTAIN',retry=task.autoRetry!==false&&!uncertain&&(waiting||task.attempts<MAX_RETRIES+1);
   const state=uncertain?'needs-attention':waiting?'waiting-remote':retry?'retrying':'error';
   return save({...task,state,error:safeTaskError(error),errorCode:error?.code||null,lastFailedAt:now().toISOString(),nextRetryAt:retry?new Date(now().getTime()+RETRY_DELAY_MS).toISOString():null,...(!retry?{finishedAt:now().toISOString()}:{})},waiting?'waiting-remote':'failed',{stage:task.stage||'preparing',attempt:task.attempts,error:safeTaskError(error),code:error?.code||null});
  }),
  cancel:(id,reason='user')=>serial(async()=>{const task=await read(id);if(!task||['completed','canceled'].includes(task.state))return task;return save({...task,state:'canceled',reason,canceledAt:now().toISOString(),nextRetryAt:null},'canceled',{reason});}),
  retry:id=>serial(async()=>{const task=await read(id);if(!task||!['error','retrying','waiting-remote'].includes(task.state))throw Error('该任务当前不可重试');return save({...task,state:'retrying',attempts:0,nextRetryAt:now().toISOString(),finishedAt:null},'manual-retry');}),
 };
}
