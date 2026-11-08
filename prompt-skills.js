import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { promptParts } from './catalog.js';
import { effectiveConfig, observationGuard } from './mode-config.js';
export { effectiveConfig } from './mode-config.js';

export const placeholders = {
  observerText:'观察世界：画风＋画幅＋时代与世界＋环境景观＋正在发生的一件小事＋天气光线＋文字或无文字。\n例如：水彩，16:9，雨后清晨的未来浮岛，第一班无人飞艇靠站，云雾正散开，全息牌写“云海站”，不设置旅行主角。',
  observerReference:'只参考图片的场景／建筑／景观／配色／画风，重新创作一个世界观察画面，不保留原图人物。\n例如：参考建筑与光线，把场景变成雨后浮岛港口，16:9，第一班飞艇进站；画面不要旅行主角，也不写角色留言。',
  text: '文生图：画风＋画幅＋人物／生物＋景观＋人物或生物的姿势状态＋文字图或非文字图＋时代＋世界／所处空间。没想到的细节请帮我补充。\n例如：2.5D国风，16:9，DeepSeek鲸鱼娘撑伞走过民国江南雨巷，石桥与河灯，竹简上写“下一站烟雨”，补充合适的光线与构图。',
  reference: '参考图片的：画风＋画幅＋人物／生物＋景观＋姿势状态＋文字或非文字＋时代＋世界／空间；没想到的请补充。\n生成一幅新壁纸，要求使用新的：画风＋画幅＋人物／生物＋景观＋姿势状态＋文字或非文字＋时代＋世界／空间。\n例如：保留图中鲸鱼娘的面容、头鳍和鲸尾，改成水彩；她坐飞艇前往未来浮岛，16:9，全息屏写“云海站”，其余细节请补充。',
};
export const carriers = [ ['auto','随世界选择'],['broadcast','新闻演播屏'],['newspaper','纸媒／报纸'],['bamboo','竹简／卷轴'],['stone','石壁刻字'],['hologram','全息投影'],['billboard','城市广告大屏'],['monitor','电脑／办公桌显示器'],['alien','外星科技显示器'],['custom','自定义载体'] ];
export async function readPromptSkill(mode,rolesEnabled=true) {
  const name = rolesEnabled===false?'travel-world-observation':mode === 'reference' ? 'travel-image-to-image' : 'travel-text-to-image';
  return readFile(new URL(`./skills/${name}/SKILL.md`, import.meta.url), 'utf8');
}
export async function streamText(llm, task, config, maxTokens = 1800) {
  if (!llm?.stream) throw new Error('DSH文本服务不可用');
  let output = '';
  for await (const chunk of llm.stream({ provider: config.textProvider || 'deepseek-account', model: config.textModel || 'deepseek-flash',
    reasoningEffort: 'off', maxTokens, messages: [{ role: 'user', content: [{ type: 'text', text: task }] }], signal: AbortSignal.timeout(config.textTimeoutMs||60_000) })) {
    if (chunk.type === 'text-delta') output += chunk.text;
    if (chunk.type === 'finish' && ['error','aborted','length'].includes(chunk.reason)) throw new Error(`DSH写稿未完成（${chunk.reason}），未改变设置`);
  }
  if (!output.trim()) throw new Error('DSH未返回提示词，请重试');
  return output.trim();
}
export async function compilePrompt(llm, story, rawConfig, history = []) {
  const config = effectiveConfig(rawConfig);
  if(config.rolesEnabled===false) {
    story={...story,...(story.character?{title:[config.world,story.publishedAt].filter(Boolean).join(' · ')}:{}),character:''};
    history=history.filter(item=>item.rolesEnabled===false||item.characterIds?.includes('none'));
  }
  if(config.tripSource)history=history.filter(item=>(effectiveConfig(item.recipe||{}).world||item.settings?.world||item.world)===config.world);
  let tripPrompt=config.tripPrompt;
  if(config.interactionPrompt)story={...story,userIntervention:config.interactionPrompt,excerpt:(story.excerpt||'')+'\n'+config.interactionPrompt};
  if(['builtin','dsh'].includes(config.tripSource)&&config.rolesEnabled!==false&&tripPrompt){
    let roleChoice;try{roleChoice=JSON.parse(config.tripMeta||'{}').roleChoice;}catch{}
    tripPrompt=tripPrompt.replace(/【旅行角色】[\s\S]*?(?=\n\n【|$)/,'【旅行角色】'+(config.characters||'当前选定的旅行角色')+'。'+(roleChoice||'按当前人设判断旁观或介入，延续既有选择。'));
  }
  const userPrompt = tripPrompt?.trim()
    ? tripPrompt+(config.imageToImage&&config.referenceInstructions?'\n\n参考图补充要求：'+config.referenceInstructions:'')
    : config.imageToImage ? config.referenceInstructions : config.textPrompt;
  const fallback = `${story.title || config.topic || config.world || '一次新的旅行'}。${story.character || config.characters || ''}。${story.excerpt || ''}`;
  let scene = userPrompt?.trim() || fallback;
  if(config.interactionPrompt)scene+='\n\n'+config.interactionPrompt;
  if (config.usePromptSkills !== false && config.promptMode !== 'direct') {
    const skill = await readPromptSkill(config.imageToImage ? 'reference' : 'text',config.rolesEnabled);
    scene = await streamText(llm, `${skill}\n\n按照此Skill整理下面的数据，只输出最终生图提示词。参考图是否启用：${Boolean(config.imageToImage)}。用户具体要求优先；未填写的示例不在数据中。\n${JSON.stringify({ userPrompt: userPrompt || '', story, character: config.characters,
      style: config.style, era: config.era, world: config.world, tags: config.tags, rules: config.rules, extraPrompt: config.extraPrompt,
      textDensity: config.textDensity, textCarrier: config.textCarrier, textContent: config.textContent, carrierInstructions: config.carrierInstructions,
      referenceInstructions: config.referenceInstructions, width: config.width || 1920, height: config.height || 1080,
      previousTopics: history.map(item=>item.story?.title).filter(Boolean).slice(0,4) })}`, config);
  }
  if(config.tripSource&&story.excerpt)scene+='\n\n【当日事件推进】\n'+story.excerpt;
  return promptParts({ ...config, characters: story.character || config.characters }, scene).map(part=>part.text).join('');
}
export async function generateWorld(llm, config, seed = '') {
  config=effectiveConfig(config);
  const skill = await readPromptSkill('text',config.rolesEnabled);
  const fields = { topic:'新主题',world:'新世界',era:'时代',tags:'逗号分隔的视觉标签',characters:'旅行角色与本次身份／状态',rules:'文明与故事设定',style:'画风短描述',
    textDensity:'none或sparse或rich',textCarrier:carriers.map(item=>item[0]).join('/'),textContent:'一句显示在载体上的文案；无字时为空',textPrompt:'一段完整的用户创作需求' };
  if(config.rolesEnabled===false)delete fields.characters;
  const direction=config.rolesEnabled===false?observationGuard:`旅行角色偏好：${JSON.stringify(config.characters||'DeepSeek鲸鱼娘')}。角色可延续但本次身份和状态要变化。`;
  const text = await streamText(llm, `${skill}\n\n执行随机旅行世界任务。一次返回完整JSON，不要Markdown，不要解释。全部字段：${JSON.stringify(fields)}。\n新鲜度种子 ${randomUUID()}。用户主题：${JSON.stringify(seed || '随机全新世界')}。${direction}换一个时代、空间和活动；生成全部字段，不沿用旧世界。文字载体符合时代，不默认新闻演播室。额外要求另由用户填写，不要生成。`, config, 1300);
  let data;
  try { data = JSON.parse(text.replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')); } catch { throw new Error('随机世界未返回完整JSON，请再摇一次；原设置未修改'); }
  if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('随机世界字段不完整');
  for (const key of Object.keys(fields)) if (typeof data[key] !== 'string' || (key !== 'textContent' && !data[key].trim()) || data[key].length > 3000) throw new Error(`随机世界字段不完整：${key}`);
  if (!['none','sparse','rich'].includes(data.textDensity) || !carriers.some(item=>item[0]===data.textCarrier)) throw new Error('随机世界的文字载体字段无效');
  const referenceInstructions = config.rolesEnabled===false
    ? `只借鉴所选场景参考图的环境、建筑、配色与构图，不保留人物，重新创作以下世界与事件：${data.textPrompt}`
    : `借鉴所选参考图中旅行角色的身份与识别特征，按以下新世界、活动与画风创作新的壁纸，不重画原场景：${data.textPrompt}`;
  return { ...Object.fromEntries(Object.keys(fields).map(key=>[key,data[key]])), referenceInstructions, carrierInstructions:'', extraPrompt:'', styleId:'custom' };
}
