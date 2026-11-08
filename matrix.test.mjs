import{test}from'node:test';import assert from'node:assert/strict';import{styles,worlds,normalizeConfig,splitPrompt}from'./catalog.js';import{characters}from'./references.js';import{compilePrompt,effectiveConfig}from'./prompt-skills.js';
test('20画风×8世界×5角色方式×4类tag×2生图方式：6400组提示词与隔离回归',async()=>{
 const roles=[...characters.map(c=>({character:c.character,enabled:true})),{character:'自定义旅人阿青（青衣、木簪）',enabled:true},{character:'隐藏的DS大肥鱼',enabled:false}];
 const tags=['晨雾，纸鸢，渡船','cyberpunk, rain, neon','<tag>&"自由编辑"',''];let cases=0;
 for(const style of styles)for(const[era,world]of worlds)for(const role of roles)for(const tag of tags)for(const imageToImage of [false,true]){
  const config=normalizeConfig({rolesEnabled:role.enabled,styleId:style.id,style:style.prompt,era,world,characters:role.character,tags:tag,observerTags:tag,
   textPrompt:'在世界中经历一件简单小事',observerTextPrompt:'观察雨后的第一班船',rules:'一件生活小事',observerRules:'一件世界小事',usePromptSkills:false,promptMode:'direct',
   imageToImage,referenceId:'builtin-deepseek',referenceInstructions:'保留旅行角色的形象',observerImageToImage:imageToImage,observerReferenceId:'a'.repeat(32),observerReferenceInstructions:'只借鉴景观和配色',width:1920,height:1080});
  const prompt=await compilePrompt(null,{title:world,character:role.character},config,[]);const parts=splitPrompt(prompt,style.prompt);const actual=effectiveConfig(config);
  assert.equal(parts[0].kind,'style');assert.ok(parts[0].text.includes(style.prompt));assert.ok(prompt.includes(world));assert.ok(prompt.includes(era));if(tag)assert.ok(prompt.includes(tag));assert.ok(prompt.includes('1920×1080'));
  if(role.enabled)assert.ok(prompt.includes(role.character));else{assert.doesNotMatch(prompt,/隐藏的DS大肥鱼|保留旅行角色的形象/);assert.equal(actual.diaryEnabled,false);assert.match(prompt,/观察世界/);}
  if(imageToImage&&role.enabled)assert.ok(prompt.includes('【参考图需求】'));else assert.equal(actual.referenceId,'');if(!role.enabled)assert.doesNotMatch(prompt,/【场景参考】/);cases++;
 }
 assert.equal(cases,6400);
});
