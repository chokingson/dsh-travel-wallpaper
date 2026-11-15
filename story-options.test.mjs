import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
const context={scopeKey:'world-and-party',version:'issue-1',valid:true,world:'云港',party:[],storyOutcome:'云港今天开放了新的渡口。'};
async function fixture(t){const {createStoryOptions}=await import('./story-options.js');const dir=await mkdtemp(join(tmpdir(),'story-options-'));t.after(()=>rm(dir,{recursive:true,force:true}));let current={...context},accepted=0,booking=null,clock=new Date('2026-11-11T01:00:00Z'),prompts=[];
 const args={directory:dir,getContext:async()=>current,getConfig:async()=>({hour:20}),getBooking:async()=>booking,now:()=>clock,
  write:async prompt=>{prompts.push(prompt);return JSON.stringify({choices:[{id:'A',text:'前往刚刚开放的渡口查看航线。'},{id:'B',text:'留在候船厅与售票员交谈。'},{id:'C',text:'港口的钟忽然逆向转动。'}]});},
  accept:async value=>{accepted++;return{taskId:value.taskId,state:'running'};},taskStatus:async taskId=>({taskId,state:'running'})};
 return{service:createStoryOptions(args),restart:()=>createStoryOptions(args),setContext:value=>{current=value;},setBooking:value=>{booking=value;},prompts,get accepted(){return accepted;}};
}
test('today choices use committed current plot with no positive/negative outcome presets; tomorrow keeps full hidden rules',async t=>{
 const f=await fixture(t);const today=await f.service.prepare('today');assert.equal(today.choices.length,3);assert.ok(!('name'in today.choices[0]));assert.match(f.prompts[0],/云港今天开放/);assert.doesNotMatch(f.prompts[0],/善良|邪恶|探索|停留|好事|坏事|正向|负向|反向/);
 await f.service.prepare('tomorrow');assert.match(f.prompts[1],/液体、固体、气体/);assert.match(f.prompts[1],/有关、无关/);
});
test('同时打开同一剧情只生成一次候选，失败后允许重新请求',async t=>{
 const f=await fixture(t);const [a,b]=await Promise.all([f.service.prepare('today'),f.restart().prepare('today')]);assert.deepEqual(a,b);assert.equal(f.prompts.length,1);
});
test('same submission id is idempotent across restart, conflicting source and stale options rejected',async t=>{
 const f=await fixture(t),options=await f.service.prepare('today');const input={kind:'today',version:options.version,scopeKey:options.scopeKey,source:'option',choice:'A',requestId:'request-1'};
 const result=await f.service.submit(input);assert.equal(result.state,'running');await f.restart().submit(input);assert.equal(f.accepted,1);
 await assert.rejects(f.service.submit({...input,requestId:'request-2',text:'混入草稿'}),/互斥|只能/);
 f.setContext({...context,version:'issue-2'});await assert.rejects(f.service.submit({...input,requestId:'request-3'}),/已更新/);
});
test('tomorrow persists full text and actual date/time, failed edit leaves original plan, reset only commits on submit',async t=>{
 const f=await fixture(t),options=await f.service.prepare('tomorrow');const saved=await f.service.submit({kind:'tomorrow',version:options.version,scopeKey:options.scopeKey,source:'option',choice:'B',requestId:'plan-1'});
 assert.equal(saved.plan.text,options.choices[1].text);assert.equal(saved.plan.day,'2026-11-12');assert.equal(saved.plan.hour,20);assert.equal(saved.plan.version,'issue-1');
 await assert.rejects(f.service.submit({kind:'tomorrow',version:'old',scopeKey:options.scopeKey,source:'custom',text:'新计划',requestId:'plan-2'}),/已更新/);
 assert.equal((await f.restart().current()).plan.text,saved.plan.text);
 assert.equal((await f.service.forRun(context.scopeKey,'2026-11-12')).text,saved.plan.text);
 await f.service.submit({kind:'tomorrow',version:options.version,scopeKey:options.scopeKey,source:'random',requestId:'plan-3'});assert.equal((await f.service.current()).plan,null);
});
test('custom is one complete request, options failure still permits custom; pending blindbox conflicts are visible',async t=>{
 const f=await fixture(t);const submitted=await f.service.submit({kind:'today',version:context.version,scopeKey:context.scopeKey,source:'custom',text:'A离港，B又回来；或者C停留。',requestId:'custom-1'});assert.equal(submitted.state,'running');assert.equal(f.accepted,1);
 f.setBooking({day:'2026-11-12',state:'booked'});await assert.rejects(f.service.submit({kind:'tomorrow',version:context.version,scopeKey:context.scopeKey,source:'custom',text:'去渡口',requestId:'conflict'}),/盲盒/);
 f.setContext({...context,valid:false});await assert.rejects(f.service.prepare('today'),/当前剧情/);
});
