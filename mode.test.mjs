import {test}from'node:test';import assert from'node:assert/strict';
import{mkdtemp,rm,readFile}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
test('观察模式保留原角色设置，但生效配置、写稿与成图要求不带角色和称呼',async()=>{
 const {effectiveConfig,compilePrompt}=await import('./prompt-skills.js');
 const raw={rolesEnabled:false,characters:'DS大肥鱼',diaryEnabled:true,diaryTitle:'主人',textPrompt:'大肥鱼给主人的留言',rules:'大肥鱼的故事',tags:'鲸鱼娘',referenceId:'builtin-deepseek',referenceInstructions:'保留她的脸',imageToImage:true,observerTextPrompt:'站在雨后浮岛观察第一班飞艇',observerRules:'每天一件简单小事',observerTags:'浮岛，晨雾',observerImageToImage:false,style:'水彩'};
 const generation=effectiveConfig(raw);assert.equal(generation.characters,'');assert.equal(generation.diaryEnabled,false);assert.equal(generation.diaryTitle,'');assert.equal(generation.referenceId,'');assert.equal(generation.textPrompt,raw.observerTextPrompt);assert.equal(raw.referenceId,'builtin-deepseek');
 let task;const llm={async *stream(request){task=request.messages[0].content[0].text;yield{type:'text-delta',text:'雨后浮岛，第一班飞艇停靠。'};}};
 const prompt=await compilePrompt(llm,{}, {...raw,usePromptSkills:true,promptMode:'llm'},[{story:{title:'大肥鱼昨日来信'}}]);
 assert.doesNotMatch(task,/DS大肥鱼|大肥鱼昨日|鲸鱼娘|主人|保留她的脸/);assert.match(task,/travel-world-observation/);assert.match(prompt,/观察世界/);assert.doesNotMatch(prompt,/大肥鱼|鲸鱼娘|给主人/);
});
test('观察世界停用场景参考，旧场景配置保留但不发送图片，不继承角色肖像',async()=>{
 const {effectiveConfig}=await import('./prompt-skills.js');const{normalizeConfig}=await import('./catalog.js');
 const raw={rolesEnabled:false,imageToImage:true,referenceId:'builtin-deepseek',observerImageToImage:true,observerReferenceId:'a'.repeat(32),observerReferenceInstructions:'只参考建筑和配色'};
 const actual=effectiveConfig(normalizeConfig(raw));assert.equal(actual.referenceId,'');assert.equal(actual.referenceInstructions,'');assert.equal(actual.imageToImage,false);
 assert.doesNotThrow(()=>normalizeConfig({...raw,observerReferenceId:''}));
 assert.doesNotThrow(()=>normalizeConfig({...raw,observerImageToImage:false,observerReferenceId:''}));
});
test('随机观察世界不向模型传旧角色，也不修改旧角色输入',async()=>{
 const{generateWorld}=await import('./prompt-skills.js');let task;
 const generated={topic:'雨后首班船',world:'浮岛',era:'未来',tags:'雨后，飞艇',rules:'早班船驶向浮岛',style:'水彩',textDensity:'sparse',textCarrier:'hologram',textContent:'云海站',textPrompt:'观察雨后的第一班飞艇'};
 const llm={async *stream(request){task=request.messages[0].content[0].text;yield{type:'text-delta',text:JSON.stringify(generated)};}};
 const result=await generateWorld(llm,{rolesEnabled:false,characters:'DS大肥鱼',diaryTitle:'主人'},'');assert.doesNotMatch(task,/DS大肥鱼|主人/);assert.equal('characters'in result,false);assert.equal(result.world,'浮岛');
});
test('角色失败任务切换观察模式会重写稿件，新图标为无角色且不调用日记',async()=>{
 const{createDailyJob}=await import('./index.js');const{imageCharacters}=await import('./character-tags.js');const dir=await mkdtemp(join(tmpdir(),'travel-observer-'));let fail=true,writes=0,diaries=0;
 const job=createDailyJob({dir,collect:async()=>[],writePrompt:async(story,config)=>{writes++;return config.rolesEnabled===false?'浮岛的早班船':'DS大肥鱼旅行';},render:async(prompt,config)=>{if(fail)throw Error('中断');assert.equal(prompt,'浮岛的早班船');assert.equal(config.characters,'');return Buffer.from('89504e470d0a1a0a','hex');},publish:async()=>{},writeDiary:async()=>{diaries++;return{text:'主人，今天去旅行'};}});
 try{await assert.rejects(job.run({sourceMode:'world',world:'浮岛',characters:'DS大肥鱼',rolesEnabled:true}),/中断/);fail=false;const result=await job.run({sourceMode:'world',world:'浮岛',characters:'DS大肥鱼',rolesEnabled:false,observerTextPrompt:'观察飞艇'});
 assert.equal(writes,2);assert.equal(diaries,0);assert.equal(result.images[0].rolesEnabled,false);assert.deepEqual(imageCharacters(result.images[0],result),['none']);assert.equal(result.images[0].diary,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('无角色图片不能生成角色日记，旧角色分类不受当前观察设置污染',async()=>{
 const{writeTravelDiary}=await import('./diary.js');const{imageCharacters}=await import('./character-tags.js');let calls=0;
 await assert.rejects(writeTravelDiary({async *stream(){calls++;}},{rolesEnabled:false,characterIds:['none']},{}),/观察|无角色/);assert.equal(calls,0);
 assert.deepEqual(imageCharacters({rolesEnabled:true,characterIds:['deepseek']},{recipe:{rolesEnabled:false}}),['deepseek']);
});

test('混合批次恢复角色旅行时，已保存的观察图片仍无角色也不补写日记',async()=>{
 const{createDailyJob}=await import('./index.js');const{imageCharacters}=await import('./character-tags.js');const dir=await mkdtemp(join(tmpdir(),'travel-mode-batch-'));let renders=0,diaries=0;
 const job=createDailyJob({dir,collect:async()=>[],writePrompt:async(s,c)=>c.rolesEnabled===false?'浮岛环境':'角色旅行',render:async()=>{if(++renders===2)throw Error('中断');return Buffer.from('89504e470d0a1a0a','hex');},publish:async()=>{},writeDiary:async()=>{diaries++;return{text:'主人，今天旅行很开心'};}});
 try{await assert.rejects(job.run({sourceMode:'world',world:'浮岛',rolesEnabled:false,dailyCount:2}),/中断/);
 const result=await job.run({sourceMode:'world',world:'浮岛',rolesEnabled:true,characters:'DS大肥鱼',imageToImage:true,referenceId:'builtin-deepseek',dailyCount:2});
 assert.equal(diaries,1);assert.deepEqual(imageCharacters(result.images[0],result),['none']);assert.equal(result.images[0].diaryError,undefined);assert.equal(result.images[0].diary,undefined);assert.deepEqual(imageCharacters(result.images[1],result),['deepseek']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
