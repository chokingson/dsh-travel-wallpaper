import{test}from'node:test';import assert from'node:assert/strict';import{readFile,readdir}from'node:fs/promises';import sharp from'sharp';import{createHash}from'node:crypto';import{styles}from'./catalog.js';
import{runInNewContext}from'node:vm';
test('桌面导出等待真实保存结果，取消不报成功，长世界名可安全保存',async()=>{
 const source=await readFile(new URL('./client.js',import.meta.url),'utf8'),start=source.indexOf('async function downloadFile('),end=source.indexOf('function chooseBuiltin(',start);let saved,feedback;
 const download=runInNewContext('('+source.slice(start,end).trim()+')',{config:{downloadDirectory:''},touched:{current:new Set()},api:'/api/planet-news',fetch:async()=>({ok:true,headers:{get:()=> 'attachment; filename="2026-11-08-0.jpg"'},blob:async()=>({type:'image/jpeg'})}),URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},setTimeout(){},window:{dshDesktop:{fileActions:{save:async request=>{saved=request;return{status:'cancelled'};}}}},setFeedback:value=>feedback=value});
 await download('?exportWorld=abc','旅行壁纸-'+':长世界名'.repeat(80)+'.zip');assert.equal(saved.mode,'download');assert.ok(Buffer.byteLength(saved.name)<250);assert.ok(!saved.name.includes(':'));assert.equal(feedback,'已取消导出');
 await download('?download=2026-11-08','2026-11-08-0.png');assert.equal(saved.name,'2026-11-08-0.jpg');assert.equal(saved.mediaType,'image/jpeg');
});
test('刚修改的下载目录先单独保存，不保存其它未确认设置，随后导出到自定义目录',async()=>{
 const source=await readFile(new URL('./client.js',import.meta.url),'utf8'),start=source.indexOf('async function downloadFile('),end=source.indexOf('function chooseBuiltin(',start),calls=[];let feedback,dirty;
 const download=runInNewContext('('+source.slice(start,end).trim()+')',{config:{downloadDirectory:'C:/旅行相册'},directoryEdit:{current:0},touched:{current:new Set(['downloadDirectory','style'])},URLSearchParams,request:async payload=>{calls.push(JSON.parse(JSON.stringify(payload)));return payload.config?{config:{downloadDirectory:'C:/旅行相册'}}:{path:'C:/旅行相册/世界.zip'};},setConfig(){},setDirty:value=>dirty=value,setFeedback:value=>feedback=value,fetch(){throw Error('自定义目录不走浏览器默认下载');}});
 await download('?exportWorld=abc&character=all','世界.zip');assert.deepEqual(calls,[{config:{downloadDirectory:'C:/旅行相册'}},{action:'save-export',exportWorld:'abc',character:'all'}]);assert.equal(dirty,true);assert.equal(feedback,'已导出至 C:/旅行相册/世界.zip');
});
test('导出自动保存期间再次编辑目录，旧响应不能吞掉新路径和未保存标记',async()=>{
 const source=await readFile(new URL('./client.js',import.meta.url),'utf8'),start=source.indexOf('async function downloadFile('),end=source.indexOf('function chooseBuiltin(',start),config={downloadDirectory:'C:/first'},touched={current:new Set(['downloadDirectory'])},directoryEdit={current:0};let finish;
 const pending=new Promise(resolve=>finish=resolve),download=runInNewContext('('+source.slice(start,end).trim()+')',{config,touched,directoryEdit,URLSearchParams,request:async payload=>payload.config?pending:{path:'C:/first/image.png'},setConfig:update=>Object.assign(config,update(config)),setDirty(){},setFeedback(){}});
 const exporting=download('?download=2026-11-08&index=0','image.png');config.downloadDirectory='C:/edited-while-saving';directoryEdit.current++;touched.current.add('downloadDirectory');finish({config:{downloadDirectory:'C:/first'}});await exporting;
 assert.equal(config.downloadDirectory,'C:/edited-while-saving');assert.ok(touched.current.has('downloadDirectory'));
});
test('20张内置预览均可解码且尺寸受限，电影样图使用最终二次元人物版本',async()=>{
 const index=JSON.parse(await readFile(new URL('./assets/styles/index.json',import.meta.url),'utf8'));assert.equal(index.items.find(i=>i.id==='cinema').sourceVariant,'character-2d-retained');
 const names=await readdir(new URL('./assets/styles/',import.meta.url));assert.equal(names.filter(n=>n.endsWith('.webp')).length,20);for(const style of styles){const bytes=await readFile(new URL(`./assets/styles/${style.id}.webp`,import.meta.url)),meta=await sharp(bytes).metadata();assert.equal(createHash('sha256').update(bytes).digest('hex'),index.items.find(i=>i.id===style.id).previewSha256);assert.equal(meta.format,'webp');assert.equal(meta.width,800);assert.equal(meta.height,450);assert.ok(bytes.length<250000);}
});
test('交互和来信声音是本机短PCM素材，不需要TTS或网络下载',async()=>{
 for(const kind of ['click','mail']){const bytes=await readFile(new URL(`./assets/sounds/${kind}.wav`,import.meta.url));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');assert.equal(bytes.readUInt16LE(20),1);assert.equal(bytes.readUInt16LE(22),1);assert.equal(bytes.readUInt16LE(34),16);assert.equal(bytes.readUInt32LE(40),bytes.length-44);assert.ok((bytes.length-44)/bytes.readUInt32LE(28)<1);}
});
