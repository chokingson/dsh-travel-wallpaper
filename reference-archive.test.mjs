import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,mkdir,writeFile,rm}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';import{createReferenceLibrary}from'./reference-library.js';import{readWorldArchive}from'./archive.js';
test('参考图精确身份联动已到访世界：新上传不丢旧图，同名归并，改名历史同步，无图按观察世界',async()=>{
 const home=await mkdtemp(join(tmpdir(),'ref-archive-')),dir=join(home,'issues'),library=createReferenceLibrary(join(home,'references'));await mkdir(dir);
 try{const one='1'.repeat(32),two='2'.repeat(32),three='3'.repeat(32);const a=await library.assign({referenceId:one,name:'傲离',slot:0});const s=await library.assign({referenceId:two,name:'索菲亚',slot:1});await library.assign({referenceId:three,name:'傲离',slot:2});
  for(const [i,ref,world]of[[1,one,'蒸汽城'],[2,two,'月宫'],[3,three,'雨港'],[4,'','无角色的海洋']]){const day='2026-11-'+String(i).padStart(2,'0'),imageFile=day+'.png';await writeFile(join(dir,imageFile),Buffer.from('x'));await writeFile(join(dir,day+'.json'),JSON.stringify({day,recipe:{characters:'旧三国角色'},images:[{imageFile,referenceId:ref,world,rolesEnabled:true,story:{character:'猜错的角色'},prompt:'见闻'}]}));}
  let archive=await readWorldArchive(dir,{character:a.identityId,referenceLibrary:library});assert.equal(archive.worlds.length,2);assert.ok(archive.images.every(p=>p.referenceName==='傲离'));
  assert.equal((await readWorldArchive(dir,{character:s.identityId,referenceLibrary:library})).total,1);
  await library.rename({identityId:a.identityId,name:'傲离旅人'});archive=await readWorldArchive(dir,{character:a.identityId,referenceLibrary:library});assert.ok(archive.images.every(p=>p.referenceName==='傲离旅人'));assert.ok(archive.filters.some(([id,name])=>id===a.identityId&&name==='傲离旅人'));
  const observer=await readWorldArchive(dir,{character:'none',referenceLibrary:library});assert.equal(observer.total,1);assert.equal(observer.images[0].rolesEnabled,false);assert.equal(observer.images[0].diary,null);
  await library.hide(a.identityId);assert.ok(!(await readWorldArchive(dir,{referenceLibrary:library})).filters.some(([id])=>id===a.identityId));assert.equal((await readWorldArchive(dir,{referenceLibrary:library})).total,4);
 }finally{await rm(home,{recursive:true,force:true});}
});
