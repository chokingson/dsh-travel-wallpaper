import {scheduleDay} from './scheduled-tasks.js';
import {deliveryContextKey} from './delivery.js';
import {effectiveConfig} from './mode-config.js';

export const needsSubscriptionLogin=task=>task?.errorCode==='SUBSCRIPTION_AUTH_REQUIRED'||(!task?.errorCode&&/^(?:订阅登录或刷新失败（HTTP (?:400|401)）|codex HTTP 401\b)/.test(task?.error||''));

// Reauthorization must not replay old manual requests or missed daily images.
export async function recoverAuthorizedTasks({provider,config,taskStore,bookingId,now=new Date()}){
 const day=scheduleDay(now),context=deliveryContextKey(effectiveConfig(config)),resumed=[];
 for(const task of await taskStore.list({all:true})){
  if(task.state!=='error'||!needsSubscriptionLogin(task)||(task.executionConfig?.imageChannel||config.imageChannel)!==provider)continue;
  if(task.dueAt&&Date.parse(task.dueAt)>now.getTime())continue;
  if(task.contextKey&&task.contextKey!==context)continue;
  const eligible=(task.type==='booking'&&task.id===bookingId)||(task.type==='daily'&&config.enabled&&task.day===day)||(task.type==='story'&&task.day===day);
  if(!eligible)continue;
  await taskStore.retry(task.id);resumed.push(task.id);
 }
 return resumed;
}
