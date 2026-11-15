import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createChannels} from './channels.js';

const references=[1,2,3].map(n=>({data:Buffer.from('reference-'+n).toString('base64'),mediaType:'image/png',actorId:'actor-'+n}));
const bytes=await sharp({create:{width:2,height:2,channels:3,background:'#123456'}}).png().toBuffer();
function context(account){return{credentials:{resolve:async()=>({value:JSON.stringify(account)})}};}

test('both subscription request paths receive every reference in original order',async()=>{
 for(const provider of ['chatgpt-sub','google-sub']){
  let sent;const channels=createChannels({}, {subscriptions:{generate:async value=>{sent=value;return[{b64_json:bytes.toString('base64')}];}}});
  await channels.generate('三人同行',{imageChannel:provider,width:1920,height:1080},references);
  assert.deepEqual(sent.referenceImages.map(image=>image.data.toString()),['reference-1','reference-2','reference-3']);
 }
});

test('Google, Seedream and OpenAI official formats preserve all three reference images',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let captured;
 globalThis.fetch=async(url,options)=>{captured={url,options};return{ok:true,json:async()=>({data:[{b64_json:bytes.toString('base64')}],candidates:[{content:{parts:[{inlineData:{data:bytes.toString('base64')}}]}}]})};};
 const cases=[['google','https://generativelanguage.googleapis.com/v1beta','gemini-3.1-flash-image'],['seedream','https://ark.cn-beijing.volces.com/api/v3','doubao-seedream-4-5-251128'],['openai','https://api.openai.com/v1','gpt-image-2']];
 for(const[provider,endpoint,model]of cases){
  const channels=createChannels(context({key:'test',endpoint,model}));await channels.generate('三人同行',{imageChannel:provider,width:1920,height:1080},references);
  if(provider==='google')assert.deepEqual(JSON.parse(captured.options.body).contents[0].parts.slice(1).map(part=>part.inlineData.data),references.map(ref=>ref.data));
  else if(provider==='seedream')assert.deepEqual(JSON.parse(captured.options.body).image,references.map(ref=>'data:image/png;base64,'+ref.data));
  else {const files=captured.options.body.getAll('image[]');assert.equal(files.length,3);assert.deepEqual(await Promise.all(files.map(file=>file.text())),['reference-1','reference-2','reference-3']);}
 }
});

test('unverified custom endpoints reject excess refs before any request, never silently truncate',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;globalThis.fetch=async()=>{calls++;throw Error('must not reach network');};
 const channels=createChannels(context({key:'test',endpoint:'https://example.invalid/v1',model:'private-model'}));
 await assert.rejects(channels.generate('同行',{imageChannel:'openai-compatible',width:1920,height:1080},references),/参考图.*1|1.*参考图/);assert.equal(calls,0);
});
