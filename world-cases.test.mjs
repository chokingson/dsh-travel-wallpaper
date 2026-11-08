import{test}from'node:test';import assert from'node:assert/strict';
test('50世界与50时间标签完整、互不重复，世界优先限制时间而不是任意乱拼',async()=>{
 const{worldCases,timeTags,pickWorldCase,renderWorldCase}=await import('./world-cases.js');assert.equal(worldCases.length,50);assert.equal(timeTags.length,50);assert.equal(new Set(worldCases.map(c=>c.id)).size,50);assert.equal(new Set(timeTags.map(t=>t.id)).size,50);
 for(const c of worldCases){for(const key of ['world','society','conflict','tone','direction','opening'])assert.ok(typeof c[key]==='string'&&c[key].length>3,c.id+':'+key);assert.ok(c.themes.length>=1);assert.ok(c.beats.length>=3);assert.ok(c.timeIds.length);for(const id of c.timeIds)assert.ok(timeTags.some(t=>t.id===id));}
 const jurassic=worldCases.find(c=>c.id==='jurassic');for(const r of [0,.2,.99]){const chosen=pickWorldCase({caseId:jurassic.id,random:()=>r});assert.equal(chosen.time.id,'jurassic');assert.match(renderWorldCase(chosen,{rolesEnabled:false}),/侏罗纪/);}
 const victoria=pickWorldCase({caseId:'victoria',random:()=>.99});assert.match(victoria.time.label,/18[5689]0|1870/);assert.ok(worldCases.some(c=>c.world.includes('三体')));assert.ok(worldCases.some(c=>c.world.includes('诡秘')));assert.ok(worldCases.some(c=>c.world.includes('三国演义')));
});
test('模板正文区分主题/基调/主矛盾，角色存在与否明确且同世界日常可推进',async()=>{
 const{pickWorldCase,renderWorldCase,worldCasePatch}=await import('./world-cases.js');const chosen=pickWorldCase({caseId:'dinosaur-cultivation',random:()=>0});const a=renderWorldCase(chosen,{rolesEnabled:true,characters:'DS大肥鱼'}),b=renderWorldCase(chosen,{rolesEnabled:false,characters:'DS大肥鱼'});assert.match(a,/DS大肥鱼/);assert.match(a,/旁观|介入/);assert.match(a,/主要矛盾/);assert.match(a,/剧情主题/);assert.match(a,/叙事基调/);assert.doesNotMatch(b,/DS大肥鱼|给主人/);assert.match(b,/世界居民/);
 const patch=worldCasePatch(chosen,{rolesEnabled:false});assert.equal(patch.tripSource,'builtin');assert.equal(patch.tripCaseId,'dinosaur-cultivation');assert.match(patch.rules,/主要矛盾/);assert.ok(patch.tripPrompt.includes(chosen.world));assert.equal(patch.extraPrompt,'');
});
