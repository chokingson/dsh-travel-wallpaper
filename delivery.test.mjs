import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
const scope={world:'江东',characters:'DS大肥鱼'};
const photo={issueId:'2026-11-07-abcd',index:0,day:'2026-11-07',world:'江东',worldId:'a'.repeat(24),character:'DS大肥鱼',characterIds:['deepseek'],rolesEnabled:true,title:'江东游记',prompt:'江东市集买甜糕',image:'/api/planet-news?image=2026-11-07-abcd&index=0',diary:{text:'主人，今天买到甜糕啦，留一半给你。',addressee:'主人'}};
test('后台播报整理期间说走就走，立即投递意图不能丢失',async()=>{
 const{createDeliveryService}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'immediate-race-'));let release,started=false;const gate=new Promise(r=>release=r);const config={...scope,rolesEnabled:true,lettersEnabled:true,newsBallEnabled:true,letterTime:'20:00'};
 try{const service=createDeliveryService({dir,now:()=>new Date('2026-11-07T00:00:00Z'),archive:async()=>({images:[photo]}),writeNews:async()=>{started=true;await gate;return{headline:'今日新闻',summary:'测试后台简报'};}});const background=service.tick(config);while(!started)await new Promise(r=>setImmediate(r));const instant=service.tick(config,{immediate:true});release();await Promise.all([background,instant]);assert.equal((await service.inbox()).length,1);}
 finally{release?.();await rm(dir,{recursive:true,force:true});}
});
test('同日明确制作按批次刷新新闻和来信，同一批次重启后幂等',async()=>{
 const{createDeliveryService}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'instant-news-'));let picture={...photo},calls=0;const deps={dir,archive:async()=>({images:[picture]}),now:()=>new Date('2026-11-07T00:00:00Z'),writeNews:async()=>{calls++;return{headline:'雨伞找到了',summary:'今天大家帮忙找回了雨伞。'};}};
 try{let service=createDeliveryService(deps);const config={...scope,world:'江东',characters:'DS大肥鱼',lettersEnabled:true,rolesEnabled:true,letterTime:'20:00',newsBallEnabled:true};await service.tick(config,{immediate:true,prepare:true,refresh:true,issueId:picture.issueId});assert.equal((await service.inbox()).length,1);picture={...photo,issueId:'2026-11-07-aaaa',prompt:'同日第二个新事件',diary:{text:'第二次旅行：今天去放纸鸢。'}};await service.tick(config,{immediate:true,prepare:true,refresh:true,issueId:picture.issueId});picture={...photo,issueId:'2026-11-07-bbbb',prompt:'同日第三个新事件',diary:{text:'第三次旅行：河边看灯。'}};await service.tick(config,{immediate:true,prepare:true,refresh:true,issueId:picture.issueId});service=createDeliveryService(deps);await service.tick(config,{immediate:true,prepare:true,refresh:true,issueId:picture.issueId});assert.equal(calls,3);assert.equal((await service.inbox()).length,3);assert.equal((await service.desktopState(config)).latestLetter.items[0].text,'第三次旅行：河边看灯。');}
 finally{await rm(dir,{recursive:true,force:true});}
});
test('定时角色来信按中国时间到点投递，同批次重启不重投，关闭与观察模式不投递',async()=>{
 const{createDeliveryService}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-mail-'));let now=new Date('2026-11-07T11:59:00Z');
 const create=()=>createDeliveryService({dir,archive:async()=>({images:[photo,{...photo,rolesEnabled:false,characterIds:['none']}]}),now:()=>now});let service=create();
 const config={...scope,lettersEnabled:true,letterTime:'20:00',rolesEnabled:true,newsBallEnabled:false};
 try{await service.tick(config);assert.equal((await service.inbox()).length,0);now=new Date('2026-11-07T12:00:00Z');await service.tick(config);const inbox=await service.inbox();assert.equal(inbox.length,1);assert.equal(inbox[0].items.length,1);assert.equal(inbox[0].items[0].diary.text,photo.diary.text);
 await service.tick(config);service=create();await service.tick(config);assert.equal((await service.inbox()).length,1);
 assert.ok((await service.desktopState(config)).letter);await service.ack((await service.inbox())[0].id,false);assert.equal((await service.desktopState(config)).letter,null);
 await service.ack((await service.inbox())[0].id,true);assert.ok((await service.inbox())[0].readAt);
 now=new Date('2026-11-08T12:00:00Z');await service.tick({...scope,...config,rolesEnabled:false});await service.tick({...scope,...config,lettersEnabled:false});assert.equal((await service.inbox()).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('世界简报独立开启、按成图缓存；整理失败不阻断信件投递',async()=>{
 const{createDeliveryService}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-bulletin-'));let calls=0;
 const service=createDeliveryService({dir,archive:async()=>({images:[photo]}),now:()=>new Date('2026-11-07T12:00:00Z'),writeNews:async()=>{calls++;return{headline:'江东春市开张',summary:'河边市集迎来春日早客，纸鸢已在桥头升起。'};}});
 try{await service.tick({...scope,lettersEnabled:false,newsBallEnabled:false});assert.equal(calls,0);await service.tick({...scope,lettersEnabled:false,newsBallEnabled:true});await service.tick({...scope,newsBallEnabled:true});assert.equal(calls,1);assert.match((await service.desktopState({...scope,newsBallEnabled:true})).news.headline,/春市/);
 const other=createDeliveryService({dir:join(dir,'failed'),archive:async()=>({images:[photo]}),now:()=>new Date('2026-11-07T12:00:00Z'),writeNews:async()=>{throw Error('不可用');}});
 await other.tick({...scope,lettersEnabled:true,letterTime:'20:00',rolesEnabled:true,newsBallEnabled:true});assert.equal((await other.inbox()).length,1);assert.ok((await other.desktopState({...scope,newsBallEnabled:true})).newsError);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('简报写作只取画面事件，不携带角色来信或称呼，默认Flash Off',async()=>{
 const{writeWorldNews}=await import('./delivery.js');let task;
 const result=await writeWorldNews({async *stream(req){assert.equal(req.reasoningEffort,'off');assert.equal(req.model,'deepseek-flash');task=req.messages[0].content[0].text;yield{type:'text-delta',text:'{"headline":"江东春市开张","summary":"沿河市集迎来第一批客人。"}'};}},photo,{});
 assert.match(result.headline,/春市/);assert.doesNotMatch(task,/主人|留一半给你/);
});

test('损坏信件不导致信箱和桌面轮询崩溃，保留原文件',async()=>{
 const{createDeliveryService}=await import('./delivery.js');const{mkdir,writeFile,readFile}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'travel-bad-letter-'));
 try{await mkdir(join(dir,'letters'));const file=join(dir,'letters/2026-11-07.json'),raw=JSON.stringify({id:'2026-11-07',items:[null,{world:'坏记录'}]});await writeFile(file,raw);
 const service=createDeliveryService({dir,archive:async()=>({images:[]}),now:()=>new Date('2026-11-07T12:00:00Z')});assert.deepEqual(await service.inbox(),[]);assert.equal((await service.desktopState({...scope,lettersEnabled:true})).letter,null);assert.equal(await readFile(file,'utf8'),raw);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('关闭信件或切到观察世界会阻止归档等待中的投递，关闭简报会取消在途整理',async()=>{
 const{createDeliveryService}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-disable-'));let releaseArchive,releaseNews,signal,newsCalls=0;
 const blockedArchive=new Promise(r=>releaseArchive=r),blockedNews=new Promise(r=>releaseNews=r);
 try{const service=createDeliveryService({dir,archive:async()=>{await blockedArchive;return{images:[photo]}},now:()=>new Date('2026-11-07T12:00:00Z'),writeNews:async()=>{newsCalls++;return{headline:'test',summary:'test'}}});
 const pending=service.tick({...scope,lettersEnabled:true,letterTime:'20:00',rolesEnabled:true,newsBallEnabled:true});const disabled=service.tick({...scope,lettersEnabled:false,rolesEnabled:false,newsBallEnabled:false});releaseArchive();await Promise.all([pending,disabled]);assert.equal((await service.inbox()).length,0);assert.equal(newsCalls,0);
 const newsService=createDeliveryService({dir:join(dir,'second'),archive:async()=>({images:[photo]}),writeNews:async(_p,config)=>{signal=config.newsAbortSignal;await blockedNews;return{headline:'late',summary:'late'}}});const work=newsService.tick({...scope,newsBallEnabled:true});while(!signal)await new Promise(r=>setImmediate(r));const off=newsService.tick({...scope,newsBallEnabled:false});assert.equal(signal.aborted,true);releaseNews();await Promise.all([work,off]);assert.equal((await newsService.desktopState({...scope,newsBallEnabled:true})).news,null);
 }finally{releaseArchive?.();releaseNews?.();await rm(dir,{recursive:true,force:true});}
});
test('损坏旧版信件保持原样，当前批次仍可另存投递，包括结构和JSON语法损坏',async()=>{
 const{createDeliveryService}=await import('./delivery.js');const{mkdir,writeFile,readFile,readdir}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'travel-recover-letter-'));
 try{for(const [i,raw]of ['{"id":"2026-11-07","items":[null]}','{bad json'].entries()){const sub=join(dir,String(i)),folder=join(sub,'letters');await mkdir(folder,{recursive:true});await writeFile(join(folder,'2026-11-07.json'),raw);const service=createDeliveryService({dir:sub,archive:async()=>({images:[photo]}),now:()=>new Date('2026-11-07T12:00:00Z')});await service.tick({...scope,lettersEnabled:true,letterTime:'20:00'});assert.equal((await service.inbox()).length,1);assert.equal(await readFile(join(folder,'2026-11-07.json'),'utf8'),raw);assert.equal((await readdir(folder)).filter(f=>f.endsWith('.json')).length,2);}
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('通知确认后保留最近来信供浮球阅读，观察模式隐藏，音效独立默认关闭',async()=>{
 const{createDeliveryService}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-recent-letter-'));let now=new Date('2026-11-07T12:00:00Z');
 try{const service=createDeliveryService({dir,archive:async()=>({images:[photo]}),now:()=>now});await service.tick({...scope,lettersEnabled:true,letterTime:'20:00'});await service.ack((await service.inbox())[0].id);
 const state=await service.desktopState({...scope,lettersEnabled:true,newsBallEnabled:true});assert.equal(state.letter,null);assert.equal(state.latestLetter.items[0].text,photo.diary.text);assert.equal(state.widgetSoundsEnabled,false);await service.ack((await service.inbox())[0].id,true);now=new Date('2026-11-08T12:00:00Z');
 const next=await service.desktopState({...scope,lettersEnabled:false,widgetSoundsEnabled:true});assert.equal(next.latestLetter.id,(await service.inbox())[0].id);assert.ok(next.latestLetter.readAt);assert.equal(next.widgetSoundsEnabled,true);
 const observer=await service.desktopState({...scope,rolesEnabled:false,lettersEnabled:true,widgetSoundsEnabled:true});assert.equal(observer.latestLetter,null);assert.equal(observer.letter,null);assert.equal(observer.allowLetters,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('三国到宋朝再到观察2077立即隔离上下文，无新图时可准备当前世界简报',async()=>{
 const{createDeliveryService,deliveryContextKey}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-context-'));let pictures=[];
 const role={rolesEnabled:true,characters:'DS大肥鱼',lettersEnabled:true,newsBallEnabled:true,rules:'每日新趣事'};
 const three={...role,world:'三国'},song={...role,world:'宋朝'},observer={...role,rolesEnabled:false,world:'2077'};
 const photoFor=(config,issueId)=>({...photo,world:config.world,contextKey:deliveryContextKey(config),issueId,diary:{text:config.world+'的新信'}});
 try{const service=createDeliveryService({dir,now:()=>new Date('2026-11-07T12:00:00Z'),archive:async()=>({images:pictures}),writeNews:async p=>({headline:p.world+'的新见闻',summary:'当前场景：'+p.prompt})});
 pictures=[photoFor(three,'2026-11-07-1111')];await service.tick(three,{prepare:true,issueId:pictures[0].issueId});assert.equal((await service.desktopState(three)).latestLetter.items[0].world,'三国');
 let state=await service.desktopState(song);assert.equal(state.news,null);assert.equal(state.latestLetter,null);await service.tick(song);state=await service.desktopState(song);assert.equal(state.news.world,'宋朝');assert.equal(state.currentWorld,'宋朝');assert.equal(state.news.source.image,undefined);assert.equal(state.latestLetter,null);
 pictures.unshift(photoFor(song,'2026-11-07-2222'));await service.tick(song,{prepare:true,issueId:pictures[0].issueId});assert.equal((await service.desktopState(song)).latestLetter.items[0].text,'宋朝的新信');
 await service.tick(observer,{prepare:true,refresh:true,issueId:'2026-11-07-3333'});state=await service.desktopState(observer);assert.equal(state.news.world,'2077');assert.equal(state.allowLetters,false);assert.equal(state.latestLetter,null);assert.equal(state.letter,null);assert.equal((await service.inbox()).length,2);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('明确制作在关闭通知时仍存档当前批次新闻和信件，观察制作不写信',async()=>{
 const{createDeliveryService,deliveryContextKey}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-prepare-'));let config={world:'江东',characters:'DS大肥鱼',rolesEnabled:true,lettersEnabled:false,newsBallEnabled:false};let pictures=[];
 try{const service=createDeliveryService({dir,now:()=>new Date('2026-11-07T12:00:00Z'),archive:async()=>({images:pictures}),writeNews:async p=>({headline:p.world+'新事件',summary:'新事件简报'})});pictures=[{...photo,contextKey:deliveryContextKey(config)}];await service.tick(config,{prepare:true,refresh:true,issueId:photo.issueId});const state=await service.desktopState(config);assert.equal((await service.inbox()).length,1);assert.equal(state.letter,null);assert.equal(state.latestLetter.items[0].text,photo.diary.text);assert.equal(state.news.headline,'江东新事件');assert.equal(state.newsBallEnabled,false);
 config={...config,world:'2077',rolesEnabled:false};pictures=[{...photo,world:'2077',rolesEnabled:false,characterIds:['none'],contextKey:deliveryContextKey(config),issueId:'2026-11-07-dddd'}];await service.tick(config,{prepare:true,refresh:true,issueId:pictures[0].issueId});assert.equal((await service.inbox()).length,1);assert.equal((await service.desktopState(config)).news.world,'2077');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('异步旧世界简报不会覆盖新世界，并处理等待中的最新制作意图',async()=>{
 const{createDeliveryService,deliveryContextKey}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-world-race-'));let release,signal;const gate=new Promise(r=>release=r);const config={world:'三国',rolesEnabled:true,characters:'DS大肥鱼',lettersEnabled:true,newsBallEnabled:true},next={...config,world:'宋朝'};let pictures=[{...photo,world:'三国',contextKey:deliveryContextKey(config)}];
 try{const service=createDeliveryService({dir,now:()=>new Date('2026-11-07T12:00:00Z'),archive:async()=>({images:pictures}),writeNews:async(p,c)=>{if(p.world==='三国'){signal=c.newsAbortSignal;await gate;}return{headline:p.world+'的新事件',summary:'仅当前世界'};}});const old=service.tick(config,{prepare:true,issueId:photo.issueId});while(!signal)await new Promise(r=>setImmediate(r));pictures=[{...photo,world:'宋朝',contextKey:deliveryContextKey(next),issueId:'2026-11-07-aaaa'}];const fresh=service.tick(next,{prepare:true,refresh:true,issueId:pictures[0].issueId});assert.equal(signal.aborted,true);release();await Promise.all([old,fresh]);const state=await service.desktopState(next);assert.equal(state.news.world,'宋朝');assert.equal(state.news.source.issueId,'2026-11-07-aaaa');assert.equal(state.latestLetter.items[0].world,'宋朝');
 }finally{release?.();await rm(dir,{recursive:true,force:true});}
});

test('修改角色、启用底图或编辑旅行规则均隔离旧批次，非活动底图不影响上下文',async()=>{
 const{createDeliveryService,deliveryContextKey}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-context-inputs-'));const config={world:'江东',rolesEnabled:true,characters:'DS大肥鱼',lettersEnabled:true,newsBallEnabled:true,rules:'原规则',tripPrompt:'原旅行'};
 try{const service=createDeliveryService({dir,now:()=>new Date('2026-11-07T12:00:00Z'),archive:async()=>({images:[{...photo,contextKey:deliveryContextKey(config)}]}),writeNews:async()=>({headline:'旧事件',summary:'旧批次'})});await service.tick(config,{prepare:true,issueId:photo.issueId});for(const change of[{characters:'GPT龙娘'},{imageToImage:true,referenceId:'other'},{rules:'新规则'},{tripPrompt:'新旅行'}]){const state=await service.desktopState({...config,...change});assert.equal(state.news,null);assert.equal(state.latestLetter,null);}assert.equal((await service.desktopState({...config,referenceId:'unused'})).latestLetter.items[0].world,'江东');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('旧版记录仅在世界角色和活动底图均匹配时可读，信箱按创建时间排序',async()=>{
 const{createDeliveryService}=await import('./delivery.js');const{mkdir,writeFile}=await import('node:fs/promises');const dir=await mkdtemp(join(tmpdir(),'travel-legacy-context-'));const config={...scope,rolesEnabled:true,lettersEnabled:true,newsBallEnabled:true};
 try{await mkdir(join(dir,'letters'),{recursive:true});await mkdir(join(dir,'news'),{recursive:true});for(const[id,createdAt,text]of[['2026-11-07-ffffffff','2026-11-07T12:00:00Z','较早的信'],['2026-11-07-00000000','2026-11-07T12:01:00Z','真正最新的信']])await writeFile(join(dir,'letters',id+'.json'),JSON.stringify({id,createdAt,items:[{...photo,diary:{text}}]}));const oldNews={id:'2026-11-07',world:'江东',headline:'保留的旧简报',summary:'旧世界事件',createdAt:'2026-11-07T12:00:00Z',source:{issueId:photo.issueId,index:0}};await writeFile(join(dir,'news/latest.json'),JSON.stringify(oldNews));await writeFile(join(dir,'news/2026-11-07.json'),JSON.stringify(oldNews));const service=createDeliveryService({dir,archive:async()=>({images:[photo]}),now:()=>new Date('2026-11-07T12:02:00Z')});let state=await service.desktopState(config);assert.equal(state.news.headline,'保留的旧简报');assert.equal(state.latestLetter.id,'2026-11-07-00000000');assert.equal((await service.inbox())[0].items[0].diary.text,'真正最新的信');for(const change of[{world:'宋朝'},{characters:'GPT龙娘'},{imageToImage:true,referenceId:'new-reference'}]){state=await service.desktopState({...config,...change});assert.equal(state.latestLetter,null);assert.equal(state.news,null);}await service.ack('2026-11-07-00000000',true);assert.ok((await service.inbox())[0].readAt);for(const id of['../config','2026-02-30','2026-11-07-abc','2026-11-07-abcdefgh'])await assert.rejects(service.ack(id),/编号无效/);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('明确批次选中自己的图和日记，不误用归档首张的另一批次',async()=>{
 const{createDeliveryService,deliveryContextKey}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-exact-issue-'));const config={...scope,rolesEnabled:true,lettersEnabled:true,newsBallEnabled:true};const contextKey=deliveryContextKey(config),wanted={...photo,contextKey,issueId:'2026-11-07-1111',prompt:'指定批次场景',diary:{text:'指定批次来信'}},other={...photo,contextKey,issueId:'2026-11-07-ffff',prompt:'不该选择的场景'};
 try{const service=createDeliveryService({dir,archive:async()=>({images:[other,wanted]}),now:()=>new Date('2026-11-07T12:00:00Z'),writeNews:async p=>({headline:p.prompt,summary:'世界简报'})});await service.tick(config,{prepare:true,refresh:true,issueId:wanted.issueId});const state=await service.desktopState(config);assert.equal(state.news.headline,'指定批次场景');assert.equal(state.latestLetter.items[0].text,'指定批次来信');assert.equal((await service.inbox()).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('旧世界服务忽略取消也不会阻塞新世界简报',async()=>{
 const{createDeliveryService,deliveryContextKey}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-abort-queue-'));const config={...scope,newsBallEnabled:true},next={...config,world:'宋朝'};let release,started,work,fresh;const gate=new Promise(r=>release=r),firstStarted=new Promise(r=>started=r);let pictures=[{...photo,contextKey:deliveryContextKey(config)}];
 try{const service=createDeliveryService({dir,now:()=>new Date('2026-11-07T12:00:00Z'),archive:async()=>({images:pictures}),writeNews:async p=>{if(p.world==='江东'){started();await gate;}return{headline:p.world+'新事件',summary:'新世界见闻'};}});work=service.tick(config);await firstStarted;pictures=[{...photo,world:'宋朝',contextKey:deliveryContextKey(next),issueId:'2026-11-07-aaaa'}];fresh=service.tick(next,{prepare:true,issueId:pictures[0].issueId});const advanced=await Promise.race([fresh.then(()=>true),new Promise(r=>setTimeout(()=>r(false),250))]);assert.equal(advanced,true,'新世界不能等待已取消的旧世界写作完成');assert.equal((await service.desktopState(next)).news.world,'宋朝');release();await work;assert.equal((await service.desktopState(next)).news.world,'宋朝');
 }finally{release?.();await Promise.allSettled([work,fresh]);await rm(dir,{recursive:true,force:true});}
});

test('同世界追加世界毁灭要求会隔离旧新闻和来信，并以新剧情输入准备见闻',async()=>{
 const{createDeliveryService,deliveryContextKey}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-event-inputs-'));const config={...scope,rolesEnabled:true,lettersEnabled:true,newsBallEnabled:true,rules:'沿河市集日常',tripPrompt:'旅行设定'};const changed={...config,extraPrompt:'让这个虚构世界毁灭，城市变成漂浮遗迹',interactionPrompt:'让居民在星海中重建家园',interactionId:'latest-interaction',textPrompt:'星海遗迹中的第一座港口',topic:'星海重建',tags:'漂浮碎片、方舟'};let subject;
 try{const service=createDeliveryService({dir,now:()=>new Date('2026-11-07T12:00:00Z'),archive:async()=>({images:[{...photo,contextKey:deliveryContextKey(config)}]}),writeNews:async p=>{subject=p;return{headline:p.prompt.includes('虚构世界毁灭')?'世界毁灭后的新港口':'江东春市开张',summary:'本次世界见闻'};}});await service.tick(config,{prepare:true,issueId:photo.issueId});assert.ok((await service.desktopState(config)).latestLetter);assert.notEqual(deliveryContextKey({...config,extraPrompt:changed.extraPrompt}),deliveryContextKey(config));let state=await service.desktopState(changed);assert.equal(state.news,null);assert.equal(state.latestLetter,null);await service.tick(changed);state=await service.desktopState(changed);assert.equal(state.news.headline,'世界毁灭后的新港口');assert.equal(state.latestLetter,null);assert.equal(state.news.source.image,undefined);for(const value of[changed.interactionPrompt,changed.extraPrompt,changed.textPrompt,changed.topic,changed.tags,config.tripPrompt,config.rules])assert.ok(subject.prompt.includes(value),'当前世界素材应包含 '+value);assert.ok(subject.prompt.indexOf(changed.interactionPrompt)<subject.prompt.indexOf(config.tripPrompt));
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('更改事件来源或画面正文使旧消息失效，尺寸画风和通知开关不改变剧情上下文',async()=>{
 const{createDeliveryService,deliveryContextKey}=await import('./delivery.js');const dir=await mkdtemp(join(tmpdir(),'travel-source-context-'));const config={...scope,rolesEnabled:true,lettersEnabled:true,newsBallEnabled:true};
 try{const service=createDeliveryService({dir,now:()=>new Date('2026-11-07T12:00:00Z'),archive:async()=>({images:[{...photo,contextKey:deliveryContextKey(config)}]}),writeNews:async()=>({headline:'旧批次事件',summary:'旧消息'})});await service.tick(config,{prepare:true,issueId:photo.issueId});for(const change of[{extraPrompt:'世界毁灭'},{textPrompt:'新的事件'},{interactionPrompt:'让星球化作花园'},{interactionId:'another-command'},{topic:'新的主题'},{tags:'新事件标签'},{sourceMode:'bili-report'},{keywords:'彗星'},{days:12},{textContent:'全城迁往月球'},{carrierInstructions:'载体记载新世界诞生'},{tripMeta:'{"opening":"新开场"}'}]){const state=await service.desktopState({...config,...change});assert.equal(state.news,null,JSON.stringify(change));assert.equal(state.latestLetter,null,JSON.stringify(change));}const cosmetic={...config,width:1080,height:1920,style:'水彩',lettersEnabled:false,newsBallEnabled:false};assert.equal(deliveryContextKey(cosmetic),deliveryContextKey(config));assert.ok((await service.desktopState(cosmetic)).latestLetter);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('长画面提示不截掉最新干涉指令，简报独立携带明确虚构重大变化要求',async()=>{
 const{writeWorldNews}=await import('./delivery.js');let input;const instruction='让整个虚构星球碎裂成环形群岛，居民乘方舟迁徙';const config={interactionPrompt:instruction,extraPrompt:'新港口建立在最大的碎片上',textPrompt:'方舟进入星环港',topic:'星环迁徙',tags:'星环、方舟'};
 const result=await writeWorldNews({async *stream(request){input=JSON.parse(request.messages[0].content[0].text.split('\n').at(-1));yield{type:'text-delta',text:'{"headline":"星环方舟抵达新港","summary":"碎裂星球的居民乘方舟进入新建的星环港。"}'};}},{...photo,prompt:'原场景'.repeat(2000)+'末尾旧素材'},config);assert.equal(input.scene.length,4000);assert.equal(input.interactionPrompt,instruction);assert.equal(input.requirements.extraPrompt,config.extraPrompt);assert.equal(input.requirements.textPrompt,config.textPrompt);assert.equal(input.requirements.topic,config.topic);assert.equal(input.requirements.tags,config.tags);assert.equal(result.headline,'星环方舟抵达新港');
});
