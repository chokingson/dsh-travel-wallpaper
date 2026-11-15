import{test}from'node:test';import assert from'node:assert/strict';
import{worldCases,timeTags,pickWorldCase,renderWorldCase,worldCasePatch,retiredWorldCases}from'./world-cases.js';
test('50默认世界保持事实与稳定ID，合并别名和退休定义不破坏旧引用',()=>{
 assert.equal(worldCases.length,50);assert.equal(timeTags.length,50);assert.equal(new Set(worldCases.map(c=>c.id)).size,50);
 for(const row of worldCases){assert.ok(row.environment&&row.society&&row.worldRules.length);assert.equal(row.beats.length,0);assert.equal(row.opening,'');for(const id of row.timeIds)assert.ok(timeTags.some(t=>t.id===id));}
 for(const r of [0,.2,.99])assert.equal(pickWorldCase({caseId:'jurassic',random:()=>r}).time.id,'jurassic');
 const merged=pickWorldCase({caseId:'steampunk-port'});assert.equal(merged.id,'victoria');assert.equal(merged.world,'蒸汽雾都');assert.equal(merged.legacyAlias,'steampunk-port');
 assert.equal(pickWorldCase({caseId:'steampunk-port',timeId:'fiction'}).time.id,'fiction');
 assert.ok(!worldCases.some(c=>c.id==='asteroid-eve'));assert.ok(retiredWorldCases.some(c=>c.id==='asteroid-eve'));assert.equal(pickWorldCase({caseId:'asteroid-eve'}).id,'asteroid-eve');
 assert.equal(pickWorldCase({caseId:'elf-machinery'}).world,'精灵之森');
});
test('世界模板只固定环境规则，角色身份与剧情结果留给本次提交',()=>{
 const chosen=pickWorldCase({caseId:'dinosaur-cultivation'}),role=renderWorldCase(chosen,{characters:'角色甲'}),observer=renderWorldCase(chosen,{rolesEnabled:false,characters:'角色甲'});
 assert.match(role,/角色甲/);assert.match(role,/【环境】|【世界规则】/);assert.doesNotMatch(role,/【主要矛盾】|【叙事基调】|【每日延续】|第一幕/);assert.doesNotMatch(observer,/角色甲/);assert.match(observer,/观察方式/);
 const patch=worldCasePatch(chosen,{rolesEnabled:false}),meta=JSON.parse(patch.tripMeta);assert.equal(patch.tripSource,'builtin');assert.equal(patch.tripCaseId,'dinosaur-cultivation');assert.equal(meta.schemaVersion,2);assert.equal(meta.candidates.length,0);assert.ok(meta.worldRules.length);assert.equal(patch.extraPrompt,'');
});
