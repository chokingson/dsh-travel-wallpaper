import{test}from'node:test';import assert from'node:assert/strict';
import{mkdtemp,rm,readFile}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
import{createDailyJob}from'./index.js';
import{writeStoryOutcome,nextDayRules}from'./story-outcome.js';
import{writeTravelDiary}from'./diary.js';import{writeWorldNews}from'./delivery.js';
const pixel=Buffer.from('89504e470d0a1a0a','hex');

test('multi-role outcome distinguishes travelling party from explicitly depicted members',async()=>{
 const party=[{id:'a',name:'甲',description:'蓝发',persona:'好奇',addressee:'用户',referenceId:''},{id:'b',name:'乙',description:'白发',persona:'沉静',addressee:'朋友',referenceId:''}],story={publishedAt:'2026-11-11'};let request;
 const llm={async *stream(input){request=input;yield{type:'text-delta',text:JSON.stringify({description:'乙独自在码头修好了一只旧钟。',depictedMemberIds:['b']})};}};
 const result=await writeStoryOutcome(llm,story,{rolesEnabled:true,party,world:'港口',textPrompt:'本次只画乙，甲不出镜'},[]);
 assert.equal(result,'乙独自在码头修好了一只旧钟。');assert.deepEqual(story.depictedMemberIds,['b']);assert.match(JSON.stringify(request),/本次只画乙/);
 const invalid={async *stream(){yield{type:'text-delta',text:'未按协议返回成员'};}};await assert.rejects(writeStoryOutcome(invalid,{publishedAt:'2026-11-11'},{rolesEnabled:true,party,world:'港口'},[]),/事件|出镜|格式/);
});

test('次日三类定义完整保留；续写只准备本次结果，不把候选当历史',async()=>{
 assert.deepEqual(nextDayRules.map(x=>x.id),['A','B','C']);assert.match(nextDayRules[1].definition,/人、事、生物、死物、现象、地形、场地、液体、固体、气体/);assert.match(nextDayRules[2].definition,/有关、无关.*好事、坏事、惊喜、惊吓/);
 let task='';const result=await writeStoryOutcome({async *stream(r){task=r.messages[0].content[0].text;yield{type:'text-delta',text:'角色将遗失的钥匙交回管理员，管理员打开了原本封闭的门。'};}},{publishedAt:'2026-11-11',worldEvent:{historyEntries:[{day:'2026-11-10',storyOutcome:'角色昨日捡到钥匙'}],currentRequest:'继续探索'}},{world:'钥匙城',characters:'角色甲'},[]);
 assert.match(result,/封闭的门/);assert.match(task,/name: travel-story-continuation/);assert.match(task,/角色昨日捡到钥匙/);assert.doesNotMatch(task,/默认旅行事件保持简单|每次只画一件具体小事/);
});

test('事件结果在应用后才提交，生成与应用失败重试沿用原事件，同次日记读取同份事实',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'shared-outcome-'));let events=0,renders=0,applies=0,fail=true,picture;
 const job=createDailyJob({dir,now:()=>new Date('2026-11-11T00:00:00Z'),collect:async()=>[],writeEvent:async()=>{events++;return'角色找回钥匙并打开大门';},writePrompt:async story=>{assert.equal(story.storyOutcome.description,'角色找回钥匙并打开大门');return'画面：钥匙与打开的大门';},render:async()=>{renders++;return pixel;},publish:async()=>{applies++;if(fail)throw Error('应用失败');},writeDiary:async p=>{picture=p;return{text:'用户，门开了。',addressee:'用户'};}});
 const config={world:'钥匙城',characters:'角色甲',sourceMode:'world',dailyCount:1,imageToImage:true,diaryEnabled:true};
 try{await assert.rejects(job.run(config),/应用失败/);let data=JSON.parse(await readFile(join(dir,'latest.json'),'utf8'));assert.equal(data.storyOutcome.status,'prepared');fail=false;await job.run(config);data=JSON.parse(await readFile(join(dir,'latest.json'),'utf8'));assert.equal(events,1);assert.equal(renders,1);assert.equal(applies,2);assert.equal(data.storyOutcome.status,'committed');assert.equal(picture.storyOutcome.id,data.storyOutcome.id);}finally{await rm(dir,{recursive:true,force:true});}
});

test('见闻与日记优先复用同份已提交事件，不拿旧画面另写剧情',async()=>{
 const picture={world:'钥匙城',prompt:'旧画面是下雨',story:{character:'角色甲'},storyOutcome:{id:'issue1',status:'committed',description:'角色已打开大门'}};let diaryTask='',newsTask='';
 await writeTravelDiary({async *stream(r){diaryTask=r.messages[0].content[0].text;yield{type:'text-delta',text:'用户，大门已经打开。'};}},picture,{diaryTitle:'用户'});
 await writeWorldNews({async *stream(r){newsTask=r.messages[0].content[0].text;yield{type:'text-delta',text:JSON.stringify({headline:'门开了',summary:'角色已打开大门。'})};}},picture,{});
 assert.match(diaryTask,/角色已打开大门/);assert.match(newsTask,/角色已打开大门/);assert.doesNotMatch(diaryTask,/旧画面是下雨/);assert.doesNotMatch(newsTask,/旧画面是下雨/);
});
