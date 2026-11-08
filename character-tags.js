export const characterAliases={deepseek:['ds大肥鱼','deepseek鲸鱼娘','deepseek 鲸鱼娘','鲸鱼娘','大肥鱼'],gpt:['gpt龙娘','gpt 龙娘','龙娘'],claude:['claude大小姐','claude 大小姐','大小姐']};
export const characterFilters=[['all','全部旅行'],['deepseek','DS大肥鱼'],['gpt','GPT 龙娘'],['claude','Claude 大小姐'],['custom','自定义'],['none','观察世界']];
export function classifyCharacters(text='') {
  const value=typeof text==='string'?text.toLowerCase():'';
  const ids=Object.keys(characterAliases).filter(id=>characterAliases[id].some(alias=>value.includes(alias)));
  return ids.length?ids:['custom'];
}
export function imageCharacters(picture,record={}) {
  if(picture.rolesEnabled===false)return ['none'];
  if(Array.isArray(picture.characterIds)&&picture.characterIds.length&&picture.characterIds.every(id=>Object.hasOwn(characterAliases,id)||id==='custom'||id==='none')) return [...new Set(picture.characterIds)];
  if(picture.rolesEnabled!==true&&record.recipe?.rolesEnabled===false)return ['none'];
  return classifyCharacters(picture.story?.character||record.story?.character||record.recipe?.characters||record.settings?.characters||'');
}
export const characterPersonalities={
  deepseek:'大肥鱼像可爱的女儿，天真活泼、爱吃小零食，喜欢把新鲜见闻和小礼物分享给用户，亲近但不擅自改变对用户的称呼。',
  gpt:'龙娘好奇、爱冒险，有一点俏皮的自信，说话轻松温暖。',
  claude:'大小姐举止优雅、细心有礼，表达含蓄而亲近。',
  custom:'以用户给定的角色身份和性格说话，未指定时自然、亲切、简短。',
};
