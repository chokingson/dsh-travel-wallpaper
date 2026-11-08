import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const png=Buffer.from('89504e470d0a1a0a','hex');
test('世界相册收录全部历史，兼容旧图、多图、缺世界资料，跳过无图任务与坏记录', async()=>{
  const { readWorldArchive }=await import('./archive.js');
  const dir=await mkdtemp(join(tmpdir(),'travel-archive-'));
  try {
    for(let i=0;i<70;i++){
      const day=new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10);
      await writeFile(join(dir,day+'.json'),JSON.stringify({day,createdAt:i,settings:{world:i===0?'  三国  江东  ':'三国 江东'},story:{title:'旧期'+i},prompt:'提示'+i}));
      await writeFile(join(dir,day+'.png'),png);
    }
    await writeFile(join(dir,'2026-05-01-abcd.json'),JSON.stringify({day:'2026-05-01',createdAt:100,recipe:{world:'水下城'},images:[{imageFile:'2026-05-01-abcd.png',story:{title:'访海'},prompt:'海底'},{imageFile:'2026-05-01-abcd-02.png',world:'水下城',story:{title:'鲸鱼'},prompt:'鲸尾'}]}));
    for(const file of ['2026-05-01-abcd.png','2026-05-01-abcd-02.png','2026-06-01.png']) await writeFile(join(dir,file),png);
    await writeFile(join(dir,'2026-06-01.json'),JSON.stringify({day:'2026-06-01',story:{title:'早期作品'},prompt:'原稿'}));
    await writeFile(join(dir,'2026-07-01.json'),JSON.stringify({day:'2026-07-01',recipe:{world:'还没出图'},images:[],pending:{prompt:'不能当壁纸'}}));
    await writeFile(join(dir,'2026-08-01.json'),'{坏JSON');
    await writeFile(join(dir,'2026-08-02.json'),JSON.stringify({day:'2026-08-02',settings:{world:'丢图'},imageFile:'2026-08-02.png'}));
    await writeFile(join(dir,'2026-08-03.json'),JSON.stringify({day:'2026-08-03',settings:{world:'坏路径'},imageFile:'../../config.json'}));
    await writeFile(join(dir,'latest.json'),JSON.stringify({day:'2026-06-01',settings:{world:'不应重复'}}));
    const archive=await readWorldArchive(dir);
    assert.equal(archive.worlds.length,3); assert.equal(archive.total,73); assert.equal(archive.skipped,2);
    const kingdom=archive.worlds.find(w=>w.name==='三国 江东');
    assert.equal(kingdom.count,70);assert.equal(kingdom.days,70);assert.equal(kingdom.firstDay,'2026-01-01');assert.equal(kingdom.lastDay,'2026-03-11');
    assert.equal(archive.images.filter(i=>i.worldId===kingdom.id).length,70);
    assert.equal(archive.worlds.find(w=>w.name==='水下城').count,2);
    assert.equal(archive.worlds.find(w=>w.name==='未记录世界').count,1);
    assert.ok(archive.images.every(i=>i.image.startsWith('/api/planet-news?image=')));
    const again=await readWorldArchive(dir);assert.equal(again.worlds.find(w=>w.name==='三国 江东').id,kingdom.id);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('世界接口分页可取到60期之外的旧图，世界归属不随当前设置改变', async()=>{
  const { apply }=await import('./index.js');
  const oldHome=process.env.DSH_HOME,home=await mkdtemp(join(tmpdir(),'travel-world-api-'));
  const dir=join(home,'planet-news','issues'); await mkdir(dir,{recursive:true});
  await writeFile(join(home,'planet-news','config.json'),JSON.stringify({enabled:false,world:'现在是别的世界'}));
  for(let i=0;i<66;i++){
    const day=new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10);
    await writeFile(join(dir,day+'.json'),JSON.stringify({day,createdAt:i,settings:{world:'原来的三国'},prompt:'原提示词'+i,story:{title:'第'+i+'天'}}));
    await writeFile(join(dir,day+'.png'),png);
  }
  process.env.DSH_HOME=home;let route;const cleanups=[];
  apply({effect(fn){const cleanup=fn();if(typeof cleanup==='function')cleanups.push(cleanup);},webServer:{register(value){route=value;return()=>{};}},llm:{}});
  const server=createServer((req,res)=>route.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const catalog=await (await fetch(base+'?worlds')).json();assert.equal(catalog.worlds[0].count,66);
    assert.equal((await fetch(base+'?worlds&character=invalid')).status,400);
    assert.equal((await (await fetch(base+'?worlds&character=gpt')).json()).total,0);
    assert.equal((await (await fetch(base+'?worlds&character=none')).json()).total,66);
    const id=catalog.worlds[0].id;assert.equal(catalog.worlds[0].name,'原来的三国');
    const first=await (await fetch(base+'?world='+id)).json();assert.equal(first.issues.length,48);assert.equal(first.nextOffset,48);
    const rest=await (await fetch(base+'?world='+id+'&offset=48')).json();assert.equal(rest.issues.length,18);assert.equal(rest.nextOffset,null);
    assert.equal(rest.issues.at(-1).prompt,'原提示词0');assert.equal(rest.world.name,'原来的三国');
    assert.equal((await fetch(base+'?world=../../config')).status,400);
    assert.equal((await fetch(base+'?world='+'a'.repeat(24))).status,404);
    assert.equal((await fetch(base+'?world='+id+'&offset=-1')).status,400);
  }finally{
    cleanups.forEach(fn=>fn());await new Promise(r=>server.close(r));
    if(oldHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=oldHome;
    await rm(home,{recursive:true,force:true});
  }
});

test('结构损坏的标题、提示词片段或缺少日期的档案不会进入可点击相册', async()=>{
  const {readWorldArchive}=await import('./archive.js');const dir=await mkdtemp(join(tmpdir(),'travel-bad-archive-'));
  try{
    const records=[
      {day:'2026-01-01',settings:{world:'坏标题'},story:{title:{text:'异常'}},prompt:'p'},
      {day:'2026-01-02',settings:{world:'坏片段'},images:[{imageFile:'2026-01-02.png',story:{title:'图'},prompt:'p',promptParts:{length:1}}]},
      {},
      {day:'2026-01-04',settings:{world:'坏数组'},images:{0:{imageFile:'2026-01-04.png'}}},
      {day:'2026-01-05',settings:{world:'正常世界'},story:{title:'正常图'},prompt:'原文'},
    ];
    for(const [index,record]of records.entries()){
      const day=`2026-01-0${index+1}`;await writeFile(join(dir,day+'.json'),JSON.stringify(record));await writeFile(join(dir,day+'.png'),png);
    }
    const archive=await readWorldArchive(dir);assert.equal(archive.total,1);assert.equal(archive.skipped,4);assert.equal(archive.worlds[0].name,'正常世界');
    assert.equal(archive.images[0].title,'正常图');assert.ok(Array.isArray(archive.images[0].parts));
  }finally{await rm(dir,{recursive:true,force:true});}
});
