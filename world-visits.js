import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {worldCases,worldAliases,pickWorldCase} from './world-cases.js';
const queues=new Map(), ids=new Set(worldCases.map(row=>row.id));
export function createWorldVisits({directory}){
 const root=resolve(directory),file=join(root,'world-visits.json');
 const serial=fn=>{const next=(queues.get(root)||Promise.resolve()).catch(()=>{}).then(fn);queues.set(root,next);return next;};
 const read=async()=>{try{const state=JSON.parse(await readFile(file,'utf8'));if(state.version!==1||!Array.isArray(state.seen)||!Array.isArray(state.ever)||!Array.isArray(state.current))throw Error('预设世界进度记录无效，请保留原文件');return state;}catch(error){if(error.code==='ENOENT')return{version:1,cycle:1,seen:[],ever:[],current:[]};throw error;}};
 const save=async state=>{await mkdir(root,{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(state,null,2));await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}};
 const summary=state=>({visited:state.ever.filter(id=>ids.has(id)).length,total:worldCases.length,cycle:state.cycle,cycleVisited:state.current.filter(id=>ids.has(id)).length,checklist:worldCases.map(row=>({id:row.id,world:row.world,visited:state.ever.includes(row.id),inCurrentCycle:state.current.includes(row.id)}))});
 return{
  async sync(rows=[]){return serial(async()=>{const state=await read(),seen=new Set(state.seen),ever=new Set(state.ever),current=new Set(state.current);let changed=false;
   for(const row of [...rows].sort((a,b)=>(a.at||0)-(b.at||0)||a.issueId.localeCompare(b.issueId))){const id=worldAliases[row.caseId]||row.caseId,key=row.issueId+':'+id;if(!ids.has(id)||seen.has(key))continue;seen.add(key);ever.add(id);current.add(id);changed=true;}
   if(changed){state.seen=[...seen];state.ever=[...ever];state.current=[...current];await save(state);}return summary(state);
  });},
  async progress(){return serial(async()=>summary(await read()));},
  async pick({random=Math.random,excludeId}={}){return serial(async()=>{const state=await read();let pool=worldCases.filter(row=>!state.current.includes(row.id));if(!pool.length){state.cycle++;state.current=[];await save(state);pool=worldCases;}
   const preferred=pool.filter(row=>row.id!==excludeId);if(preferred.length)pool=preferred;
   const index=Math.min(pool.length-1,Math.max(0,Math.floor(random()*pool.length)));return pickWorldCase({caseId:pool[index].id,random});
  });},
 };
}
