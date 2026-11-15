import{readFile,writeFile,mkdir}from'node:fs/promises';import{basename}from'node:path';import{createHash}from'node:crypto';import sharp from'sharp';import{specialties}from'../specialties-catalog.js';
const [worldCaseId,sourcePath]=process.argv.slice(2),item=specialties.find(item=>item.worldCaseId===worldCaseId);if(!item||!sourcePath)throw Error('Usage: node scripts/register-specialty-image.mjs WORLD_ID GENERATED_FILE');
const source=await readFile(sourcePath),meta=await sharp(source).metadata();if(!['png','jpeg','webp'].includes(meta.format)||Math.min(meta.width,meta.height)<512)throw Error('正式物品图需为至少512px的有效位图');
const target=new URL('../'+item.imageFile,import.meta.url),directory=new URL('../assets/specialties/',import.meta.url);await mkdir(directory,{recursive:true});
const bytes=await sharp(source).resize(1024,1024,{fit:'contain',background:'#ffffff'}).webp({quality:92}).toBuffer();
await writeFile(target,bytes,{flag:'wx'});
const manifestFile=new URL('manifest.json',directory);let manifest;try{manifest=JSON.parse(await readFile(manifestFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;manifest={version:1,tool:'built-in imagegen',items:[]};}
manifest.items.push({worldCaseId,id:item.id,file:basename(item.imageFile),sourceName:basename(sourcePath),sha256:createHash('sha256').update(bytes).digest('hex'),prompt:item.prompt,createdAt:new Date().toISOString(),review:'subject/style/complete-outline/no-text checked visually'});
await writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');console.log(worldCaseId+': registered '+meta.width+'x'+meta.height+' -> 1024x1024 WEBP');
