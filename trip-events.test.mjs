import{test}from'node:test';import assert from'node:assert/strict';
test('同世界按主要矛盾推进事件，排除其它世界和其它角色模式的前情',async()=>{
 const{nextTripEvent}=await import('./trip-events.js');const{pickWorldCase,worldCasePatch}=await import('./world-cases.js');const config={...worldCasePatch(pickWorldCase({caseId:'asteroid-eve',random:()=>0}),{rolesEnabled:true}),rolesEnabled:true};
 const day1=nextTripEvent(config,[],'2026-11-08');assert.equal(day1.step,0);assert.match(day1.conflict,/陨石/);
 const history=[{day:'2026-11-07',world:config.world,recipe:config,images:[{prompt:'角色决定帮助幼龙并建立临时避难地'}]},{day:'2026-11-06',world:'其它世界',recipe:{...config,world:'其它世界'}},{day:'2026-11-05',recipe:{...config,rolesEnabled:false}}];
 const next=nextTripEvent(config,history,'2026-11-08');assert.equal(next.step,1);assert.match(next.previousScene,/帮助幼龙/);assert.notEqual(next.event,day1.event);assert.match(next.instructions,/主要矛盾|陨石/);assert.match(next.instructions,/旁观|介入/);
});
