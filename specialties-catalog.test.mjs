import test from'node:test';import assert from'node:assert/strict';import{approvedWorldData}from'./world-cases-v2-data.js';
test('50 fixed collectibles map exactly to approved worlds with stable IDs, complete facts and white anime item prompts',async()=>{
 const {specialties}=await import('./specialties-catalog.js');assert.equal(specialties.length,50);assert.equal(new Set(specialties.map(item=>item.id)).size,50);
 assert.deepEqual(new Set(specialties.map(item=>item.worldCaseId)),new Set(approvedWorldData.map(world=>world.id)));
 for(const [index,item]of specialties.entries()){
  assert.equal(item.number,String(index+1).padStart(3,'0'));assert.equal(item.id,'specialty:'+item.worldCaseId+':01');assert.equal(item.living,false);
  for(const field of ['name','appearance','properties','localUse','visualManifestation','prompt','imageFile'])assert.ok(typeof item[field]==='string'&&item[field].length>(field==='name'?1:4),item.worldCaseId+' '+field);
  assert.match(item.prompt,/纯白背景/);assert.match(item.prompt,/二次元动漫/);assert.match(item.prompt,/不含文字/);assert.doesNotMatch(item.prompt,/剪影|GTA|京东|西游记|110件/);
 }
 assert.ok(new Set(specialties.map(item=>item.category)).size>=6);assert.ok(specialties.some(item=>item.category==='soul'));assert.ok(specialties.some(item=>item.category==='phenomenon'));
});
test('50张正式图均随包存在，清单哈希一致、尺寸统一、没有重复或占位资源',async()=>{
 const{readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{default:sharp}=await import('sharp');const{specialties}=await import('./specialties-catalog.js');
 const manifest=JSON.parse(await readFile(new URL('./assets/specialties/manifest.json',import.meta.url),'utf8'));assert.equal(manifest.items.length,50);const hashes=new Set();
 for(const item of specialties){const entry=manifest.items.find(row=>row.id===item.id);assert.ok(entry,item.id);const bytes=await readFile(new URL('./'+item.imageFile,import.meta.url));assert.ok(bytes.length>10000);const hash=createHash('sha256').update(bytes).digest('hex');assert.equal(hash,entry.sha256);hashes.add(hash);const meta=await sharp(bytes).metadata();assert.equal(meta.width,1024);assert.equal(meta.height,1024);assert.equal(meta.format,'webp');
  const corner=await sharp(bytes).extract({left:0,top:0,width:4,height:4}).removeAlpha().raw().toBuffer();assert.ok([...corner].every(value=>value>240),item.name+'白底');
 }assert.equal(hashes.size,50);
});
