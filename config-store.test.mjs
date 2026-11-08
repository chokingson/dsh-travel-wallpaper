import{test}from'node:test';import assert from'node:assert/strict';import{createConfigMutator}from'./config-store.js';
test('不同来源的异步配置修改顺序读取最新状态，不覆盖刚写入的新世界或下载目录',async()=>{
 let value={world:'旧世界',downloadDirectory:'旧目录',newsBallEnabled:true},release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);
 const mutate=createConfigMutator({read:async()=>({...value}),write:async next=>{value=next;}});
 const first=mutate(async current=>{entered();await gate;return{...current,world:'新世界'};});await started;
 const second=mutate(current=>({...current,downloadDirectory:'新目录'})),third=mutate(current=>({...current,newsBallEnabled:false}));release();await Promise.all([first,second,third]);assert.deepEqual(value,{world:'新世界',downloadDirectory:'新目录',newsBallEnabled:false});
 await assert.rejects(mutate(()=>{throw Error('bad change');}));await mutate(current=>({...current,world:'另一个世界'}));assert.equal(value.downloadDirectory,'新目录');
});
