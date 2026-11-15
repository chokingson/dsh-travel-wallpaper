import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createReferenceLibrary} from './reference-library.js';
import {effectiveConfig} from './mode-config.js';
import {normalizeConfig} from './catalog.js';
import {deliveryContextKey} from './delivery.js';
import {writeTravelDiary} from './diary.js';

const first={id:'one',name:'同名',description:'蓝发旅行者',persona:'说话简短，喜欢研究天气',addressee:'船长',referenceId:'builtin-deepseek'};
const second={id:'two',name:'同名',description:'白发旅行者',persona:'沉静而好奇',addressee:'朋友',referenceId:'builtin-gpt'};

test('same archive name keeps separate actor profiles and reference snapshots',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'travel-party-'));
 try{
  const lib=createReferenceLibrary(dir),a='a'.repeat(32),b='b'.repeat(32);
  await lib.assign({referenceId:a,name:'同名',slot:0});await lib.assign({referenceId:b,name:'同名',slot:1});
  assert.equal(typeof lib.updateProfile,'function','reference library must store independent profiles');
  await lib.updateProfile({referenceId:a,name:'同名',persona:'小雨',addressee:'船长',description:'蓝发'});
  await lib.updateProfile({referenceId:b,name:'同名',persona:'晴天',addressee:'朋友',description:'白发'});
  const list=await lib.list();assert.equal(list.slots[0].identityId,list.slots[1].identityId,'old archive grouping preserved');
  assert.notEqual(list.slots[0].profile.id,list.slots[1].profile.id);
  assert.equal(list.slots[0].profile.persona,'小雨');assert.equal(list.slots[1].profile.addressee,'朋友');
  assert.equal((await createReferenceLibrary(dir).list()).slots[0].profile.persona,'小雨');
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('ordered party remains active in text-to-image and disappears only in observation',()=>{
 const config=normalizeConfig({party:[first,second],imageToImage:false,diaryTitle:'用户'});
 const text=effectiveConfig(config);assert.deepEqual(text.party,[first,second]);assert.match(text.characters,/蓝发旅行者.*白发旅行者/);
 assert.equal(text.referenceId,'');
 const observer=effectiveConfig({...config,rolesEnabled:false});assert.deepEqual(observer.party,[]);assert.equal(observer.characters,'');
 assert.deepEqual(config.party,[first,second],'switching mode must not mutate saved party');
 assert.throws(()=>normalizeConfig({...config,party:[first,second,{...first,id:'three'},{...second,id:'four'}]}),/三|3/);
 assert.throws(()=>normalizeConfig({...config,party:[first,first]}),/重复/);
});

test('context changes with ordered party, persona and address, observer ignores saved party',()=>{
 const config={world:'云港',characters:'同名',party:[first,second],imageToImage:false};
 const key=deliveryContextKey(config);
 for(const party of [[second,first],[{...first,persona:'另一种性格'},second],[{...first,addressee:'老师'},second]])assert.notEqual(deliveryContextKey({...config,party}),key);
 assert.equal(deliveryContextKey({...config,rolesEnabled:false}),deliveryContextKey({...config,party:[second],rolesEnabled:false}));
});

test('only ordered main character writes using own persona and addressee',async()=>{
 let request;const llm={async *stream(value){request=value;yield{type:'text-delta',text:'船长，我把今天的云装进了口袋。下一站见。'};}};
 const result=await writeTravelDiary(llm,{rolesEnabled:true,party:[first,second],world:'云港',prompt:'抵达云港'},{party:[first,second],diaryTitle:'旧的称呼'});
 const prompt=JSON.stringify(request.messages);assert.match(prompt,/喜欢研究天气/);assert.doesNotMatch(prompt,/旧的称呼/);
 assert.equal(result.authorId,'one');assert.equal(result.addressee,'船长');assert.deepEqual(result.author,first);
});
