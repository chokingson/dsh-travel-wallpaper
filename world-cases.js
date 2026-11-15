// Authored local examples. These are never represented as model responses.
export const timeTags = [
  ['cosmos','宇宙初开，约138亿年前'],['solar','太阳系形成，约46亿年前'],['earth','地球形成，约45.4亿年前'],
  ['life','原始生命海洋，约35亿年前'],['cambrian','寒武纪，约5.2亿年前'],['jurassic','侏罗纪，约1.55亿年前'],
  ['cretaceous','白垩纪末，约6600万年前'],['ice-age','冰河时代，约2万年前'],
  ['bce10000','公元前10000年'],['bce5000','公元前5000年'],['bce4000','公元前4000年'],['bce3000','公元前3000年'],
  ['bce2000','公元前2000年'],['bce1900','公元前1900年'],['bce1800','公元前1800年'],['bce1000','公元前1000年'],
  ['bce500','公元前500年'],['bce221','公元前221年'],['ce1','公元1年'],['ce50','公元50年'],['ce208','公元208年'],
  ['ce755','公元755年'],['ce1000','公元1000年'],['ce1405','公元1405年'],['ce1600','公元1600年'],['ce1800','公元1800年'],
  ['ce1850','公元1850年'],['ce1860','公元1860年'],['ce1870','公元1870年'],['ce1880','公元1880年'],['ce1900','公元1900年'],
  ['ce1912','公元1912年'],['ce1920','公元1920年'],['ce1930','公元1930年'],['ce1949','公元1949年'],['ce1950','公元1950年'],
  ['ce1955','公元1955年'],['ce1969','公元1969年'],['ce1980','公元1980年'],['ce1990','公元1990年'],['ce2000','公元2000年'],
  ['ce2002','公元2002年'],['ce2010','公元2010年'],['ce2011','公元2011年'],['ce2049','公元2049年'],['ce2077','公元2077年'],
  ['ce2149','公元2149年'],['ce2499','公元2499年'],['ce12499','公元12499年'],['fiction','世界自带的架空纪年'],
].map(([id,label])=>({id,label}));


import {approvedWorldData} from './world-cases-v2-data.js';
import {legacyWorldCases} from './world-cases-legacy.js';
export const worldAliases={'steampunk-port':'victoria'};
const complete=row=>({...row,worldRules:row.rules||[],themes:row.motifs||row.themes||[],motifs:row.motifs||row.themes||[],conflict:row.conflict||'',tone:row.tone||'',direction:row.direction||'',opening:row.opening||'',beats:row.beats||[]});
export const worldCases=approvedWorldData.map(complete);
export const retiredWorldCases=legacyWorldCases.filter(row=>!worldCases.some(c=>c.id===row.id)&&!worldAliases[row.id]).map(row=>({...complete(row),retired:true}));
export function pickWorldCase({caseId,timeId,random=Math.random,excludeId}={}){
 const resolved=worldAliases[caseId]||caseId;
 const pool=caseId?[...worldCases,...retiredWorldCases].filter(c=>c.id===resolved):worldCases.filter(c=>c.id!==excludeId);
 if(!pool.length)throw Error('世界案例不存在');
 const pick=list=>list[Math.min(list.length-1,Math.max(0,Math.floor(random()*list.length)))];
 const row=caseId?pool[0]:pick(pool),selected=timeId&&row.timeIds.includes(timeId)?timeId:pick(row.timeIds);
 return{...row,time:timeTags.find(t=>t.id===selected),...(caseId&&resolved!==caseId?{legacyAlias:caseId}:{})};
}
export function renderWorldCase(chosen,{rolesEnabled=true,characters='当前选定的旅行角色'}={}){
 const candidates=[...(chosen.candidates||[]),chosen.opening,...(chosen.beats||[])].filter(Boolean);
 return [
  '【世界】'+chosen.world,'【时间】'+chosen.time.label,
  chosen.environment&&'【环境】'+chosen.environment,chosen.society&&'【社会形态】'+chosen.society,
  (chosen.worldRules||chosen.rules||[]).length&&'【世界规则】'+(chosen.worldRules||chosen.rules).join('；'),
  (chosen.motifs||chosen.themes||[]).length&&'【世界要素】'+(chosen.motifs||chosen.themes).join('、'),
  rolesEnabled?'【旅行角色】'+characters+'。身份、外观和行动按当前已提交要求处理。':'【观察方式】不启用旅行主角；观察世界居民、生物、环境与事件，符合该世界的生命条件。',
  candidates.length&&'【候选灵感（尚未发生）】'+candidates.join('；'),
  '【连续性】世界资料、已发生事件、候选分支和当前提交要求分别处理，按已完成事件继续。画面遵循当前画风、画幅和文字设置。',
 ].filter(Boolean).join('\n\n');
}
export function worldCasePatch(chosen,options={}){
 const prompt=renderWorldCase(chosen,options),rules=chosen.worldRules||chosen.rules||[],motifs=chosen.motifs||chosen.themes||[],candidates=[...(chosen.candidates||[]),chosen.opening,...(chosen.beats||[])].filter(Boolean);
 return {tripPrompt:prompt,tripSource:'builtin',tripCaseId:chosen.id,tripTimeId:chosen.time.id,tripGenerationId:'',
  tripMeta:JSON.stringify({schemaVersion:2,world:chosen.world,time:chosen.time.label,environment:chosen.environment||'',society:chosen.society||'',worldRules:rules,motifs,candidates}),
  world:chosen.world,era:chosen.time.label,rules:[chosen.environment,chosen.society,...rules].filter(Boolean).join('\n'),tags:motifs.join('，'),textPrompt:prompt,
  referenceInstructions:options.rolesEnabled===false?'按当前观察世界需求处理参考素材。':'仅按当前参考需求使用角色身份特征，创作本次确认的世界画面。',
  extraPrompt:'',carrierInstructions:'',topic:'',sourceMode:'world',presentation:'illustration'};
}
