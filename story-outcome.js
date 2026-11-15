import {activeParty} from './party.js';
import{readFile}from'node:fs/promises';
import{streamText}from'./prompt-skills.js';
import{worldContext}from'./world-context.js';
import{nextTripEvent}from'./trip-events.js';
export const nextDayRules=[
 {id:'A',name:'探索',definition:'角色在当前世界的空间概念上发生移动，进行探索。'},
 {id:'B',name:'停留',definition:'角色停驻于该世界的某个空间场所，继续与该空间场所的任意“存有物”交互，包括但不限于人、事、生物、死物、现象、地形、场地、液体、固体、气体等。'},
 {id:'C',name:'意外',definition:'无任何情节预设，可以发生该世界的任何事件，包括但不限于与角色或当前世界有关、无关的事情，好事、坏事、惊喜、惊吓及其他意外情况。'},
];
export async function writeStoryOutcome(llm,story,config,history=[],{signal,random=Math.random}={}){
 const context=worldContext(config),day=story.publishedAt||'';
 const event=Array.isArray(story.worldEvent?.historyEntries)?story.worldEvent:nextTripEvent(config,history,day),entries=event.historyEntries;
 const plan=story.nextDayPlan?.day===day?story.nextDayPlan:null;
 const isNextDay=Boolean(entries.length&&entries.at(-1).day<day);
 const chosen=plan?nextDayRules.find(r=>r.id===plan.choice):isNextDay?nextDayRules[Math.min(2,Math.max(0,Math.floor(random()*3)))]:null;
 const skill=await readFile(new URL('./skills/travel-story-continuation/SKILL.md',import.meta.url),'utf8');
 const request=event.currentRequest||'';
 const party=activeParty(config),structuredParty=Array.isArray(config.party)&&party.length>0;
 const protocol=structuredParty?'\n本次额外输出协议：只返回JSON：{"description":"本次已确定事件正文","depictedMemberIds":["本图实际出镜的同行编号"]}。默认所有同行者出镜；仅在用户明确指定本图只画其中一些或不画同行者时使用相应子集，未出镜者仍属于旅行队伍。编号只能来自party，不得把场景居民加入固定队伍。':' ';
 const result=await streamText(llm,skill+protocol+'\n\n'+JSON.stringify({
  day,worldFacts:context.facts,userWorldText:context.structured?'':config.tripPrompt||'',userWorldRules:context.structured?'':config.rules||'',textRequirements:context.textRequirements,
  referenceRequirements:config.imageToImage?config.referenceInstructions||'':'',extraRequirements:config.extraPrompt||'',
  party:activeParty(config),rolesEnabled:config.rolesEnabled!==false,characters:config.rolesEnabled===false?'':config.characters||'',
  committedHistory:entries,
  currentRequest:request,nextDayRule:chosen?.definition||'',nextDayCustom:plan?.text||'',candidateInspiration:context.inspiration,
 }),{...config,textAbortSignal:signal},1600);
 if(structuredParty){let data;try{data=JSON.parse(result.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}catch{throw Error('本次事件与出镜成员格式不完整');}
 if(typeof data?.description!=='string'||!data.description.trim()||data.description.length>6000||!Array.isArray(data.depictedMemberIds)||new Set(data.depictedMemberIds).size!==data.depictedMemberIds.length||data.depictedMemberIds.some(id=>!party.some(actor=>actor.id===id)))throw Error('本次事件或出镜成员无效');
 story.depictedMemberIds=[...data.depictedMemberIds];return data.description.trim();}
 if(result.length>6000)throw Error('本次事件描述过长，原稿保留');
 return result;
}
export function sceneDescription(prompt){return String(prompt||'').split(/【画面】\r?\n/).at(-1).split(/\n\n(?:【世界与要求】|【角色画风】|目标尺寸)/)[0].trim();}

// Reapplying an old image changes the desktop, not the order of committed story events.
export function commitStoryOutcome(record,at){
 record.firstPublishedAt??=record.state==='published'&&record.appliedAt?record.appliedAt:at;
 const commit=outcome=>outcome&&typeof outcome==='object'?{...outcome,status:'committed',committedAt:outcome.committedAt??record.firstPublishedAt}:outcome;
 for(const picture of record.images||[]){
  const outcome=picture.storyOutcome||picture.story?.storyOutcome;
  if(outcome){picture.storyOutcome=commit(outcome);if(picture.story)picture.story.storyOutcome=picture.storyOutcome;}
 }
 record.storyOutcome=record.images?.[0]?.storyOutcome||commit(record.storyOutcome||record.story?.storyOutcome);
 if(record.story&&record.storyOutcome)record.story.storyOutcome=record.storyOutcome;
 return record;
}
