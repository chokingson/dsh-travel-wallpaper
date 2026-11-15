import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createDailyJob} from './index.js';import{readWorldArchive}from'./archive.js';import{createReferenceLibrary}from'./reference-library.js';
const party=[{id:'builtin-deepseek',name:'DS大肥鱼',description:'蓝发鲸尾',persona:'好奇',addressee:'用户',referenceId:'builtin-deepseek'},{id:'builtin-gpt',name:'GPT 龙娘',description:'白发龙角',persona:'自信',addressee:'用户',referenceId:'builtin-gpt'}];
test('text-only role trip stores party snapshots, writes main letter and appears in both actor filters once',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'travel-party-job-'));t.after(()=>rm(dir,{recursive:true,force:true}));let wrote;
 const job=createDailyJob({dir,now:()=>new Date('2026-11-11T00:00:00Z'),collect:async()=>[],writePrompt:async()=> '同行者抵达港口',render:async()=>Buffer.from('89504e470d0a1a0a','hex'),publish:async()=>{},writeDiary:async(p,c)=>{wrote=c.party;return{text:'用户，今天的港口很热闹。'};}});
 const config={sourceMode:'world',world:'港口',rolesEnabled:true,imageToImage:false,party,diaryEnabled:true};
 const result=await job.run(config,{prepare:true});const picture=result.images[0];assert.deepEqual(picture.party,party);assert.deepEqual(picture.depictedMemberIds,party.map(actor=>actor.id));assert.deepEqual(wrote,party);
 const referenceLibrary=createReferenceLibrary(join(dir,'refs'));
 for(const character of ['all','deepseek','gpt']){const archive=await readWorldArchive(dir,{referenceLibrary,character});assert.equal(archive.total,1,character);assert.equal(archive.images[0].rolesEnabled,true);assert.deepEqual(archive.images[0].party,party);}
 assert.equal((await readWorldArchive(dir,{referenceLibrary,character:'none'})).total,0);
});
