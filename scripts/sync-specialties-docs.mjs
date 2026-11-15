import{mkdir,writeFile,readFile}from'node:fs/promises';
import{specialties}from'../specialties-catalog.js';
const asset=[];for(const item of specialties){const available=await readFile(new URL('../'+item.imageFile,import.meta.url)).then(()=>true,()=>false);asset.push({number:item.number,id:item.id,worldCaseId:item.worldCaseId,name:item.name,imageFile:item.imageFile,status:available?'generated':'not-generated',prompt:item.prompt});}
const page=['# 50个世界的固定特产与图鉴提示词','', '目录与当前已审50世界逐项对应。编号仅用于展示，身份以物品ID为准。物品事实固定，送达故事运行时生成。所有物品图统一纯白背景、二次元动漫风、无文字。',''];
for(const item of specialties)page.push(`## ${item.number}．${item.world} · ${item.name}`,'',`物品ID：${item.id}`,`外观：${item.appearance}`,`材质与性质：${item.properties}`,`当地用途：${item.localUse}`,`表现方式：${item.visualManifestation}`,'','图鉴生图提示词：','',item.prompt,'');
await mkdir(new URL('../docs/',import.meta.url),{recursive:true});
await writeFile(new URL('../docs/SPECIALTIES-CATALOG.md',import.meta.url),page.join('\n'));
await writeFile(new URL('../docs/specialties-assets.json',import.meta.url),JSON.stringify({version:1,total:50,generated:asset.filter(item=>item.status==='generated').length,items:asset},null,2)+'\n');
console.log('50条目录和提示词已同步，正式图 '+asset.filter(item=>item.status==='generated').length+'/50');
