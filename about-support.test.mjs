import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAboutSupport,publicHttpsUrl} from './about-support.js';
import {createServer} from 'node:http';
import {apply} from './index.js';

test('公开资料只取包内明确提供字段，赞赏码保持原样且页面不包含图片字节',async()=>{
 const service=createAboutSupport(),about=await service.describe();
 assert.equal(about.projectName,'旅行壁纸');assert.equal(about.wechat,'q871282948');
 assert.equal(about.githubUrl,'https://github.com/chokingson/dsh-travel-wallpaper');
 assert.equal(about.feedbackUrl,about.githubUrl+'/issues');assert.match(about.supportPageUrl,/\/SUPPORT\.md$/);
 assert.equal(about.support.qrUrl,'/api/planet-news?supportCode');assert.equal(about.support.qrAvailable,true);
 assert.equal(JSON.stringify(about).includes('base64'),false);
 assert.deepEqual(await service.image(),await readFile(new URL('./assets/support/wechat-appreciation.png',import.meta.url)));
 assert.equal(about.materials.length,3);assert.match(about.materials[0].conditions,/CC BY-NC-SA 4.0/);
 for(const material of about.materials.slice(1)){assert.match(material.conditions,/署名.*不可商用/);assert.match(material.verification,/待核实/);assert.doesNotMatch(material.conditions,/CC BY-NC-SA/);}
});

test('未配置、缺图和停止公开展示不泄露图片，也不读取用户配置',async()=>{
 let config={},seen=[];
 const service=createAboutSupport({read:async url=>{seen.push(url.pathname);if(url.pathname.endsWith('about-support.json'))return JSON.stringify(config);throw Object.assign(Error('not found'),{code:'ENOENT'});}});
 let about=await service.describe();assert.equal(about.wechat,'');assert.equal(about.githubUrl,'');assert.equal(about.support.qrAvailable,false);assert.match(about.support.status,/待配置/);assert.equal(await service.image(),null);
 config={support:{enabled:true}};about=await service.describe();assert.equal(about.support.qrAvailable,false);assert.match(about.support.status,/待配置/);
 config={support:{enabled:false}};about=await service.describe();assert.equal(about.support.enabled,false);assert.match(about.support.status,/暂停/);assert.equal(await service.image(),null);
 assert.ok(seen.every(p=>p.endsWith('about-support.json')||p.endsWith('assets/support/wechat-appreciation.png')));
 const broken=createAboutSupport({read:async()=>'{broken'});assert.match((await broken.describe()).notice,/待配置/);
});

test('公开链接仅允许无登录凭据的HTTPS链接，文档与页面文案同步',async()=>{
 for(const unsafe of ['javascript:alert(1)','file:///C:/secret','data:text/html,x','http://example.com','https://user:pass@example.com','//example.com'])assert.equal(publicHttpsUrl(unsafe),'');
 assert.equal(publicHttpsUrl('https://github.com/chokingson/dsh-travel-wallpaper'),'https://github.com/chokingson/dsh-travel-wallpaper');
 const about=await createAboutSupport().describe();
 for(const name of ['README.md','SUPPORT.md']){const doc=await readFile(new URL('./'+name,import.meta.url),'utf8');for(const value of [about.introduction,about.independence,about.materialNotice,...about.support.paragraphs])assert.ok(doc.includes(value),name+' misses '+value);}
 const notice=await readFile(new URL('./THIRD_PARTY_NOTICES.md',import.meta.url),'utf8');for(const material of about.materials){for(const text of [material.authors,material.conditions,material.verification])assert.ok(notice.includes(text));}
});

test('关于路由为本机只读接口，不启动生成、投递、支付或账号读取',async()=>{
 let route;const forbidden=()=>{throw Error('Unrelated feature invoked');};
 apply({effect(fn,label){if(label==='planet-news: settings route')fn();},webServer:{register(value){route=value;return()=>{};}},llm:{stream:forbidden},credentials:new Proxy({},{get:forbidden})},null,forbidden,()=>({dispose(){},sync:forbidden}),forbidden,forbidden);
 const server=createServer((req,res)=>route.handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  const info=await fetch(origin+'/?about');assert.equal(info.status,200);assert.equal((await info.json()).wechat,'q871282948');
  const image=await fetch(origin+'/?supportCode=../../config.json');assert.equal(image.headers.get('content-type'),'image/png');assert.equal(image.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await image.arrayBuffer()),await readFile(new URL('./assets/support/wechat-appreciation.png',import.meta.url)));
  assert.equal((await fetch(origin+'/?about',{headers:{origin:'https://foreign.example'}})).status,403);
  const rejected=await fetch(origin,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({action:'support-pay'})});assert.equal(rejected.status,400);
 }finally{await new Promise(r=>server.close(r));}
});
