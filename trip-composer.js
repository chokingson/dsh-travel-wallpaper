import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { worldCases, timeTags, pickWorldCase, renderWorldCase, worldCasePatch } from './world-cases.js';
import { readPromptSkill, streamText } from './prompt-skills.js';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const trimText=value=>typeof value==='string'?value.trim():'';
export const tripFields=['tripPrompt','tripSource','tripCaseId','tripTimeId','tripGenerationId','tripMeta','tripConfirmedAt','tripStartDay'];
export function tripCatalog() {
  return worldCases.map(row=>({...row,choices:row.timeIds.map(timeId=>{
    const chosen=pickWorldCase({caseId:row.id,timeId});
    return {time:chosen.time,rolePrompt:renderWorldCase(chosen,{characters:'〔所选角色〕'}),observerPrompt:renderWorldCase(chosen,{rolesEnabled:false})};
  })}));
}
function parseIdea(text) {
  let data;try{data=JSON.parse(text.replace(/^\x60{3}(?:json)?\s*/,'').replace(/\s*\x60{3}$/,''));}catch{throw new Error('DSH未返回完整世界JSON，未使用本地预设替代');}
  if(!data||Array.isArray(data)||typeof data!=='object')throw new Error('DSH世界格式无效');
  for(const key of ['world','timeTagId','society','conflict','tone','direction','opening']){
    if(typeof data[key]!=='string'||!data[key].trim()||data[key].length>1500)throw new Error('DSH世界缺少字段：'+key);
    data[key]=data[key].trim();
  }
  for(const key of ['themes','beats']){
    if(!Array.isArray(data[key])||data[key].length<(key==='beats'?3:1)||data[key].length>8||data[key].some(v=>typeof v!=='string'||!v.trim()||v.length>600))throw new Error('DSH世界字段不完整：'+key);
  }
  const time=timeTags.find(t=>t.id===data.timeTagId);
  if(!time)throw new Error('DSH返回的时间标签无效');
  const fixed=[[/侏罗纪/,'jurassic'],[/白垩纪/,'cretaceous'],[/三国演义|汉末三国/,'ce208']];
  for(const[pattern,id]of fixed)if(pattern.test(data.world)&&time.id!==id)throw new Error('DSH返回的世界与时间不一致，请重试');
  if(worldCases.some(c=>c.world===data.world))throw new Error('DSH照搬了内置世界名称，请重新创作；未伪装成新增案例');
  return {id:'dsh-world',world:data.world,time,timeIds:[time.id],society:data.society,themes:data.themes,conflict:data.conflict,tone:data.tone,direction:data.direction,opening:data.opening,beats:data.beats,roleChoice:trimText(data.roleChoice)||'由所选角色按人设决定旁观或介入，并保留选择的后果。'};
}
function customPatch(text) {
  const hash=createHash('sha256').update(text).digest('hex').slice(0,8);
  const named=text.match(/(?:【世界】|世界\s*[:：])\s*([^\n。！？；]{1,80})/);
  const world=named?.[1]?.trim()||'自定义世界 · '+hash;
  const conflict=text.match(/(?:【主要矛盾】|主要矛盾\s*[:：])\s*([^\n]{1,500})/)?.[1]?.trim()||'以已确认的用户正文为准，围绕其中的主题延续，不继承旧世界设定。';
  return {tripPrompt:text,tripSource:'user',tripCaseId:'',tripTimeId:'',tripGenerationId:'',tripMeta:JSON.stringify({world,conflict,beats:[]}),world,era:'',rules:conflict,tags:'',topic:'',textPrompt:text,referenceInstructions:'根据当前参考图需求创作已确认的新世界，不沿用旧旅行场景。',extraPrompt:'',carrierInstructions:'',sourceMode:'world',presentation:'illustration'};
}
export function createTripComposer({dir,llm,now=()=>new Date()}) {
  const drafts=join(dir,'world-drafts');
  return {
    async generate(config, seed='') {
      if(typeof seed!=='string'||seed.length>6000)throw new Error('创作方向过长');
      const available=typeof llm.listProviders==='function'?llm.listProviders():null;
      let provider=config.textProvider||'deepseek-account';
      if(available&&!available.some(p=>p.id===provider)){
        provider=['deepseek-account','deepseek-official'].find(id=>available.some(p=>p.id===id));
        if(!provider)throw new Error('DSH中没有可用的DeepSeek文本渠道，请先配置登录');
      }
      const writer={...config,textProvider:provider,textModel:config.textModel||'deepseek-flash'};
      const skill=await readPromptSkill('text',config.rolesEnabled);
      const schema={world:'全新世界名称',timeTagId:'从时间标签中选一项，世界优先',society:'社会形态',themes:['剧情主题：冒险/调查/交易等'],conflict:'持续提供每日事件灵感的主要矛盾',tone:'叙事基调：幽默/荒诞/温暖/严肃等',direction:'主要矛盾未来如何发展',opening:'一幕可画的开场小事，不写旅行角色名字',beats:['之后第一步','之后第二步','之后第三步'],roleChoice:'有旅行角色时如何自行判断旁观或介入；无角色时留空'};
      const task=[
        skill,'这次只执行世界案例创作，不生成图片。必须只返回完整JSON，不要Markdown或解释。结构：'+JSON.stringify(schema),
        '时间标签：'+JSON.stringify(timeTags),
        '下面是内置案例名称，必须额外创作新案例，不要照抄名称或拿模板当模型结果：'+JSON.stringify(worldCases.map(c=>c.world)),
        '新鲜度：'+randomUUID(),'用户方向：'+JSON.stringify(seed||'创作一个全新且自洽的旅行世界'),
        '旅行方式：'+(config.rolesEnabled===false?'观察世界，无旅行角色，不使用预设人物、日记或专属称呼':'角色旅行，偏好为'+JSON.stringify(config.characters||'当前选定角色')),
        '先决定世界，再选择与该世界相容的时间。侏罗纪不得配未来地球年份；小说世界标明原创同人平行分支、纪年由世界自身决定。主题是发生什么，基调是如何叙述，发展方向是以后如何变化，三个概念不要重复堆砌。每一天只需一件具体小事。opening与beats只写世界事件，不出现旅行角色姓名。',
      ].join('\n\n');
      let idea,previousError='';const attempts=[],start=Date.now();await mkdir(drafts,{recursive:true});
      for(let attempt=1;attempt<=3;attempt++){
        const began=Date.now();let stage='stream';
        try{
          const output=await streamText(llm,task+(previousError?'\n上次未完成，错误：'+previousError+'。请重新返回完整JSON，所有字段使用指定名称，务必给出正文。':''),{...writer,textTimeoutMs:Math.max(1000,Math.min(22000,65000-(Date.now()-start)))},attempt===1?2400:3000);
          stage='format';idea=parseIdea(output);attempts.push({attempt,kind:'success',ms:Date.now()-began});break;
        }catch(error){
          const message=error.message||'未知写稿错误',kind=/未返回提示词/.test(message)?'empty':stage==='format'?'format':/401|403|登录|credential|auth|余额|quota/i.test(message)?'account':'transport';
          attempts.push({attempt,kind,ms:Date.now()-began,error:message.slice(0,300)});previousError=message.slice(0,180);
          if(kind==='account'||attempt===3||Date.now()-start>=64000){await writeFile(join(drafts,'last-attempts.json'),JSON.stringify({at:now().toISOString(),provider:writer.textProvider,model:writer.textModel,attempts},null,2));throw Error('DSH创作未完成（'+kind+'，已尝试'+attempt+'次）：'+message+'；原稿保留');}
        }
      }
      await writeFile(join(drafts,'last-attempts.json'),JSON.stringify({at:now().toISOString(),provider:writer.textProvider,model:writer.textModel,attempts},null,2));
      const record={id:randomUUID(),source:'dsh',rolesEnabled:config.rolesEnabled!==false,createdAt:now().toISOString(),provider:writer.textProvider,model:writer.textModel,reasoningEffort:'off',attempts,idea};
      const prompt=renderWorldCase(idea,config);
      await mkdir(drafts,{recursive:true});const file=join(drafts,record.id+'.json'),temp=file+'.tmp';
      await writeFile(temp,JSON.stringify(record,null,2));await rename(temp,file);
      return {...record,prompt};
    },
    async confirm(config,choice={}) {
      const text=trimText(choice.text);let patch;
      if(text){if(text.length>6000)throw new Error('创作正文最多6000字');patch=customPatch(text);}
      else if(choice.caseId){patch=worldCasePatch(pickWorldCase({caseId:choice.caseId,timeId:choice.timeId}),config);}
      else if(choice.generationId){
        if(!uuid.test(choice.generationId))throw new Error('DSH创作凭据无效');
        let record;try{record=JSON.parse(await readFile(join(drafts,choice.generationId+'.json'),'utf8'));}catch{throw new Error('DSH创作记录不存在或已过期，请重新创作');}
        if(record.source!=='dsh'||record.id!==choice.generationId||!record.idea)throw new Error('DSH创作凭据无效');
        if(record.rolesEnabled!==(config.rolesEnabled!==false))throw new Error('旅行方式已改变，请重新让DSH创作');
        patch=worldCasePatch(record.idea,config);
        Object.assign(patch,{tripSource:'dsh',tripCaseId:'',tripGenerationId:record.id,tripMeta:JSON.stringify({...JSON.parse(patch.tripMeta),provider:record.provider,model:record.model,reasoningEffort:'off',createdAt:record.createdAt})});
      } else throw new Error('请先输入正文、摇一个预设或让DSH创作，再确认行程');
      patch.tripConfirmedAt=now().toISOString();
      patch.tripStartDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now().getTime()+86400000));
      return patch;
    },
  };
}
