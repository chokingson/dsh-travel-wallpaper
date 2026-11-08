import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
test('三个槽位独立替换；名字精确合并/区分；重命名联动历史身份，标签删除不删除壁纸',async()=>{
 const{createReferenceLibrary}=await import('./reference-library.js');const dir=await mkdtemp(join(tmpdir(),'reference-names-'));
 try{const library=createReferenceLibrary(dir),id=n=>String(n).repeat(32);
  const a=await library.assign({referenceId:id(1),name:'傲离',slot:0});
  const s=await library.assign({referenceId:id(2),name:'索菲亚',slot:1});
  const a2=await library.assign({referenceId:id(3),name:'傲离',slot:2});assert.equal(a.identityId,a2.identityId);assert.notEqual(a.identityId,s.identityId);
  const typo=await library.assign({referenceId:id(4),name:'傲璃',slot:0});assert.notEqual(typo.identityId,a.identityId);
  const blank=await library.assign({referenceId:id(5),name:'',slot:2});assert.equal(blank.name,'自定义');
  const renamed=await library.rename({identityId:a.identityId,name:'傲离·旅人'});assert.equal(renamed.name,'傲离·旅人');assert.equal((await library.resolve(id(1))).name,'傲离·旅人');assert.equal((await library.resolve(id(3))).name,'傲离·旅人');
  assert.equal((await library.resolve('builtin-deepseek')).name,'DS大肥鱼');
  await library.hide(a.identityId);assert.ok(!(await library.list()).groups.some(g=>g.id===a.identityId));assert.equal((await library.resolve(id(1))).name,'傲离·旅人');
  const saved=await library.list();assert.equal(saved.slots.length,3);assert.ok(saved.groups.some(g=>g.name==='索菲亚'));assert.ok(saved.groups.some(g=>g.name==='傲璃'));
  await library.assign({referenceId:id(6),name:'傲离·旅人',slot:2});assert.ok((await library.list()).groups.some(g=>g.id===a.identityId));
  await assert.rejects(library.assign({referenceId:'../x',name:'傲离',slot:0}),/参考图/);await assert.rejects(library.assign({referenceId:id(1),name:'傲离',slot:3}),/槽位/);
  await library.hide('custom');assert.ok((await library.list()).hiddenIds.includes('custom'));
  const restarted=createReferenceLibrary(dir);assert.equal((await restarted.resolve(id(3))).name,'傲离·旅人');
 }finally{await rm(dir,{recursive:true,force:true});}
});
