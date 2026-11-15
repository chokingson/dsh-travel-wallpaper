import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readPromptSkill,compilePrompt,generateWorld} from './prompt-skills.js';
import {createTripComposer} from './trip-composer.js';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('已审两份规范用于角色和观察写稿，世界创作不混入图像输出规范',async()=>{
 for(const role of [true,false]){
  const text=await readPromptSkill('text',role),reference=await readPromptSkill('reference',role);
  assert.match(text,/name: travel-text-to-image/);assert.match(reference,/name: travel-image-to-image/);
  for(const skill of [text,reference])assert.doesNotMatch(skill,/默认旅行事件保持简单|不要自行展开复杂战争|每次只画一件具体小事/);
  assert.doesNotMatch(text,/随机世界任务：按照调用方提供/);
 }
});

test('整理后的画面不再被旧剧情和旧预设二次追加覆盖，直接模式仍保留用户正文',async()=>{
 let task='';const llm={async *stream(request){task=request.messages[0].content[0].text;yield{type:'text-delta',text:'明确的新画面结果'};}};
 const config={rolesEnabled:true,world:'当前世界',characters:'角色甲',tripSource:'user',tripPrompt:'用户正文完整保留',textPrompt:'',style:'画风短句',rules:'旧设定只用于模型输入',imageToImage:false,textDensity:'none',usePromptSkills:true};
 const prompt=await compilePrompt(llm,{title:'当前事件',excerpt:'旧剧情不能再次强行追加'},config);
 assert.match(task,/用户正文完整保留/);assert.match(task,/旧剧情不能再次强行追加/);assert.match(prompt,/明确的新画面结果/);assert.doesNotMatch(prompt,/旧剧情不能再次强行追加|旧设定只用于模型输入/);
 const direct=await compilePrompt(null,{title:'自定义'}, {...config,usePromptSkills:false});assert.match(direct,/用户正文完整保留/);
});

test('旧随机接口与盲盒案例接口都加载独立世界规范',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'world-skill-'));let count=0;
 const llm={async *stream(request){const text=request.messages[0].content[0].text;assert.match(text,/name: travel-world-generation/);assert.doesNotMatch(text,/name: travel-text-to-image/);count++;
  const value=text.includes('这次只执行世界案例创作')?{world:'独立星环世界',timeTagId:'fiction',society:'星环居民',environment:'自由漂移的环带',worldRules:['环带周期转动'],themes:['星环']}: {topic:'新主题',world:'新世界',era:'架空',tags:'云层',characters:'角色甲',rules:'漂浮建筑',style:'二次元',textDensity:'none',textCarrier:'auto',textContent:'',textPrompt:'角色甲来到新世界'};
  yield{type:'text-delta',text:JSON.stringify(value)};
 }};
 try{await generateWorld(llm,{rolesEnabled:true},'新世界');await createTripComposer({dir,llm}).generate({rolesEnabled:true},'独立创作');assert.equal(count,2);}finally{await rm(dir,{recursive:true,force:true});}
});

test('已有行程时仍传入本次独立文字要求，关闭参考不携带图片要求',async()=>{
 let task='';const llm={async *stream(r){task=r.messages[0].content[0].text;yield{type:'text-delta',text:'整理后的画面'};}};
 const config={world:'云港',tripPrompt:'现有世界设定',tripSource:'user',characters:'甲',textPrompt:'本次站在钟楼顶端',imageToImage:false,referenceInstructions:'旧图站在河边',usePromptSkills:true};
 await compilePrompt(llm,{title:'本期',storyOutcome:{description:'角色已到钟楼'}},config);
 assert.match(task,/本次站在钟楼顶端/);assert.doesNotMatch(task,/旧图站在河边/);
 const direct=await compilePrompt(null,{title:'本期'}, {...config,usePromptSkills:false});assert.match(direct,/本次站在钟楼顶端/);
});
