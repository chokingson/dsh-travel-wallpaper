import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,readFile,readdir,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{createDailyJob}from'./index.js';
test('同一天每次制作独立整理当前画面，不再冻结当天剧情',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'carrier-key-')),prompts=[];let writes=0;const config={sourceMode:'world',world:'云港',textCarrier:'custom',textDensity:'rich',characters:'DS大肥鱼',imageToImage:true,referenceId:'builtin-deepseek',diaryEnabled:false};
 try{const job=createDailyJob({dir,now:()=>new Date('2026-11-08T00:00:00Z'),collect:async()=>[],writePrompt:async(story,recipe)=>{writes++;return recipe.carrierInstructions;},render:async prompt=>{prompts.push(prompt);return Buffer.from('89504e470d0a1a0a','hex');},publish:async()=>{}});
  const first=await job.run({...config,carrierInstructions:'石壁刻字'},{force:true});const second=await job.run({...config,carrierInstructions:'全息显示器'},{force:true});assert.deepEqual(prompts,['石壁刻字','全息显示器']);assert.equal(writes,2);assert.notEqual(first.narrativeId,second.narrativeId);assert.equal((await readdir(join(dir,'daily'))).filter(n=>n.endsWith('.json')).length,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('同一天三次明确制作各写新稿与便笺，重启不恢复一天一次限制',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'daily-once-'));let writes=0,diaries=0,renders=0,day=new Date('2026-11-08T00:00:00Z');
 const deps={dir,now:()=>day,collect:async()=>[],writePrompt:async()=>{writes++;return'一起找回丢失的雨伞';},writeDiary:async()=>{diaries++;return{text:'主人，雨伞找到了！',addressee:'主人'};},render:async()=>{renders++;return Buffer.from('89504e470d0a1a0a','hex');},publish:async()=>{}};
 const config={sourceMode:'world',world:'雨港',characters:'DS大肥鱼',imageToImage:true,referenceId:'builtin-deepseek',diaryEnabled:true,dailyCount:1};
 try{let job=createDailyJob(deps);await job.run(config,{force:true});await job.run(config,{force:true});job=createDailyJob(deps);await job.run(config,{force:true});assert.equal(renders,3);assert.equal(writes,3);assert.equal(diaries,3);
  const ledgers=(await readdir(join(dir,'daily'))).filter(n=>n.endsWith('.json'));assert.equal(ledgers.length,3);const ledger=JSON.parse(await readFile(join(dir,'daily',ledgers[0]),'utf8'));assert.equal(ledger.diary.text,'主人，雨伞找到了！');day=new Date('2026-11-09T00:00:00Z');await job.run(config,{force:true});assert.equal(diaries,4);assert.equal(writes,4);
 }finally{await rm(dir,{recursive:true,force:true});}
});
