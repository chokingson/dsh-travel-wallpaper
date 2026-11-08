import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,writeFile,readFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{createServer}from'node:http';import{apply}from'./index.js';
const idea={world:'邮票海洋倒影城',timeTagId:'ce2149',society:'由居民共同维护的漂浮档案社会',themes:['探险','修复'],conflict:'潮汐正在冲散居民保存的共同记忆',tone:'温暖荒诞',direction:'从守住一封信走向公共记忆互助',opening:'一枚旧邮票在水面展开成迷你码头',beats:['核对一份漂来的旧信','决定如何维护公共档案','继续处理一次新潮汐造成的小问题'],roleChoice:'由角色按人设选择旁观或介入'};
test('完整桌面转发链：无Origin凭会话保存/确认，预设与真实模型来源可追溯且不生图',async()=>{
 const home=await mkdtemp(join(tmpdir(),'travel-desktop-api-')),prior=process.env.DSH_HOME,cleanups=[];let route,calls=0,publish=0;
 await mkdir(join(home,'planet-news'),{recursive:true});await writeFile(join(home,'planet-news/config.json'),JSON.stringify({enabled:false,wallpaperMode:'windows',world:'穿越三国',rules:'旧三国规则',characters:'DS大肥鱼'}));process.env.DSH_HOME=home;
 const server=createServer((req,res)=>route.handler(req,res));
 try{apply({effect(fn){const stop=fn();if(typeof stop==='function')cleanups.push(stop);},webServer:{register(value){route=value;return()=>{};}},llm:{listProviders:()=>[{id:'deepseek-account'}],async *stream(request){assert.equal(request.reasoningEffort,'off');const task=request.messages[0].content[0].text;if(task.includes('简报编辑')){yield{type:'text-delta',text:JSON.stringify({headline:'当前世界见闻',summary:'当前世界居民开启了一场新的日常活动。'})};}else{calls++;yield{type:'text-delta',text:JSON.stringify(idea)};}}}},null,()=>{publish++;},()=>({sync:async()=>{},authorized:()=>false,heartbeat(){},status:()=>({running:false,ready:false,error:''}),dispose(){}}));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const root='http://127.0.0.1:'+server.address().port,url=root+'/api/planet-news',token=(await fetch(url+'?clientSession').then(r=>r.json())).writeToken;
 const post=(body,origin)=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify({...body,clientToken:token})});
 assert.equal((await post({config:{hour:9}})).status,200);
 const confirmed=await post({action:'trip-confirm',choice:{caseId:'jurassic',timeId:'ce2077'},config:{styleId:'cinema'}}).then(r=>r.json());assert.equal(confirmed.config.tripSource,'builtin');assert.equal(confirmed.config.tripTimeId,'jurassic');assert.doesNotMatch(confirmed.config.rules,/旧三国/);assert.equal(calls,0);assert.ok(confirmed.config.tripStartDay);
 const draft=await post({action:'trip-generate',seed:'设计一个新的原创海洋世界',rolesEnabled:true}).then(r=>r.json());assert.equal(draft.candidate.source,'dsh');assert.equal(calls,1);
 const model=await post({action:'trip-confirm',choice:{generationId:draft.candidate.id}}).then(r=>r.json());assert.equal(model.config.tripSource,'dsh');assert.equal(model.config.tripGenerationId,draft.candidate.id);assert.match(model.config.tripPrompt,/邮票海洋/);
 const custom=await post({action:'trip-confirm',choice:{text:'去一颗会唱歌的星球',caseId:'jurassic'}}).then(r=>r.json());assert.equal(custom.config.tripSource,'user');assert.equal(custom.config.tripCaseId,'');assert.equal(custom.config.tripPrompt,'去一颗会唱歌的星球');assert.equal(JSON.parse(await readFile(join(home,'planet-news/config.json'),'utf8')).tripPrompt,custom.config.tripPrompt);
 assert.equal((await post({config:{hour:8}},'https://evil.example')).status,403);assert.equal((await post({config:{tripSource:'dsh'}})).status,400);
 const roleWorld=custom.config.world;
 const observer=await post({action:'trip-confirm',config:{rolesEnabled:false},choice:{caseId:'jurassic'}}).then(r=>r.json());
 assert.equal(observer.config.world,roleWorld,'观察世界确认不覆盖角色旅行的世界');
 const {effectiveConfig}=await import('./mode-config.js');assert.match(effectiveConfig(observer.config).world,/侏罗纪/);
 const role=await post({config:{rolesEnabled:true}}).then(r=>r.json());assert.equal(effectiveConfig(role.config).world,roleWorld);assert.equal(effectiveConfig(role.config).era,'','自定义角色行程不继承观察世界的纪年');
 const catalog=await fetch(url+'?catalog').then(r=>r.json());assert.equal(catalog.worldCases.length,50);assert.equal(catalog.timeTags.length,50);assert.equal(catalog.styles.length,20);const image=await fetch(url+'?stylePreview=cinema');assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/webp');assert.equal(publish,0);
 }finally{for(const stop of cleanups.reverse())stop();await new Promise(r=>server.close(r));process.env.DSH_HOME=prior;await rm(home,{recursive:true,force:true});}
});
