import{test}from'node:test';import assert from'node:assert/strict';import{mkdtemp,readFile,readdir,rm}from'node:fs/promises';import{join,dirname}from'node:path';import{tmpdir}from'node:os';import{Readable}from'node:stream';import{normalizeDownloadDirectory,saveDownload,wallpaperFileName}from'./downloads.js';
test('导出名包含世界角色日期与真实尺寸，长世界名仍保留尾部信息',()=>{
 const picture={world:'季风拾穗浮岛群',referenceName:'苏萤',rolesEnabled:true,day:'2026-11-08',width:3840,height:2160};assert.equal(wallpaperFileName(picture),'季风拾穗浮岛群 · 苏萤 · 2026-11-08-3840×2160.png');
 const long=wallpaperFileName({...picture,world:'浮岛'.repeat(100)});assert.ok(Buffer.byteLength(long)<250);assert.match(long,/苏萤 · 2026-11-08-3840×2160.png$/);assert.doesNotMatch(long,/[<>:"/\\|?*]/);assert.match(wallpaperFileName({...picture,rolesEnabled:false}),/观察世界/);
});
test('自定义目录只接受绝对路径；导出并发重名不覆盖，失败不留下半张图片',async()=>{
 const root=await mkdtemp(join(tmpdir(),'travel-download-'));try{
  assert.equal(normalizeDownloadDirectory(''),'');assert.throws(()=>normalizeDownloadDirectory('../outside'),/绝对路径/);
  const target=join(root,'custom','folder'),paths=await Promise.all(Array.from({length:8},(_,i)=>saveDownload(target,'旅行.png',Readable.from([Buffer.from('image-'+i)]))));
  assert.equal(new Set(paths).size,8);for(let i=0;i<8;i++)assert.equal(await readFile(paths[i],'utf8'),'image-'+i);
  const safe=await saveDownload(target,'../../outside.png',Readable.from(['safe']));assert.equal(dirname(safe),target);
  await assert.rejects(saveDownload(target,'broken.png',Readable.from((async function*(){yield 'partial';throw Error('interrupted');})())),/interrupted/);
  assert.ok(!(await readdir(target)).includes('broken.png'));
 }finally{await rm(root,{recursive:true,force:true});}
});
