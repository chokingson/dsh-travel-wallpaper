import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTaskStore,scheduleAt,scheduleDay,nextDailyTime} from './scheduled-tasks.js';

async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'scheduled-task-'));t.after(()=>rm(directory,{recursive:true,force:true}));let clock=new Date('2026-11-11T22:00:00Z');const args={directory,now:()=>clock};return {store:createTaskStore(args),restart:()=>createTaskStore(args),time:at=>{clock=new Date(at);}};}
test('内部恢复可读取全部任务，不被界面200条历史上限截断',async t=>{
 const f=await fixture(t);for(let i=0;i<202;i++)await f.store.create({id:'gift-'+i,type:'specialty',dueAt:'2026-11-11T22:00:00Z'});
 assert.equal((await f.store.list({limit:1000})).length,200);assert.equal((await f.store.list({all:true,type:'specialty'})).length,202);
});
test('任务失败3分钟后重试，最多重试3次；新任务不覆盖旧错误历史',async t=>{
 const f=await fixture(t);await f.store.create({id:'booking-one',type:'booking',dueAt:'2026-11-11T22:00:00Z'});
 for(let attempt=1;attempt<=4;attempt++){
  const claimed=await f.store.claim('booking-one');assert.equal(claimed.attempts,attempt);
  await f.store.progress('booking-one',{stage:'applying',issueId:'2026-11-12-aabbccdd'});
  await f.store.fail('booking-one',Error('failed Bearer SECRET https://service.test?access_token=TOKEN'));
  const failed=await f.store.get('booking-one');assert.equal(failed.state,attempt<4?'retrying':'error');
  assert.equal(await f.store.claim('booking-one'),null);f.time(new Date(Date.parse(failed.lastFailedAt)+180000).toISOString());
 }
 await f.store.create({id:'booking-two',type:'booking',dueAt:'2026-11-11T22:00:00Z'});
 const old=await f.store.get('booking-one');assert.equal(old.attempts,4);assert.equal(old.issueId,'2026-11-12-aabbccdd');assert.ok(old.events.filter(e=>e.event==='failed').length===4);assert.doesNotMatch(JSON.stringify(old),/SECRET|TOKEN/);assert.equal((await f.store.list()).length,2);
});
test('重启恢复原任务，不重复领取；取消后旧完成不能复活',async t=>{
 const f=await fixture(t);await f.store.create({id:'daily-2026-11-12',type:'daily',dueAt:'2026-11-11T22:00:00Z'});
 assert.equal((await Promise.all([f.store.claim('daily-2026-11-12'),f.store.claim('daily-2026-11-12')])).filter(Boolean).length,1);
 await f.store.progress('daily-2026-11-12',{stage:'image',issueId:'2026-11-12-11112222',executionConfig:{world:'old world'}});
 const next=f.restart();const resumed=await next.claim('daily-2026-11-12');assert.equal(resumed.attempts,1);assert.equal(resumed.executionConfig.world,'old world');assert.equal(await next.claim(resumed.id),null);
 await next.cancel(resumed.id);await next.complete(resumed.id,{issueId:'late'});assert.equal((await next.get(resumed.id)).state,'canceled');assert.equal(await next.claim(resumed.id),null);
});
test('已接受远端排队持续查询，不耗尽失败次数；不明订阅提交不自动重发',async t=>{
 const f=await fixture(t);await f.store.create({id:'queued',type:'daily',dueAt:'2026-11-11T22:00:00Z'});await f.store.claim('queued');
 for(let i=0;i<6;i++){await f.store.fail('queued',Object.assign(Error('still queued'),{code:'REMOTE_PENDING'}));const state=await f.store.get('queued');assert.equal(state.state,'waiting-remote');f.time(state.nextRetryAt);assert.equal((await f.store.claim('queued')).attempts,1);}
 await f.store.fail('queued',Object.assign(Error('accepted but no response'),{code:'SUBMISSION_UNCERTAIN'}));assert.equal((await f.store.get('queued')).state,'needs-attention');f.time('2026-11-20T00:00:00Z');assert.equal(await f.store.claim('queued'),null);
});
test('每日时间与预约统一中国时区，06点前等待、错过后补今天',()=>{
 assert.equal(scheduleDay(new Date('2026-11-11T18:00:00Z')),'2026-11-12');
 assert.equal(scheduleAt('2026-11-12',6),'2026-11-11T22:00:00.000Z');
 assert.equal(nextDailyTime({enabled:true,hour:6},new Date('2026-11-11T21:59:00Z')),'2026-11-11T22:00:00.000Z');
 assert.equal(nextDailyTime({enabled:true,hour:6},new Date('2026-11-11T23:00:00Z')),'2026-11-11T23:00:00.000Z');
 assert.equal(nextDailyTime({enabled:true,hour:20},new Date('2026-11-11T23:00:00Z')),'2026-11-12T12:00:00.000Z');
 assert.equal(nextDailyTime({enabled:true,hour:6},new Date('2026-11-11T23:00:00Z'),{state:'completed'}),'2026-11-12T22:00:00.000Z');
 assert.equal(nextDailyTime({enabled:true,hour:6},new Date('2026-11-11T23:00:00Z'),{state:'error'}),'2026-11-12T22:00:00.000Z');
 assert.equal(nextDailyTime({enabled:false,hour:6},new Date()),null);
});
