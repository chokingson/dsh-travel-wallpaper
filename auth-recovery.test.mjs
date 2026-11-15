import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTaskStore} from './scheduled-tasks.js';
import {recoverAuthorizedTasks} from './auth-recovery.js';
import {deliveryContextKey} from './delivery.js';
import {effectiveConfig} from './mode-config.js';

test('login recovery resumes only due tasks for this account and current travel, never a backlog or canceled work',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'travel-auth-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const now=new Date('2026-11-15T13:00:00Z'),store=createTaskStore({directory:dir,now:()=>now});
 const config={enabled:true,imageChannel:'chatgpt-sub',world:'当前世界',rolesEnabled:false};
 const contextKey=deliveryContextKey(effectiveConfig(config));
 const rows=[
  {id:'today',type:'daily',day:'2026-11-15'},
  {id:'yesterday',type:'daily',day:'2026-11-14'},
  {id:'booking',type:'booking',day:'2026-11-14'},
  {id:'replaced-booking',type:'booking',day:'2026-11-14'},
  {id:'canceled',type:'daily',day:'2026-11-15',state:'canceled'},
  {id:'manual',type:'manual',day:'2026-11-15'},
  {id:'other-account',type:'story',day:'2026-11-15',executionConfig:{...config,imageChannel:'google-sub'}},
  {id:'different-world',type:'story',day:'2026-11-15',contextKey:'changed-world'},
  {id:'uncertain',type:'daily',day:'2026-11-15',errorCode:'SUBMISSION_UNCERTAIN'},
 ];
 for(const row of rows)await store.create({state:'error',errorCode:'SUBSCRIPTION_AUTH_REQUIRED',error:'需要重新登录',dueAt:'2026-11-15T12:00:00Z',contextKey,executionConfig:config,...row});
 const resumed=await recoverAuthorizedTasks({provider:'chatgpt-sub',config,taskStore:store,bookingId:'booking',now});
 assert.deepEqual(resumed.sort(),['booking','today']);
 for(const row of rows)assert.equal((await store.get(row.id)).state,resumed.includes(row.id)?'retrying':row.state||'error',row.id);
 assert.deepEqual(await recoverAuthorizedTasks({provider:'chatgpt-sub',config,taskStore:store,bookingId:'booking',now}),[]);
});

test('legacy 401 tasks recover after login while disabled daily jobs remain stopped',async()=>{
 const jobs=[{id:'daily',type:'daily',day:'2026-11-15',state:'error',error:'订阅登录或刷新失败（HTTP 401），请重新授权',executionConfig:{imageChannel:'chatgpt-sub'}},{id:'booking',type:'booking',state:'error',error:'订阅登录或刷新失败（HTTP 401），请重新授权',executionConfig:{imageChannel:'chatgpt-sub'}}];
 const retried=[];const store={list:async()=>jobs,retry:async id=>retried.push(id)};
 await recoverAuthorizedTasks({provider:'chatgpt-sub',config:{enabled:false,imageChannel:'chatgpt-sub'},taskStore:store,bookingId:'booking',now:new Date('2026-11-15T13:00:00Z')});
 assert.deepEqual(retried,['booking']);
});
