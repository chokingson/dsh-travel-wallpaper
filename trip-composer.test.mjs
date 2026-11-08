import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';
const generated={world:'云壳雨声档案城',timeTagId:'ce2149',society:'居民以雨声档案协商公共生活',themes:['调查','修复'],conflict:'失去雨声的街区无法读取公共记忆',tone:'温暖幽默',direction:'从抢救一个档案逐渐建立共同保管制度',opening:'一把旧伞在雨停后仍然发出敲门声',beats:['追查一把旧伞的来源','协助居民决定记忆归属','保留共同约定并面对新的小问题'],roleChoice:'由旅行角色先观察，再根据人设决定是否帮助居民'};
test('DSH空流和格式错误由真实模型有限重试恢复，记录每次尝试，不使用模板兜底',async()=>{
 const{createTripComposer}=await import('./trip-composer.js');const{readFile}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'trip-retry-'));let calls=0;
 try{const service=createTripComposer({dir,llm:{async *stream(){calls++;if(calls===1){yield{type:'finish',reason:'stop'};return;}yield{type:'text-delta',text:calls===2?'JSON格式损坏':JSON.stringify(generated)};}}});
  const draft=await service.generate({rolesEnabled:true},'创造新世界');assert.equal(calls,3);assert.equal(draft.attempts.length,3);assert.equal(draft.attempts[0].kind,'empty');assert.equal(draft.attempts[1].kind,'format');assert.equal(draft.source,'dsh');assert.equal(JSON.parse(await readFile(join(dir,'world-drafts/last-attempts.json'),'utf8')).attempts.length,3);
  let denied=0;await assert.rejects(createTripComposer({dir,llm:{async *stream(){denied++;throw Error('HTTP 401 请登录');}}}).generate({},''),/登录/);assert.equal(denied,1,'登录失效不能反复重试');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('本地模板不调用模型；用户正文覆盖灰色候选；DSH来源必须有真实生成凭据',async()=>{
 const{createTripComposer}=await import('./trip-composer.js');const dir=await mkdtemp(join(tmpdir(),'trip-composer-'));let calls=0,request;
 try{const service=createTripComposer({dir,llm:{async *stream(r){calls++;request=r;yield{type:'text-delta',text:JSON.stringify(generated)};yield{type:'finish',reason:'stop'}}}});const base={rolesEnabled:true,characters:'DS大肥鱼',world:'旧三国',rules:'旧三国故事'};
 const preset=await service.confirm(base,{caseId:'jurassic',timeId:'ce2077'});assert.equal(calls,0);assert.equal(preset.tripSource,'builtin');assert.equal(preset.tripTimeId,'jurassic');assert.doesNotMatch(preset.rules,/旧三国/);
 const custom=await service.confirm(base,{text:'去蒸汽海洋找会唱歌的灯塔',caseId:'jurassic'});assert.equal(custom.tripSource,'user');assert.equal(custom.tripCaseId,'');assert.equal(custom.tripPrompt,'去蒸汽海洋找会唱歌的灯塔');assert.doesNotMatch(custom.rules,/旧三国|侏罗纪/);
 assert.equal((await service.confirm(base,{text:'【世界】晨曦浮岛港。角色来到花园港口旅行。'})).world,'晨曦浮岛港');
 await assert.rejects(service.confirm(base,{generationId:'00000000-0000-4000-8000-000000000000'}),/不存在|过期/);
 const draft=await service.generate(base,'原创云端世界');assert.equal(calls,1);assert.equal(draft.source,'dsh');assert.equal(request.reasoningEffort,'off');assert.equal(request.tools,undefined);assert.equal(request.model,'deepseek-flash');
 const confirmed=await service.confirm(base,{generationId:draft.id});assert.equal(confirmed.tripSource,'dsh');assert.match(confirmed.tripPrompt,/云壳雨声/);assert.equal(confirmed.tripGenerationId,draft.id);assert.doesNotMatch(confirmed.rules,/旧三国/);
 await assert.rejects(service.confirm({...base,rolesEnabled:false},{generationId:draft.id}),/旅行方式/);
 const restarted=createTripComposer({dir,llm:{}});assert.equal((await restarted.confirm(base,{generationId:draft.id})).tripSource,'dsh');
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('模型出错、缺字段或照搬预设必须报错，不拿本地预设冒充DSH创作',async()=>{
 const{createTripComposer}=await import('./trip-composer.js');const dir=await mkdtemp(join(tmpdir(),'trip-invalid-'));
 try{for(const text of ['不是JSON','{}',JSON.stringify({...generated,world:'穿越侏罗纪巨兽森林'})]){const s=createTripComposer({dir,llm:{async *stream(){yield{type:'text-delta',text}}}});await assert.rejects(s.generate({rolesEnabled:false},''));}}
 finally{await rm(dir,{recursive:true,force:true});}
});
