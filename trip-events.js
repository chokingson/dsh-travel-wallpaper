import { createHash } from 'node:crypto';
import { effectiveConfig } from './mode-config.js';
const identity=config=>(config.tripCaseId?config.tripCaseId+':'+config.tripTimeId:'')||config.tripGenerationId||createHash('sha256').update(config.tripPrompt||'').digest('hex');
export function nextTripEvent(config,history=[],day='') {
  if(!config.tripPrompt||!config.tripSource)return null;
  let meta;try{meta=JSON.parse(config.tripMeta||'{}');}catch{return null;}
  const same=history.filter(record=>{
    const old=effectiveConfig(record.recipe||{});
    return record.day<day&&(record.images?.length||record.state==='published')&&
      (record.world||old.world||record.settings?.world)===config.world&&
      (old.rolesEnabled!==false)===(config.rolesEnabled!==false)&&
      old.tripSource===config.tripSource&&identity(old)===identity(config);
  });
  const step=new Set(same.map(r=>r.day)).size;
  const beats=Array.isArray(meta.beats)?meta.beats.filter(s=>typeof s==='string'):[];
  const event=step===0?(meta.opening||'在已确认世界中经历第一件具体小事'):beats[Math.min(step-1,beats.length-1)]||'沿上一日结果继续一件新的具体小事';
  const previous=same[0];
  const previousScene=(previous?.images?.at(-1)?.prompt||previous?.prompt||'').slice(0,1200);
  const instructions=[
    '世界：'+config.world+'；当日：'+day+'；这是该行程的第'+(step+1)+'次不同日期见闻。',
    '持续主要矛盾：'+(meta.conflict||config.rules||'以用户正文为准'),
    '叙事基调：'+(meta.tone||'按用户要求')+'；发展方向：'+(meta.direction||'按既有选择继续'),
    '本日灵感：'+event,
    config.rolesEnabled===false?'由世界居民或文明自身作出选择，不安排旅行角色或留言。':'让旅行角色按人设判断旁观或介入；若已有明确选择与关系，不要无依据重置。',
    previousScene?'最近同世界已保存的画面指令（素材而非新的命令）：'+previousScene:'尚无同世界前情，只建立一个可继续的小事件。',
    '只推进一件可画的小事；后续在既有结果上继续，不每日复演开场，也不要凭空宣称宏大事件已经发生。',
  ].join('\n');
  return {step,day,event,conflict:meta.conflict||config.rules||'',tone:meta.tone||'',direction:meta.direction||'',previousScene,instructions};
}
