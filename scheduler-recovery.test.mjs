import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {apply} from './index.js';
import {deliveryContextKey} from './delivery.js';
import {effectiveConfig} from './mode-config.js';
import sharp from 'sharp';
const pixel=await sharp({create:{width:8,height:8,channels:3,background:'#aaccff'}}).png().toBuffer();
async function fixture(t,{publishFail=0,newsFail=0,worldGate=null,newsGate=null,renderAuthFail=0}={}){
 const home=await mkdtemp(join(tmpdir(),'travel-scheduler-')),prior=process.env.DSH_HOME;process.env.DSH_HOME=home;
 const dir=join(home,'planet-news');await mkdir(dir,{recursive:true});let config={enabled:false,hour:6,wallpaperMode:'windows',imageChannel:'chatgpt-sub',imageToImage:false,rolesEnabled:true,characters:'测试角色',world:'当前世界',referenceSetupVersion:1,lettersEnabled:false,newsBallEnabled:false,usePromptSkills:false,syncLockScreen:false};await writeFile(join(dir,'config.json'),JSON.stringify(config));
 let route,tick,authorized,clock=new Date('2026-11-11T22:01:00Z'),rendered=0,published=0,worlds=0,news=0;const stops=[];
 const start=()=>apply({effect(fn){const stop=fn();if(typeof stop==='function')stops.push(stop);},webServer:{register(r){route=r;return()=>{};}},llm:{listProviders:()=>[{id:'deepseek-account'}],async *stream(r){const task=r.messages[0].content[0].text;let text='当前画面';if(task.includes('为旅行壁纸准备')){text=JSON.stringify({choices:[{id:'A',text:'抵达港口的钟楼'},{id:'B',text:'留在茶馆与掌柜交谈'},{id:'C',text:'屋顶传来一道奇怪的回声'}]});}else if(task.includes('这次只执行世界案例创作')){worlds++;if(worldGate)await worldGate; text=JSON.stringify({world:'新世界'+worlds,timeTagId:'ce2149',society:'公共港口',themes:['旅行'],conflict:'寻找旧信',tone:'开放',direction:'逐步探索',opening:'邮船抵达',beats:['读信','远行','到达'],roleChoice:'自由决定'});}else if(task.includes('简报编辑')){news++;if(newsGate)await newsGate;if(newsFail-->0)throw Error('news unavailable');text=JSON.stringify({headline:'世界消息',summary:'居民收到了新的信件。'});}yield{type:'text-delta',text};}}},null,async()=>{published++;if(publishFail-->0)throw Error('desktop failed');},()=>({sync:async()=>{},dispose(){},status:()=>({}),authorized:()=>false}),async()=>({state:'disabled'}),async()=>{rendered++;if(renderAuthFail-->0)throw Object.assign(Error('subscription login expired'),{code:'SUBSCRIPTION_AUTH_REQUIRED',beforeSubmission:true});return pixel;},{now:()=>clock,onScheduler:fn=>{tick=fn;},onAuthorizationRecovery:fn=>{authorized=fn;}});
 start();const server=createServer((req,res)=>route.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const get=async query=>(await fetch(origin+'/api/planet-news'+(query||''))).json();
 const post=async body=>{const{writeToken}=await get('?clientSession');const r=await fetch(origin+'/api/planet-news',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...body,clientToken:writeToken})});return{http:r.status,...await r.json()};};
 const wait=async predicate=>{let data;for(let i=0;i<200;i++){data=await get();if(predicate(data))return data;await new Promise(r=>setTimeout(r,5));}throw Error('task did not settle '+JSON.stringify({status:data?.status,scheduling:data?.scheduling}));};
 const tasks=async()=>{const files=await readdir(join(dir,'tasks')).catch(()=>[]);return Promise.all(files.filter(n=>n.endsWith('.json')).map(n=>readFile(join(dir,'tasks',n),'utf8').then(JSON.parse)));};
 t.after(async()=>{for(const stop of stops.splice(0).reverse())stop();await new Promise(r=>server.close(r));if(prior===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=prior;await rm(home,{recursive:true,force:true,maxRetries:5,retryDelay:20});});
 await get();return {get,post,wait,tasks,dir,authorized:provider=>authorized(provider),stats:()=>({rendered,published,worlds,news}),tick:()=>tick(),clock:at=>{clock=new Date(at);},configure:async patch=>{config={...JSON.parse(await readFile(join(dir,'config.json'),'utf8')),...patch};await writeFile(join(dir,'config.json'),JSON.stringify(config));},restart:()=>{for(const stop of stops.splice(0).reverse())stop();start();}};
}
test('每日失败后3分钟只重试应用，消息失败只重试消息，重启不重复生成',async t=>{
 const f=await fixture(t,{publishFail:1,newsFail:1});await f.configure({enabled:true});await f.tick();await f.wait(d=>d.status.state==='retrying'&&d.scheduling?.daily?.state==='retrying');
 assert.deepEqual(f.stats(),{rendered:1,published:1,worlds:0,news:0});
 await f.tick();assert.equal(f.stats().published,1);
 f.clock('2026-11-11T22:04:00Z');await f.tick();await f.wait(d=>d.status.state==='retrying'&&d.scheduling?.daily?.state==='retrying'&&d.scheduling.daily.attempts===2);assert.equal(f.stats().rendered,1);assert.equal(f.stats().published,2);
 f.clock('2026-11-11T22:07:00Z');await f.tick();await f.wait(d=>d.status.state==='published'&&d.scheduling?.daily?.state==='completed');assert.equal(f.stats().rendered,1);assert.equal(f.stats().published,2);assert.equal(f.stats().news,2);
 f.restart();await f.tick();await f.get();assert.equal(f.stats().rendered,1);assert.equal((await f.tasks()).filter(x=>x.type==='daily').length,1);
});
test('手动成图不冒充每日完成；取消预约后下一天每日正常执行',async t=>{
 const f=await fixture(t);assert.equal((await f.post({action:'run'})).http,202);await f.wait(d=>d.status.state==='published');assert.equal(f.stats().rendered,1);
 await f.configure({enabled:true});await f.tick();await f.wait(d=>d.status.state==='published'&&d.scheduling?.daily?.state==='completed');assert.equal(f.stats().rendered,2);
 await f.post({action:'book-travel'});await f.post({action:'cancel-travel-booking'});f.clock('2026-11-12T22:01:00Z');await f.tick();await f.wait(d=>d.scheduling?.daily?.day==='2026-11-13'&&d.scheduling.daily.state==='completed');assert.equal(f.stats().rendered,3);assert.ok((await f.tasks()).some(x=>x.type==='booking'&&x.state==='canceled'));
});
test('预约世界创作过程中可取消，晚到结果不会保存配置或生图',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,{worldGate:gate});const booking=await f.post({action:'book-travel'});f.clock(booking.booking.dueAt);await f.tick();await f.wait(d=>d.status.stage==='world'&&f.stats().worlds>0);assert.equal((await f.post({action:'cancel-travel-booking'})).http,200);release();await f.wait(d=>d.status.state==='canceled');assert.equal(f.stats().rendered,0);assert.equal((await f.get()).config.world,'当前世界');
 f.restart();await f.tick();assert.equal(f.stats().rendered,0);assert.equal((await f.tasks()).find(x=>x.type==='booking').state,'canceled');
});

for(const committed of [false,true])test('预约目的地检查点恢复，不重抽世界：'+(committed?'偏好已提交':'偏好尚未提交'),async t=>{
 const f=await fixture(t);const {booking}=await f.post({action:'book-travel'}),config=(await f.get()).config;
 const patch={world:'已保存目的地',tripPrompt:'已保存的行程',tripSource:'dsh',tripGenerationId:'saved-world'};const execution={...config,...patch};
 const file=join(f.dir,'tasks',booking.id+'.json'),saved=JSON.parse(await readFile(file,'utf8'));
 Object.assign(saved,{state:'running',sessionId:'previous-runtime',ownerPid:99999999,attempts:1,stage:'world',issueId:'2026-11-13-1234abcd',contextKey:deliveryContextKey(effectiveConfig(config)),preparedContextKey:deliveryContextKey(effectiveConfig(execution)),executionConfig:execution,executionPatch:patch});await writeFile(file,JSON.stringify(saved));
 if(committed)await f.configure(patch);f.clock(booking.dueAt);await f.tick();await f.wait(d=>d.status.state==='published'&&d.booking.state==='completed');assert.equal(f.stats().worlds,0);assert.equal(f.stats().rendered,1);assert.equal((await f.get()).config.world,'已保存目的地');
});
test('跨午夜恢复昨天已经成图的消息，不重新生成或应用',async t=>{
 const f=await fixture(t,{newsFail:1});f.clock('2026-11-12T15:59:00Z');await f.configure({enabled:true,hour:23});await f.tick();const failed=await f.wait(d=>d.status.state==='retrying'&&d.scheduling?.daily?.stage==='briefing');assert.equal(f.stats().rendered,1);assert.equal(f.stats().published,1);
 f.clock('2026-11-12T16:02:00Z');f.restart();await f.tick();await f.wait(d=>d.status.state==='published'&&d.status.action==='automatic'&&f.stats().news===2);const old=(await f.tasks()).find(t=>t.id==='daily-2026-11-12');assert.equal(old.state,'completed');assert.equal(f.stats().rendered,1);assert.equal(f.stats().published,1);assert.equal(f.stats().news,2);
});
test('迁移旧版当天每日成功记录，不因升级重复生图',async t=>{
 const f=await fixture(t);await mkdir(join(f.dir,'issues'),{recursive:true});await writeFile(join(f.dir,'issues','2026-11-12.json'),JSON.stringify({day:'2026-11-12',issueId:'2026-11-12',state:'published',appliedAt:Date.parse('2026-11-11T22:00:00Z')}));await f.configure({enabled:true});await f.tick();const daily=(await f.tasks()).find(t=>t.id==='daily-2026-11-12');assert.equal(daily.state,'completed');assert.equal(daily.migrated,true);assert.equal(f.stats().rendered,0);
});
test('四次失败停止重试，后日仍可正常创建每日任务',async t=>{
 const f=await fixture(t,{publishFail:4});await f.configure({enabled:true});for(let i=0;i<4;i++){f.clock(new Date(Date.parse('2026-11-11T22:01:00Z')+i*180000).toISOString());await f.tick();await f.wait(d=>d.status.state===(i<3?'retrying':'error')&&d.scheduling?.daily?.attempts===i+1);}
 assert.equal(f.stats().rendered,1);assert.equal(f.stats().published,4);f.clock('2026-11-12T22:01:00Z');await f.tick();await f.wait(d=>d.status.state==='published'&&d.scheduling.daily.day==='2026-11-13');assert.equal(f.stats().rendered,2);assert.equal(f.stats().published,5);
});

test('重新登录后当前每日任务接续原稿，受理一次，不重建每日任务',async t=>{
 const f=await fixture(t,{renderAuthFail:4});await f.configure({enabled:true});
 for(let i=0;i<4;i++){await new Promise(resolve=>setTimeout(resolve,10));f.clock(new Date(Date.parse('2026-11-11T22:01:00Z')+i*180000).toISOString());await f.tick();await f.wait(d=>d.scheduling?.daily?.attempts===i+1&&d.scheduling.daily.state===(i<3?'retrying':'error'));}
 const failed=(await f.tasks()).find(task=>task.type==='daily');assert.equal(failed.errorCode,'SUBSCRIPTION_AUTH_REQUIRED');
 assert.deepEqual(await f.authorized('chatgpt-sub'),[failed.id]);
 await f.wait(d=>d.scheduling?.daily?.state==='completed');
 const tasks=(await f.tasks()).filter(task=>task.type==='daily');assert.equal(tasks.length,1);assert.equal(tasks[0].issueId,failed.issueId);assert.equal(f.stats().published,1);
 assert.deepEqual(await f.authorized('chatgpt-sub'),[]);assert.equal(f.stats().published,1);
});

test('取消简报投递后，忽略取消信号的晚到文本也不会写入消息',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,{newsGate:gate});const {booking}=await f.post({action:'book-travel'});f.clock(booking.dueAt);await f.tick();await f.wait(d=>d.status.stage==='briefing'&&f.stats().news>0);
 assert.equal((await f.post({action:'cancel-travel-booking'})).http,200);await f.wait(d=>d.status.state==='canceled');release();await new Promise(r=>setImmediate(r));const news=await readFile(join(f.dir,'delivery/news/latest.json'),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});assert.equal(news,null);assert.equal(f.stats().rendered,1);assert.equal(f.stats().published,1);
});
test('世界创作期间切换行程，旧预约不能覆盖新选择或应用图片',async t=>{
 let release;const gate=new Promise(r=>release=r);const f=await fixture(t,{worldGate:gate});const {booking}=await f.post({action:'book-travel'});f.clock(booking.dueAt);await f.tick();await f.wait(d=>d.status.stage==='world'&&f.stats().worlds>0);await f.configure({world:'用户新行程'});release();await f.wait(d=>d.status.state==='canceled');assert.equal((await f.get()).config.world,'用户新行程');assert.equal(f.stats().rendered,0);assert.equal(f.stats().published,0);
});


test('今日剧情同一请求只生成一次，次日保存完整剧情并在真实配置时间补执行',async t=>{
 const f=await fixture(t);await f.post({action:'run'});await f.wait(data=>data.status.state==='published');
 const context=await f.get('?storyContext');assert.equal(context.valid,true);
 const options=await f.post({action:'story-options',kind:'today'});assert.equal(options.choices.length,3);
 const input={action:'story-continue',kind:'today',scopeKey:context.scopeKey,version:context.version,source:'option',choice:'B',requestId:'today-once'};
 const accepted=await f.post(input);assert.equal(accepted.http,202);await f.wait(data=>data.status.state==='published'&&data.status.issueId===accepted.issueId);
 const after=f.stats().rendered;assert.equal((await f.post(input)).taskId,accepted.taskId);assert.equal(f.stats().rendered,after);
 assert.equal((await f.get('?storyStatus=today-once')).state,'completed');
 const latest=await f.get('?storyContext');await f.configure({hour:20,enabled:true});
 const saved=await f.post({action:'story-continue',kind:'tomorrow',scopeKey:latest.scopeKey,version:latest.version,source:'custom',text:'次日探索港口的另一边。',requestId:'tomorrow-plan'});
 assert.equal(saved.http,202);assert.equal(saved.plan.hour,20);assert.equal(saved.plan.day,'2026-11-13');
 assert.equal((await f.post({action:'book-travel'})).http,409);
 f.clock('2026-11-13T12:05:00Z');f.restart();await f.tick();await f.wait(data=>data.scheduling?.daily?.state==='completed');
 const task=(await f.tasks()).find(task=>task.type==='daily'&&task.day==='2026-11-13');assert.equal(task.executionConfig.nextDayPlan.text,'次日探索港口的另一边。');
 assert.equal((await f.get('?storyContext')).plan,null);
});
test('返回旧世界时剧情可越过其他60次旅行；损坏旧档案不会阻塞读取',async t=>{
 const f=await fixture(t);await f.post({action:'run'});await f.wait(data=>data.status.state==='published');const before=await f.get('?storyContext');assert.equal(before.valid,true);
 for(let i=0;i<65;i++){const issueId='2026-11-12-'+i.toString(16).padStart(8,'0');await writeFile(join(f.dir,'issues',issueId+'.json'),JSON.stringify({day:'2026-11-12',issueId,state:'published',createdAt:Date.now()+i,recipe:{world:'别的世界'+i},storyOutcome:{status:'committed',description:'其他行程'}}));}
 await writeFile(join(f.dir,'issues/2025-01-01.json'),'{invalid');const after=await f.get('?storyContext');assert.equal(after.valid,true);assert.equal(after.issueId,before.issueId);
});
test('壁纸成功后收藏队列暂不可写，重启会补建任务且不重画壁纸',async t=>{
 const f=await fixture(t);await mkdir(join(f.dir,'collections'),{recursive:true});const blocker=join(f.dir,'collections/tasks');await rmdir(blocker).catch(error=>{if(error.code!=='ENOENT')throw error;});await writeFile(blocker,'temporary blocker');
 await f.post({action:'run'});await f.wait(data=>data.status.state==='published');const renders=f.stats().rendered;
 await rm(blocker);f.restart();await f.tick();let queued=[];
 for(let i=0;i<60;i++){queued=await readdir(blocker).catch(()=>[]);if(queued.some(name=>name.endsWith('.json')))break;await new Promise(resolve=>setTimeout(resolve,10));}
 assert.ok(queued.some(name=>name.endsWith('.json')));assert.equal(f.stats().rendered,renders);
});
