import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { splitPrompt } from './catalog.js';
import { imageCharacters, characterFilters } from './character-tags.js';

const issueFile = /^\d{4}-\d\d-\d\d(?:-[a-f\d]+)?\.json$/;
const imageFile = /^\d{4}-\d\d-\d\d(?:-[a-f\d]+){0,2}\.(?:png|jpg|webp)$/;
const nameOf = values => values.find(value=>typeof value==='string'&&value.trim())?.normalize('NFC').trim().replace(/\s+/g,' ') || '';
const timeOf = record => Number.isFinite(record.createdAt) ? record.createdAt : Date.parse(record.day) || 0;
const optionalText = value => value == null || typeof value === 'string';
const optionalSize = value => value == null || (Number.isSafeInteger(value) && value > 0);
function displayable(picture) {
  const story=picture.story;
  return (!story || (typeof story==='object'&&!Array.isArray(story))) &&
    [story?.title,story?.character,story?.url,picture.prompt,picture.style,picture.styleId,picture.referenceId,picture.era].every(optionalText) &&
    [picture.width,picture.height,picture.originalWidth,picture.originalHeight].every(optionalSize) &&
    (picture.promptParts == null || (Array.isArray(picture.promptParts) && picture.promptParts.every(part=>part&&typeof part.kind==='string'&&typeof part.text==='string')));
}

// This index is read-only and separate from the bounded history used for prompt writing.
export async function readWorldArchive(directory,{character='all',referenceLibrary=null}={}) {
  if(!characterFilters.some(([id])=>id===character)&&!(referenceLibrary&&/^[a-f0-9-]{36}$/.test(character)))throw new Error('角色分类无效');
  const library=referenceLibrary?await referenceLibrary.list():null;
  const filters=library?[['all','全部旅行'],...library.groups.map(g=>[g.id,g.name]),['none','观察世界']]:characterFilters;
  const entries=await readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  const present=new Set(entries.filter(entry=>entry.isFile()).map(entry=>entry.name));
  const records=[]; let skipped=0;
  for (const file of present) {
    if (!issueFile.test(file)) continue;
    try {
      const record=JSON.parse((await readFile(join(directory,file),'utf8')).replace(/^\uFEFF/,''));
      if (!record || typeof record!=='object' || Array.isArray(record)) throw new Error('无效记录');
      if (record.day!==file.slice(0,10) || (record.images!=null&&!Array.isArray(record.images))) throw new Error('记录日期或图片列表无效');
      records.push({...record,issueId:file.slice(0,-5),day:file.slice(0,10)});
    } catch(error) {
      if (!(error instanceof SyntaxError) && error.code && error.code!=='ENOENT') throw error;
      skipped++;
    }
  }
  records.sort((a,b)=>timeOf(b)-timeOf(a)||b.issueId.localeCompare(a.issueId));
  const images=[],groups=new Map();
  for (const record of records) {
    const pictures=Array.isArray(record.images)?record.images:[{imageFile:record.imageFile||`${record.day}.png`,story:record.story,prompt:record.prompt,style:record.settings?.style,styleId:record.settings?.styleId}];
    for (const [index,picture] of pictures.entries()) {
      if (!picture || typeof picture!=='object' || index>19) {skipped++;continue;}
      if (!displayable(picture)) {skipped++;continue;}
      const file=picture.imageFile || `${record.day}.png`;
      if (typeof file!=='string'||!imageFile.test(file)) {skipped++;continue;}
      if (!present.has(file)) continue;
      const referenceId=picture.referenceId??(record.recipe?.imageToImage?record.recipe.referenceId:'');
      const identity=referenceLibrary?await referenceLibrary.resolve(picture.rolesEnabled===false?'':referenceId):null;
      const characterIds=identity?[identity.id]:imageCharacters(picture,record);
      if(identity?.id==='custom'&&!library.hiddenIds?.includes('custom')&&!filters.some(([id])=>id==='custom'))filters.splice(filters.length-1,0,['custom','自定义']);
      if(character!=='all'&&!characterIds.includes(character))continue;
      const name=nameOf([picture.world,record.recipe?.world,record.settings?.world,record.world]);
      const id=name?createHash('sha256').update(name).digest('hex').slice(0,24):'unrecorded';
      const prompt=typeof picture.prompt==='string'?picture.prompt:'';
      const image={worldId:id,world:name||'未记录世界',issueId:record.issueId,index,count:pictures.length,day:record.day,
        title:picture.story?.title||record.day,prompt,parts:picture.promptParts||splitPrompt(prompt,picture.style||''),
        style:picture.style||'',styleId:picture.styleId||'custom',width:picture.width,height:picture.height,
        originalWidth:picture.originalWidth,originalHeight:picture.originalHeight,contextKey:picture.contextKey,referenceId:picture.referenceId,referenceName:identity?.name,identityId:identity?.id,
        character:picture.story?.character||'',characterIds,rolesEnabled:!characterIds.includes('none'),diary:!characterIds.includes('none')&&picture.diary&&typeof picture.diary.text==='string'?{text:picture.diary.text,addressee:typeof picture.diary.addressee==='string'?picture.diary.addressee:'',createdAt:picture.diary.createdAt}:null,
        diaryIssueId:!characterIds.includes('none')&&typeof picture.diaryIssueId==='string'?picture.diaryIssueId:'',diaryDay:!characterIds.includes('none')&&typeof picture.diaryDay==='string'?picture.diaryDay:'',diaryError:typeof picture.diaryError==='string'?picture.diaryError:'',era:picture.era||record.recipe?.era||record.settings?.era||'',
        sourceUrl:/^https?:\/\//i.test(picture.story?.url||'')?picture.story.url:'',image:`/api/planet-news?image=${encodeURIComponent(record.issueId)}&index=${index}`};
      images.push(image);
      if (!groups.has(id)) groups.set(id,{id,name:image.world,count:0,firstDay:record.day,lastDay:record.day,cover:image.image,dates:new Set()});
      const group=groups.get(id);group.count++;group.dates.add(record.day);
      if (record.day<group.firstDay) group.firstDay=record.day;
      if (record.day>group.lastDay) group.lastDay=record.day;
    }
  }
  return {worlds:[...groups.values()].map(({dates,...group})=>({...group,days:dates.size})),images,total:images.length,skipped,filters};
}
