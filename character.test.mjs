import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('新旧角色名字可识别；自定义角色不被未启用的默认底图冒充',async()=>{
  const {classifyCharacters,imageCharacters}=await import('./character-tags.js');
  assert.deepEqual(classifyCharacters('DS大肥鱼（蓝发）'),['deepseek']);
  assert.deepEqual(classifyCharacters('DeepSeek鲸鱼娘'),['deepseek']);
  assert.deepEqual(classifyCharacters('GPT龙娘和Claude大小姐'),['gpt','claude']);
  assert.deepEqual(imageCharacters({story:{character:'甄姬'}},{recipe:{imageToImage:false,referenceId:'builtin-deepseek'}}),['custom']);
  assert.deepEqual(imageCharacters({characterIds:['claude'],story:{character:'我的新名字'}},{}),['claude']);
});

test('角色筛选先于世界分组，一张多角色壁纸可在对应两类出现',async()=>{
  const {readWorldArchive}=await import('./archive.js');const dir=await mkdtemp(join(tmpdir(),'travel-roles-'));
  try{
    const roles=['DS大肥鱼','GPT龙娘','新名字','甄姬','DS大肥鱼与GPT龙娘'];
    for(let i=0;i<roles.length;i++){
      const day=`2026-01-0${i+1}`;await writeFile(join(dir,day+'.png'),'image');
      await writeFile(join(dir,day+'.json'),JSON.stringify({day,recipe:{world:'云海',referenceId:'builtin-deepseek',imageToImage:false},images:[{imageFile:day+'.png',story:{character:roles[i],title:roles[i]},...(i===2?{characterIds:['claude']}:{} )}]}));
    }
    const all=await readWorldArchive(dir);assert.equal(all.total,5);
    for(const [role,count]of [['deepseek',2],['gpt',2],['claude',1],['custom',1]]){
      const subset=await readWorldArchive(dir,{character:role});assert.equal(subset.total,count);assert.equal(subset.worlds[0].count,count);assert.equal(subset.worlds[0].id,all.worlds[0].id);
    }
    await assert.rejects(readWorldArchive(dir,{character:'invalid'}),/角色/);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('日记简短符合人设，默认称呼用户，Flash Off不带长期上下文',async()=>{
  const {writeTravelDiary}=await import('./diary.js');let request;
  const llm={async *stream(input){request=input;yield{type:'text-delta',text:'用户，今天我在江东买到了甜糕！给你留了一大块，回去一起吃。'};yield{type:'finish',reason:'stop'};}};
  const diary=await writeTravelDiary(llm,{world:'江东',story:{character:'DS大肥鱼'},prompt:'大肥鱼在市集买甜糕'},{});
  assert.match(diary.text,/用户/);assert.equal(diary.addressee,'用户');assert.equal(request.model,'deepseek-flash');assert.equal(request.reasoningEffort,'off');assert.equal(request.tools,undefined);
  assert.match(request.messages[0].content[0].text,/女儿|乖巧/);assert.doesNotMatch(request.messages[0].content[0].text,/previousTopics|历史日记/);
  const custom=await writeTravelDiary({async *stream(){yield{type:'text-delta',text:'朋友，今天雨后的云海特别漂亮。下次想和你一起看。'};}},{story:{character:'GPT龙娘'},prompt:'雨后的小旅行'},{diaryTitle:'朋友'});assert.equal(custom.addressee,'朋友');
  await assert.rejects(writeTravelDiary({async *stream(){yield{type:'text-delta',text:'长'.repeat(250)};}},{},{}),/太长|简短/);
});

test('成图先落盘，日记失败也能换壁纸，重试不会重复生图',async()=>{
  const {createDailyJob}=await import('./index.js');const dir=await mkdtemp(join(tmpdir(),'travel-diary-'));
  let renders=0,publishes=0,writes=0,savedBeforeDiary=false;const order=[];
  const job=createDailyJob({dir,collect:async()=>[],writePrompt:async()=> '图像提示',render:async()=>{renders++;return Buffer.from('89504e470d0a1a0a','hex');},
    writeDiary:async(picture)=>{writes++;order.push('diary');savedBeforeDiary=(await readFile(join(dir,picture.imageFile))).length>0;throw Error('暂时不可用');},publish:async()=>{publishes++;order.push('publish');}});
  try{
    const result=await job.run({sourceMode:'world',world:'江东',characters:'DS大肥鱼',imageToImage:true,referenceId:'builtin-deepseek',diaryEnabled:true});
    assert.deepEqual(order,['publish','diary']);assert.equal(savedBeforeDiary,true);assert.equal(result.state,'published');assert.equal(writes,1);assert.ok(result.images[0].diaryError);
    await job.run({sourceMode:'world',diaryEnabled:true});assert.equal(renders,1);assert.equal(writes,1);assert.equal(publishes,1);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('旧图补写日记只改对应档案，保留当前壁纸记录且已有日记不重复调用',async()=>{
  const {createServer}=await import('node:http');const {mkdir}=await import('node:fs/promises');const {apply}=await import('./index.js');
  const home=await mkdtemp(join(tmpdir(),'travel-diary-api-')),dir=join(home,'planet-news','issues'),oldHome=process.env.DSH_HOME;
  await mkdir(dir,{recursive:true});await writeFile(join(home,'planet-news','config.json'),JSON.stringify({enabled:false,newsBallEnabled:false,diaryTitle:'朋友'}));
  await writeFile(join(dir,'2026-01-01.json'),JSON.stringify({day:'2026-01-01',referenceId:'builtin-deepseek',settings:{world:'江东'},story:{title:'买糕',character:'DS大肥鱼'},prompt:'大肥鱼买甜糕'}));
  await writeFile(join(dir,'2026-01-01.png'),Buffer.from('89504e470d0a1a0a','hex'));
  const latest={day:'2026-01-02',state:'published',story:{title:'现用壁纸'}};await writeFile(join(dir,'latest.json'),JSON.stringify(latest));
  process.env.DSH_HOME=home;let route,calls=0;const cleanups=[];
  apply({effect(fn){const cleanup=fn();if(typeof cleanup==='function')cleanups.push(cleanup);},webServer:{register(value){route=value;return()=>{};}},llm:{async *stream(){calls++;yield{type:'text-delta',text:'朋友，今天我买到了甜糕！最大的一块留给你。'};}}});
  const server=createServer((req,res)=>route.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
  const post=body=>fetch(origin,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
  try{
    const result=await(await post({action:'diary',issueId:'2026-01-01',index:0})).json();assert.equal(result.diary.addressee,'朋友');
    assert.equal((await post({action:'diary',issueId:'2026-01-01',index:0})).status,200);assert.equal(calls,1);
    const saved=JSON.parse(await readFile(join(dir,'2026-01-01.json'),'utf8'));assert.match(saved.images[0].diary.text,/甜糕/);
    saved.images.push({...saved.images[0],diary:undefined});await writeFile(join(dir,'2026-01-01.json'),JSON.stringify(saved));
    const shared=await(await post({action:'diary',issueId:'2026-01-01',index:1})).json();assert.equal(shared.reused,true);assert.match(shared.diary.text,/甜糕/);assert.equal(calls,1);
    const sharedSaved=JSON.parse(await readFile(join(dir,'2026-01-01.json'),'utf8'));assert.equal(sharedSaved.images.filter(p=>p.diary).length,1);assert.equal(sharedSaved.images[1].diaryDay,'2026-01-01');
    assert.deepEqual(JSON.parse(await readFile(join(dir,'latest.json'),'utf8')),latest);
    await writeFile(join(dir,'2026-01-03.json'),JSON.stringify({day:'2026-01-03',images:[{imageFile:'2026-01-03.png',rolesEnabled:false,characterIds:['none'],story:{title:'浮岛开航'}}]}));
    await writeFile(join(dir,'2026-01-03.png'),Buffer.from('89504e470d0a1a0a','hex'));
    assert.equal((await post({action:'diary',issueId:'2026-01-03',index:0})).status,400);assert.equal(calls,1,'观察图片不调用日记模型');
    assert.equal((await post({action:'diary',issueId:'../../config'})).status,400);
    assert.equal((await post({action:'diary',issueId:'2026-01-01',index:9})).status,400);
  }finally{cleanups.forEach(fn=>fn());await new Promise(r=>server.close(r));if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome;await rm(home,{recursive:true,force:true});}
});
