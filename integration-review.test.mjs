import{test}from'node:test';import assert from'node:assert/strict';
import{mkdtemp,mkdir,writeFile,readFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{createServer}from'node:http';
import{writeStoryOutcome}from'./story-outcome.js';import{nextTripEvent}from'./trip-events.js';import{createDailyJob,apply}from'./index.js';
const pixel=Buffer.from('89504e470d0a1a0a','hex');
const capture=()=>{let payload;return{llm:{async *stream(r){const task=r.messages[0].content[0].text;payload=JSON.parse(task.slice(task.lastIndexOf('\n\n')+2));yield{type:'text-delta',text:'本次事件结果'};}},get payload(){return payload;}};};

test('新行程的空匹配历史不回退混入其它角色模式，明确文字和参考要求进入事件准备',async()=>{
 const config={world:'同名世界',tripSource:'user',tripPrompt:'新行程',tripGenerationId:'new',rolesEnabled:true,characters:'甲',rules:'钟声可以移动城市',textPrompt:'本次明确动作',imageToImage:true,referenceInstructions:'保留角色并打开旧门'};
 const history=[{day:'2026-11-10',state:'published',appliedAt:1000,recipe:{...config,tripGenerationId:'old',rolesEnabled:false},storyOutcome:{status:'committed',description:'其它行程世界已毁灭'}}];
 const c=capture();await writeStoryOutcome(c.llm,{publishedAt:'2026-11-11',worldEvent:nextTripEvent(config,history,'2026-11-11')},config,history);
 assert.deepEqual(c.payload.committedHistory,[]);assert.ok(JSON.stringify(c.payload).includes('本次明确动作'));assert.ok(JSON.stringify(c.payload).includes('保留角色并打开旧门'));assert.ok(JSON.stringify(c.payload).includes('钟声可以移动城市'));
});
test('无正式行程的默认旧配置也消费已执行指令，同世界不同角色历史隔离',async()=>{
 const config={world:'钥匙城',rolesEnabled:true,characters:'甲',interactionId:'once',interactionPrompt:'把钥匙投入河中'};
 const history=[{issueId:'first',day:'2026-11-11',state:'published',appliedAt:1000,recipe:config,storyOutcome:{status:'committed',description:'钥匙已入河',committedAt:1000}}];
 const c=capture();await writeStoryOutcome(c.llm,{publishedAt:'2026-11-11',worldEvent:{step:1,event:'旧版事件字段'}},config,history);assert.equal(c.payload.currentRequest,'');assert.equal(c.payload.committedHistory.length,1);
 const other=nextTripEvent({...config,characters:'乙'},history,'2026-11-11');assert.equal(other.historyEntries.length,0);
});
test('重新应用旧图不改变事件首次提交顺序',()=>{
 const config={world:'钥匙城',tripSource:'user',tripPrompt:'同一行程',characters:'甲'};
 const record=(id,time,description,appliedAt=time)=>({issueId:id,day:'2026-11-11',state:'published',appliedAt,recipe:config,storyOutcome:{status:'committed',description,committedAt:time}});
 const result=nextTripEvent(config,[record('A',1000,'旧事',3000),record('B',2000,'新事')],'2026-11-11');assert.deepEqual(result.historyEntries.map(r=>r.issueId),['A','B']);assert.equal(result.previousOutcome,'新事');
});
test('图库应用可完成已渲染事件，重复设图不改首次提交时间',async()=>{
 const home=await mkdtemp(join(tmpdir(),'apply-outcome-')),old=process.env.DSH_HOME,dir=join(home,'planet-news','issues'),id='2026-11-11-aabbccdd';let route;
 await mkdir(dir,{recursive:true});await writeFile(join(home,'planet-news','config.json'),JSON.stringify({enabled:false,newsBallEnabled:false,lettersEnabled:false,wallpaperMode:'windows',imageToImage:false,referenceSetupVersion:1}));
 await writeFile(join(dir,id+'.png'),pixel);await writeFile(join(dir,id+'.json'),JSON.stringify({day:'2026-11-11',issueId:id,state:'rendered',images:[{imageFile:id+'.png',storyOutcome:{id,status:'prepared',description:'门已打开'}}]}));
 process.env.DSH_HOME=home;apply({effect(fn,label){if(label==='planet-news: settings route')fn();},webServer:{register(r){route=r;return()=>{};}}},null,async()=>{},()=>({dispose(){}}),async()=>({state:'skipped'}));
 const server=createServer((req,res)=>route.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 try{const send=()=>fetch(base,{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({action:'apply',issueId:id})});assert.equal((await send()).status,200);let issue=JSON.parse(await readFile(join(dir,id+'.json'),'utf8'));assert.equal(issue.images[0].storyOutcome.status,'committed');const first=issue.images[0].storyOutcome.committedAt;assert.ok(first);assert.equal((await send()).status,200);issue=JSON.parse(await readFile(join(dir,id+'.json'),'utf8'));assert.equal(issue.images[0].storyOutcome.committedAt,first);}finally{await new Promise(r=>server.close(r));if(old===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=old;await rm(home,{recursive:true,force:true});}
});
test('新闻轮播去重仍统计历史批次中全部图片的素材来源',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'news-carousel-'));const stories=[1,2,3,4].map(n=>({title:'素材'+n,url:'https://example.org/'+n,publishedAt:'2026-11-10'}));
 await writeFile(join(dir,'2026-11-10.json'),JSON.stringify({day:'2026-11-10',issueId:'2026-11-10',state:'published',story:stories[0],images:[{story:stories[0]},{story:stories[1]}]}));const selected=[];
 const job=createDailyJob({dir,now:()=>new Date('2026-11-11T00:00:00Z'),collect:async()=>stories,writePrompt:async story=>{selected.push(story.url);return story.title;},render:async()=>pixel,publish:async()=>{}});
 try{await job.run({sourceMode:'bili-report',days:30,dailyCount:2});assert.deepEqual(selected,['https://example.org/3','https://example.org/4']);}finally{await rm(dir,{recursive:true,force:true});}
});
