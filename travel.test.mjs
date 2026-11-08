import { test } from 'node:test';
import assert from 'node:assert/strict';

test('关闭图生图保留上传设置，但生成参数和提示词均不读取底图或参考要求', async () => {
  const { effectiveConfig, compilePrompt } = await import('./prompt-skills.js');
  const input = { imageToImage: false, referenceId: 'a'.repeat(32), referenceInstructions: '保留参考图的神秘红帽子',
    textPrompt: '鲸鱼娘在雨巷旅行', usePromptSkills: false, style: '水墨', world: '江南', width: 1920, height: 1080 };
  const effective = effectiveConfig(input);
  assert.equal(input.referenceId, 'a'.repeat(32));
  assert.equal(effective.referenceId, ''); assert.equal(effective.referenceInstructions, '');
  const prompt = await compilePrompt(null, {}, input, []);
  assert.match(prompt, /鲸鱼娘在雨巷旅行/); assert.doesNotMatch(prompt, /神秘红帽子|参考图片|参考图需求/);
});

test('两套内置skill实际进入DSH请求，默认Flash并关闭推理，文字载体独立', async () => {
  const { compilePrompt } = await import('./prompt-skills.js');
  const calls = [];
  const llm = { async *stream(request) { calls.push(request); yield { type: 'text-delta', text: '鲸鱼娘在石壁前，壁上刻着“明日启程”。' }; yield { type: 'finish', reason: 'stop' }; } };
  const base = { usePromptSkills: true, promptMode: 'llm', textPrompt: '旅行', imageToImage: false,
    characters: '鲸鱼娘', textDensity: 'rich', textCarrier: 'stone', textContent: '明日启程', style: '国风' };
  await compilePrompt(llm, {}, base, []);
  assert.equal(calls[0].model, 'deepseek-flash'); assert.equal(calls[0].reasoningEffort, 'off'); assert.equal(calls[0].tools, undefined);
  assert.match(calls[0].messages[0].content[0].text, /travel-text-to-image/);
  await compilePrompt(llm, {}, { ...base, imageToImage: true, referenceId: 'builtin-deepseek', referenceInstructions: '保留头鳍和鲸尾' }, []);
  assert.match(calls[1].messages[0].content[0].text, /travel-image-to-image/);
  assert.match(calls[1].messages[0].content[0].text, /保留头鳍和鲸尾/);
  assert.match(calls[1].messages[0].content[0].text, /石壁|stone/);
});

test('随机世界一次替换全部主题字段，额外要求清空且遵循Off', async () => {
  const { generateWorld } = await import('./prompt-skills.js');
  const generated = { topic: '云海邮差', world: '未来浮岛城', era: '未来', tags: '飞艇，邮局', characters: 'DeepSeek鲸鱼娘（旅行邮差）',
    rules: '居民用漂浮信件交流', style: '透明水彩', textDensity: 'rich', textCarrier: 'hologram', textContent: '下一站云海', textPrompt: '鲸鱼娘骑飞艇去浮岛送信' };
  const llm = { async *stream(request) { assert.equal(request.reasoningEffort, 'off'); assert.match(request.messages[0].content[0].text, /travel-text-to-image/); yield { type: 'text-delta', text: JSON.stringify(generated) }; yield { type: 'finish', reason: 'stop' }; } };
  const result = await generateWorld(llm, { extraPrompt: '旧要求' }, '');
  for (const key of Object.keys(generated)) assert.equal(result[key], generated[key]);
  assert.equal(result.extraPrompt, '');
  await assert.rejects(generateWorld({ async *stream() { yield { type: 'text-delta', text: '{"world":"缺字段"}' }; } }, {}, ''), /完整|字段/);
});

test('独立订阅渠道直接发图像请求，不经过其它插件或回传令牌', async () => {
  const { createChannels } = await import('./channels.js');
  const previous = globalThis.fetch;
  const calls = [];
  const token = JSON.stringify({ accessToken: 'fake-access-token', refreshToken: '', expiresAt: Date.now()+3600000, email: 'local-test@example.org', accountId: 'fake-account' });
  const client = createChannels({ credentials: { async resolve(ref) { return ref === 'CODEX_OAUTH_1' ? { value: token } : undefined; } } });
  try {
    globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ data: [{ b64_json: Buffer.from('89504e470d0a1a0a0102','hex').toString('base64') }] }); };
    const profiles = await client.describe();
    assert.equal(profiles.find(p=>p.provider==='chatgpt-sub').configured, true);
    assert.ok(!JSON.stringify(profiles).includes('fake-access-token'));
    const result = await client.generate('画一张旅行壁纸', { imageChannel: 'chatgpt-sub', width: 1920, height: 1080 }, null);
    assert.equal(result.subarray(0,8).toString('hex'), '89504e470d0a1a0a');
    assert.match(calls[0].url, /^https:\/\/chatgpt.com\//); assert.doesNotMatch(calls[0].url, /127\.0\.0\.1|plugins/);
  } finally { globalThis.fetch = previous; }
});

test('订阅登录回调端口占用时立即报错，避免返回无法完成的登录链接', async () => {
  const { createServer } = await import('node:http');
  const { createChannels } = await import('./channels.js');
  const server=createServer();
  // Windows may already reserve/deny this fixed OAuth port; that is the same
  // unavailable-port condition, so still exercise the real login rejection.
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(1455,'127.0.0.1',resolve);});}
  catch(error){if(!['EADDRINUSE','EACCES'].includes(error.code))throw error;}
  try {
    const client=createChannels({credentials:{}});
    await assert.rejects(client.login('chatgpt-sub'), /1455|占用|EADDRINUSE/);
  } finally { if(server.listening)await new Promise(resolve=>server.close(resolve)); }
});

test('关闭图生图后续做未完成任务，会丢弃旧参考稿，不再读取或传递底图', async () => {
  const { mkdtemp,readFile,rm }=await import('node:fs/promises');
  const { tmpdir }=await import('node:os'); const {join}=await import('node:path');
  const {createDailyJob}=await import('./index.js');
  const dir=await mkdtemp(join(tmpdir(),'travel-mode-'));
  const image=Buffer.from('89504e470d0a1a0a','hex');
  let fail=true,writes=0;
  const job=createDailyJob({dir,collect:async()=>[],writePrompt:async(story,config)=>{writes++;return config.imageToImage?'参考红帽子':'新的纯文字稿';},
    render:async(prompt,config)=>{if(fail)throw new Error('暂时失败');assert.equal(config.referenceId,'');assert.equal(config.referenceInstructions,'');assert.doesNotMatch(prompt,/红帽子/);return image;},publish:async()=>{}});
  try {
    await assert.rejects(job.run({sourceMode:'world',world:'云海',imageToImage:true,referenceId:'builtin-deepseek',referenceInstructions:'参考红帽子'}),/暂时失败/);
    fail=false;const result=await job.run({sourceMode:'world',world:'云海',imageToImage:false,referenceId:'builtin-deepseek'});
    assert.equal(writes,2);assert.equal(result.images[0].referenceId,'');assert.equal(result.state,'published');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('带括号外形描述的角色在每天轮换时保持完整，不把头鳍或尾巴拆成角色', async () => {
  const { splitCharacters }=await import('./index.js');
  assert.deepEqual(splitCharacters('DeepSeek鲸鱼娘（大肥鱼；蓝发、头鳍、鲸尾），GPT龙娘（白发、龙角、龙尾）'), ['DeepSeek鲸鱼娘（大肥鱼；蓝发、头鳍、鲸尾）','GPT龙娘（白发、龙角、龙尾）']);
  assert.deepEqual(splitCharacters('大乔，小乔\n甄姬'),['大乔','小乔','甄姬']);
});

test('失败任务先关闭再重新开启图生图，重新选中的底图仍随新稿传入', async () => {
  const {mkdtemp,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');
  const {createDailyJob}=await import('./index.js');const dir=await mkdtemp(join(tmpdir(),'travel-reenable-'));
  const observed=[];let fail=true;
  const job=createDailyJob({dir,collect:async()=>[],writePrompt:async(story,config)=>config.imageToImage?'参考新鲸尾':'纯文字稿',render:async(prompt,config)=>{observed.push({prompt,referenceId:config.referenceId});if(fail)throw new Error('失败');return Buffer.from('89504e470d0a1a0a','hex');},publish:async()=>{}});
  try {
    await assert.rejects(job.run({sourceMode:'world',imageToImage:false,referenceId:'builtin-deepseek'}),/失败/);
    fail=false;await job.run({sourceMode:'world',imageToImage:true,referenceId:'builtin-gpt',referenceInstructions:'参考新鲸尾'});
    assert.equal(observed[1].referenceId,'builtin-gpt');assert.equal(observed[1].prompt,'参考新鲸尾');
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('旧版没有模式字段的待生成参考稿，在新版关闭图生图时必须重写', async () => {
  const {mkdtemp,writeFile,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');
  const {createDailyJob}=await import('./index.js');const dir=await mkdtemp(join(tmpdir(),'travel-migrate-'));
  const day='2026-11-07';
  await writeFile(join(dir,day+'.json'),JSON.stringify({day,issueId:day,state:'creating',targetCount:1,images:[],recipe:{sourceMode:'world',referenceId:'builtin-deepseek'},pending:{story:{title:'旧'},prompt:'保留参考红帽子'}}));
  const job=createDailyJob({dir,now:()=>new Date(2026,10,7,12),collect:async()=>[],writePrompt:async()=> '纯文字新稿',render:async(prompt,config)=>{assert.equal(prompt,'纯文字新稿');assert.equal(config.referenceId,'');return Buffer.from('89504e470d0a1a0a','hex');},publish:async()=>{}});
  try {await job.run({sourceMode:'world',imageToImage:false});}finally{await rm(dir,{recursive:true,force:true});}
});

test('上游错误回显令牌时，订阅错误出口必须脱敏', async () => {
  const {createChannels}=await import('./channels.js');const previous=globalThis.fetch;
  const token={accessToken:'fake-sensitive-access-123456',refreshToken:'fake-sensitive-refresh-123456',accountId:'fake-account-123456',email:'private@example.org',expiresAt:Date.now()+3600000};
  const client=createChannels({credentials:{async resolve(){return {value:JSON.stringify(token)};}}});
  try {
    globalThis.fetch=async()=>Response.json({error:{message:`bad ${token.accessToken} ${token.refreshToken} ${token.accountId} ${token.email}`}}, {status:401});
    await assert.rejects(client.generate('旅行',{imageChannel:'chatgpt-sub',width:1920,height:1080},null),error=>{
      for (const field of ['accessToken','refreshToken','accountId','email']) assert.ok(!error.message.includes(token[field]));return true;
    });
  } finally {globalThis.fetch=previous;}
});

test('写实环境与二次元参考角色分开处理：Skill和直接提示词均保留角色媒介',async()=>{
 const {compilePrompt}=await import('./prompt-skills.js');const base={rolesEnabled:true,imageToImage:true,referenceId:'builtin-deepseek',referenceInstructions:'大肥鱼去真实江东市集旅行',characters:'DS大肥鱼',styleId:'cinema',style:'电影感写实摄影',usePromptSkills:false,promptMode:'direct'};
 const prompt=await compilePrompt(null,{},base,[]);assert.match(prompt,/【角色画风】/);assert.match(prompt,/角色保留参考图的二次元/);assert.match(prompt,/仅用于背景/);assert.match(prompt,/用户明确要求改变角色画风/);
 let task;await compilePrompt({async *stream(request){task=request.messages[0].content[0].text;yield{type:'text-delta',text:'旅行场景'};}},{},{...base,usePromptSkills:true,promptMode:'llm'},[]);assert.match(task,/角色保留参考图的二次元/);
 const off=await compilePrompt(null,{}, {...base,imageToImage:false},[]);assert.doesNotMatch(off,/【角色画风】|参考图的二次元/);
 const observer=await compilePrompt(null,{}, {...base,rolesEnabled:false,observerImageToImage:true,observerReferenceId:'a'.repeat(32),observerReferenceInstructions:'场景参考'},[]);assert.doesNotMatch(observer,/【角色画风】|角色保留参考图的二次元/);
});

test('随机或主题世界同时返回新的文/图生图需求，清空旧自定义文字载体',async()=>{
 const{generateWorld}=await import('./prompt-skills.js');const generated={topic:'灯河游船',world:'盛唐不夜城',era:'历史',tags:'灯市，河灯',characters:'DS大肥鱼（夜游旅人）',rules:'居民用河灯传递祝愿，每夜只记录一件小事',style:'水彩',textDensity:'sparse',textCarrier:'newspaper',textContent:'灯河夜游',textPrompt:'大肥鱼在盛唐灯河乘船，手持一盏河灯'};
 const llm={async *stream(){yield{type:'text-delta',text:JSON.stringify(generated)}}};const result=await generateWorld(llm,{rolesEnabled:true,characters:'DS大肥鱼',rules:'旧三国',referenceInstructions:'旧参考图三国要求',carrierInstructions:'旧三国竹简'},'盛唐不夜城');assert.equal(result.rules,generated.rules);assert.equal(result.textPrompt,generated.textPrompt);assert.match(result.referenceInstructions,/盛唐灯河/);assert.match(result.referenceInstructions,/参考/);assert.doesNotMatch(result.referenceInstructions,/旧三国/);assert.equal(result.carrierInstructions,'');assert.equal(result.extraPrompt,'');
 const observer={...generated};delete observer.characters;const other=await generateWorld({async *stream(){yield{type:'text-delta',text:JSON.stringify(observer)}}},{rolesEnabled:false},'盛唐不夜城');assert.match(other.referenceInstructions,/场景/);assert.match(other.referenceInstructions,/不保留人物/);assert.doesNotMatch(other.referenceInstructions,/角色身份/);
});
