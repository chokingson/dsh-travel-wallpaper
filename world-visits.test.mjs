import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createWorldVisits} from './world-visits.js';
import {worldCases} from './world-cases.js';
import {readWorldArchive} from './archive.js';
test('成功档案按世界ID迁移；候选不扣池，50世界完成才开启下一轮，重启不倒灌旧记录',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'travel-visits-'));let visits=createWorldVisits({directory:dir});
 const rows=worldCases.map((w,i)=>({issueId:'issue-'+i,caseId:w.id,at:i}));
 try{
  await visits.sync(rows.slice(0,49));let state=await visits.progress();assert.equal(state.visited,49);assert.equal(state.cycleVisited,49);
  for(let i=0;i<3;i++)assert.equal((await visits.pick({random:()=>0})).id,worldCases[49].id,'反复摇候选不冒充成功到访');
  await visits.sync(rows);state=await visits.progress();assert.equal(state.visited,50);assert.equal(state.cycle,1);
  assert.ok((await visits.pick({random:()=>0})).id);state=await visits.progress();assert.equal(state.cycle,2);assert.equal(state.cycleVisited,0);assert.equal(state.visited,50);
  visits=createWorldVisits({directory:dir});await visits.sync(rows);assert.equal((await visits.progress()).cycleVisited,0);
  await visits.sync([...rows,{issueId:'revisit',caseId:worldCases[0].id,at:51}]);assert.equal((await visits.progress()).cycleVisited,1);assert.notEqual((await visits.pick({random:()=>0})).id,worldCases[0].id);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('身份别名兼容但同名自定义世界不计预设；未发布/缺图不计成功到访',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'travel-visits-archive-'));
 try{
  await mkdir(join(dir,'issues'));const records=[['2026-11-01','published',{tripSource:'builtin',tripCaseId:'steampunk-port',world:'蒸汽雾都'},true],['2026-11-02','creating',{tripSource:'builtin',tripCaseId:'jurassic'},true],['2026-11-03','published',{tripSource:'builtin',tripCaseId:'frog-world'},false],['2026-11-04','published',{tripSource:'user',tripCaseId:'frog-world',world:'蛙世界'},true]];
  for(const [day,state,recipe,image]of records){await writeFile(join(dir,'issues',day+'.json'),JSON.stringify({day,state,recipe,images:[{imageFile:day+'.png',world:recipe.world||'世界'}]}));if(image)await writeFile(join(dir,'issues',day+'.png'),'image');}
  const archive=await readWorldArchive(join(dir,'issues'));assert.deepEqual(archive.presetVisits.map(r=>r.caseId),['victoria']);
  const visits=createWorldVisits({directory:dir});await visits.sync(archive.presetVisits);assert.equal((await visits.progress()).visited,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
