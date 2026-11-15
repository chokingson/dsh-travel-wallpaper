import sharp from 'sharp';
const image=await sharp({create:{width:8,height:8,channels:3,background:'#ffffff'}}).png().toBuffer();
import test from'node:test';import assert from'node:assert/strict';import{mkdtemp,rm,readFile,writeFile}from'node:fs/promises';import{join}from'node:path';import{tmpdir}from'node:os';
import{worldCasePatch,pickWorldCase}from'./world-cases.js';import{observerFields}from'./mode-config.js';
const actor={id:'cat',name:'小猫',description:'银色猫咪',persona:'不喜欢说话，爱观察',addressee:'朋友',referenceId:''};
const record=(config,id='2026-11-11-1234abcd')=>({state:'published',issueId:id,day:'2026-11-11',recipe:config,images:[{party:config.rolesEnabled===false?[]:config.party,storyOutcome:{status:'committed',description:'旅人穿过集市，听见钟声。'}}],storyOutcome:{status:'committed',description:'旅人穿过集市，听见钟声。'}});
async function fixture(t,{randomValues=[0],asset=true,failImage=false,renderImage=image}={}){const{createSpecialties}=await import('./specialties.js');const directory=await mkdtemp(join(tmpdir(),'specialties-'));t.after(()=>rm(directory,{recursive:true,force:true}));let calls={design:0,story:0,image:0,random:0},clock=new Date('2026-11-11T02:00:00Z'),request;
 const args={directory,now:()=>clock,random:()=>randomValues[Math.min(calls.random++,randomValues.length-1)],readAsset:async()=>asset?image:null,
  design:async value=>{calls.design++;return{name:'回声石片',appearance:'一个半透明的青色扁圆石片',properties:'保存一段无意识的回声，不含活体',localUse:'用来比较渡口不同的钟声',visualManifestation:'石片边缘浮现两条浅青弧线',category:'sound',living:false};},
  writeStory:async value=>{calls.story++;request=value;return{story:'清晨，集市钟声刚落，旁边的旧邮袋里滚出一件本地小物。它绕了远路才抵达你的电脑桌，角落还留着旅途的温度。',senderIds:value.party.map(actor=>actor.id)};},
  render:async(_prompt,_config,context)=>{calls.image++;if(failImage){failImage=false;throw Object.assign(Error('额度暂不可用'),{beforeSubmission:true});}await context.checkpoint?.({kind:'test',state:'received'});return renderImage;}};
 return{service:createSpecialties(args),restart:()=>createSpecialties(args),calls,get request(){return request;},clock:value=>{clock=new Date(value);},directory};}
test('one committed world trip per local day/ordered party, one shared gift and unique preset progress across repeat deliveries',async t=>{
 const f=await fixture(t),config={...worldCasePatch(pickWorldCase({caseId:'frog-world'})),rolesEnabled:true,party:[actor,{...actor,id:'dog',name:'小狗'}]};
 await f.service.enqueue(record(config));await f.service.enqueue(record(config,'2026-11-11-abcdef12'));await f.service.tick();
 let list=await f.service.list();assert.equal(list.items.length,1);assert.equal(list.progress,1);assert.equal(list.total,50);assert.equal(f.calls.story,1);assert.equal(f.calls.image,0);assert.equal(f.request.party.length,2);assert.equal(f.request.mode,'travel');
 f.clock('2026-11-12T02:00:00Z');await f.service.enqueue(record(config,'2026-11-12-abcdef12'));await f.service.tick();list=await f.service.list();assert.equal(list.items.length,1);assert.equal(list.items[0].deliveryCount,2);assert.equal(list.progress,1);
 assert.equal((await f.service.details(list.items[0].id)).deliveries.length,2);
});
test('controllable source branches exclude only same identity; observer does not leak saved party or persona',async t=>{
 const f=await fixture(t,{randomValues:[0.75,0]}),patch=worldCasePatch(pickWorldCase({caseId:'lava-earth'})),config={...Object.fromEntries(Object.entries(patch).map(([key,value])=>[observerFields[key]||key,value])),rolesEnabled:false,party:[actor],diaryTitle:'主人'};
 await f.service.enqueue(record(config));await f.service.tick();const item=(await f.service.list()).items[0];assert.notEqual(item.worldCaseId,'lava-earth');assert.deepEqual(f.request.party,[]);assert.equal(f.request.mode,'world');assert.ok(!JSON.stringify(f.request).includes('主人'));
});
test('new same-named world designs a real new item, retry preserves source, definition and story, dynamic does not increment 50 progress',async t=>{
 const f=await fixture(t,{failImage:true}),config={rolesEnabled:true,party:[actor],world:'蛙世界',tripSource:'dsh',tripGenerationId:'new-world-1',tripPrompt:'独立的新世界'};
 await f.service.enqueue(record(config));await f.service.tick();let list=await f.service.list();assert.equal(list.progress,0);assert.equal(list.items.length,0);assert.equal(list.pending.length,1);
 assert.equal(f.calls.design,1);assert.equal(f.calls.story,1);assert.equal(f.calls.random,1);
 f.clock('2026-11-11T02:04:00Z');const restart=f.restart();await restart.tick();list=await restart.list();assert.equal(list.items.length,1);assert.equal(list.progress,0);assert.match(list.items[0].id,/^dynamic:/);assert.equal(f.calls.design,1);assert.equal(f.calls.story,1);assert.equal(f.calls.random,1);
});
test('missing fixed asset does not masquerade as a collected item, canceled/unpublished wallpaper cannot receive one',async t=>{
 const f=await fixture(t,{asset:false}),config={...worldCasePatch(pickWorldCase({caseId:'frog-world'})),rolesEnabled:true,party:[actor]};
 await assert.rejects(f.service.enqueue({...record(config),state:'canceled'}),/完成/);await f.service.enqueue(record(config));await f.service.tick();const list=await f.service.list();assert.equal(list.progress,0);assert.equal(list.items.length,0);assert.equal(list.pending[0].state,'waiting-remote');assert.equal(f.calls.image,0);
});
test('损坏的已收记录不污染进度，不让收藏页面或排序崩溃',async t=>{
 const f=await fixture(t),config={...worldCasePatch(pickWorldCase({caseId:'frog-world'})),rolesEnabled:true,party:[actor]};const task=await f.service.enqueue(record(config));await f.service.tick();
 const file=join(f.directory,'deliveries',task.id+'.json'),data=JSON.parse(await readFile(file,'utf8'));delete data.item.name;await writeFile(file,JSON.stringify(data));const list=await f.service.list();assert.equal(list.progress,0);assert.equal(list.items.length,0);assert.equal(list.skipped,1);
});

test('transparent model output is stored on a real white background; older transparent collection files repair without regeneration',async t=>{
 const translucent=await sharp({create:{width:8,height:8,channels:4,background:{r:80,g:150,b:230,alpha:0}}}).png().toBuffer();
 const f=await fixture(t,{renderImage:translucent}),config={rolesEnabled:false,world:'新世界',tripSource:'user',tripPrompt:'新世界'};
 await f.service.enqueue(record(config));await f.service.tick();const item=(await f.service.list()).items[0];
 let received=await f.service.image(item.id);assert.equal((await sharp(received.bytes).metadata()).hasAlpha,false);
 assert.deepEqual([...await sharp(received.bytes).extract({left:0,top:0,width:1,height:1}).raw().toBuffer()],[255,255,255]);
 const {createHash}=await import('node:crypto');const file=join(f.directory,'images',createHash('sha256').update(JSON.stringify(item.id)).digest('hex')+'.png');
 await writeFile(file,translucent);received=await f.service.image(item.id);
 assert.equal((await sharp(received.bytes).metadata()).hasAlpha,false);assert.equal((await sharp(await readFile(file)).metadata()).hasAlpha,false);assert.equal(f.calls.image,1);
});
