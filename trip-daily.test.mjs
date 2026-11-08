import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDailyJob } from './index.js';
import { compilePrompt } from './prompt-skills.js';
import { createTripComposer } from './trip-composer.js';
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
test('内置/DSH行程换角色后使用当前角色，手写正文保留用户自己的角色要求',async()=>{
 const{pickWorldCase,worldCasePatch}=await import('./world-cases.js');
 const patch=worldCasePatch(pickWorldCase({caseId:'jurassic'}),{characters:'角色甲'});
 for(const tripSource of ['builtin','dsh']){
  const prompt=await compilePrompt(null,{title:'今日见闻'},{...patch,tripSource,characters:'角色乙',rolesEnabled:true,promptMode:'direct'});
  assert.doesNotMatch(prompt,/角色甲/);assert.match(prompt,/角色乙/);
 }
 const user=await compilePrompt(null,{title:'今日见闻'},{...patch,tripSource:'user',tripPrompt:'我要画角色甲与角色乙相遇',characters:'角色乙',rolesEnabled:true,promptMode:'direct'});assert.match(user,/角色甲与角色乙/);
});
test('确认行程经每日任务传给写稿器：连续三天推进同一矛盾，保留昨日选择且清除旧三国',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'trip-daily-'));let date=new Date('2026-11-09T00:00:00Z');const stories=[],prompts=[];let publications=0;
 try{
  const patch=await createTripComposer({dir,now:()=>new Date('2026-11-08T00:00:00Z')}).confirm({rolesEnabled:true,characters:'大肥鱼'},{caseId:'asteroid-eve'});
  const config={...patch,rolesEnabled:true,characters:'大肥鱼',dailyCount:1,diaryEnabled:false,usePromptSkills:true,promptMode:'llm',textProvider:'test',textModel:'test',width:1920,height:1080};
  const job=createDailyJob({dir,now:()=>date,collect:async()=>{throw Error('不能抓新闻');},writePrompt:async(story,recipe,history)=>{
   stories.push(story);assert.doesNotMatch(JSON.stringify({recipe,story}),/旧三国|汉末三国/);
   return compilePrompt({async *stream(request){const task=request.messages[0].content[0].text;assert.match(task,/主要矛盾|陨石/);yield{type:'text-delta',text:'大肥鱼决定帮助幼龙，建立临时避难地，今日继续修缮屋顶。'};}},story,recipe,history);
  },render:async prompt=>{prompts.push(prompt);return pixel;},publish:async()=>{publications++;}});
  for(let i=0;i<3;i++){await job.run(config);date=new Date(date.getTime()+86400000);}
  assert.deepEqual(stories.map(s=>s.worldEvent.step),[0,1,2]);
  assert.equal(new Set(stories.map(s=>s.worldEvent.event)).size,3);
  assert.match(stories[1].worldEvent.previousScene,/帮助幼龙/);
  assert.match(prompts[2],/第3次不同日期见闻/);assert.equal(publications,3);
 }finally{await rm(dir,{recursive:true,force:true});}
});
