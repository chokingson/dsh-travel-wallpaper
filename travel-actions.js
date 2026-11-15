import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import {createTaskStore} from './scheduled-tasks.js';
import { tripFields } from './trip-composer.js';
import { effectiveConfig, observerFields } from './mode-config.js';

// All helpers sharing a file serialize their read/modify/write operations.
const queues = new Map();
const roleFields = ['rolesEnabled', 'characters', 'referenceId', 'imageToImage', 'referenceInstructions'];
const worldFields = [...tripFields, 'world', 'era', 'rules', 'tags', 'topic', 'textPrompt', 'extraPrompt', 'carrierInstructions','sourceMode','presentation', 'interactionPrompt', 'interactionId'];
const contextFields = [...new Set([...roleFields, ...worldFields, ...Object.values(observerFields)])];
const chinaDay = date => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const snapshot = config => ({...Object.fromEntries(contextFields.map(key => [key, config[key]])),party:config.rolesEnabled===false?[]:config.party});
const sameContext = (a, b) => JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b));
const worldName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function createTravelActions({ directory, composer, getConfig, saveConfig, mutateConfig, listWorlds, now = () => new Date(), taskStore }) {
  const file = join(resolve(directory), 'travel-booking.json');
  const tasks=taskStore||createTaskStore({directory,now});
  const serialize = operation => {
    const previous = queues.get(file) || Promise.resolve();
    const pending = previous.catch(() => {}).then(operation);
    queues.set(file, pending);
    void pending.finally(() => { if (queues.get(file) === pending) queues.delete(file); }).catch(() => {});
    return pending;
  };
  const legacyRead=async()=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
  const readBooking=async()=>{
    const pointer=await legacyRead();if(!pointer?.id)return null;const existing=await tasks.get(pointer.id);if(existing)return existing;
    const oldError=pointer.state==='error';return tasks.create({...pointer,type:'booking',...(oldError?{state:'retrying',attempts:1,nextRetryAt:new Date(now().getTime()+180000).toISOString()}:{} )});
  };
  const writeBooking=async(booking,replace=false)=>{
    const current=await legacyRead();if(!replace&&current?.id!==booking?.id)return;
    await mkdir(resolve(directory),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(booking,null,2));await rename(temporary,file);
  };
  const mirror=async task=>{if(task)await writeBooking(task);return task;};
  return {
    getBooking(){return serialize(async()=>{const booking=await readBooking();return booking?.state==='canceled'?null:booking;});},
    history(){return tasks.list({type:'booking'});},
    async isActive(id){const task=await tasks.get(id);return task?.state==='running';},
    book(config){return serialize(async()=>{
      if(!Number.isInteger(config.hour)||config.hour<0||config.hour>23)throw Error('预订小时 hour 必须为0至23的整数');
      const previous=await readBooking();if(previous)await tasks.cancel(previous.id,'replaced');
      const day=chinaDay(new Date(now().getTime()+86400000));
      const booking=await tasks.create({id:randomUUID(),type:'booking',day,hour:config.hour,dueAt:new Date(`${day}T${String(config.hour).padStart(2,'0')}:00:00+08:00`).toISOString(),state:'booked',character:config.rolesEnabled===false?'':config.characters||'',role:{...Object.fromEntries(roleFields.map(key=>[key,config[key]??(key==='rolesEnabled'?true:key==='imageToImage'?false:'')])),...(Array.isArray(config.party)?{party:structuredClone(config.party)}:{})}});
      await writeBooking(booking,true);return booking;
    });},
    cancel(){return serialize(async()=>{const booking=await readBooking();if(booking)await mirror(await tasks.cancel(booking.id));return null;});},
    claimDue(config,options){return serialize(async()=>{
      const booking=await readBooking();if(!booking)return null;let running=await tasks.claim(booking.id,options);if(!running)return null;
      if(!running.issueId)running=await tasks.progress(running.id,{issueId:chinaDay(now())+'-'+randomBytes(4).toString('hex'),stage:'world'});
      await mirror(running);const result={booking:running,config:{...(config||await getConfig()),...booking.role},resumeIssueId:running.issueId};
      if(running.executionConfig)result.executionConfig=running.executionConfig;return result;
    });},
    rememberExecution(id,config,issueId){return serialize(async()=>mirror(await tasks.progress(id,{executionConfig:config,issueId})));},
    progress(id,patch){return serialize(async()=>mirror(await tasks.progress(id,patch)));},
    finish(id,{issueId,error}={}){return serialize(async()=>mirror(error?await tasks.fail(id,error):await tasks.complete(id,{issueId})));},
    async prepare(config, { blindbox = false, interaction = null, signal,checkpoint } = {}) {
      signal?.throwIfAborted();
      const baseline = structuredClone(config), current = effectiveConfig(baseline);
      if (interaction !== null) {
        if (!interaction || !['reply', 'interfere', 'today'].includes(interaction.mode)) throw Error('交互模式无效');
        if (typeof interaction.text !== 'string' || !interaction.text.trim() || interaction.text.length > 4000) throw Error('交互指令必须为1至4000字');
        if (interaction.mode === 'reply' && baseline.rolesEnabled === false) throw Error('观察世界没有旅行角色，不能回信');
      }
      let patch = {};
      if (blindbox) {
        const visited = new Set((await listWorlds()).map(worldName));
        visited.add(worldName(current.world));
        let accepted = false;
        for (let attempt = 1; attempt <= 3; attempt++) {
          const seed = `创作一个50个内置案例之外、从未到访的全新旅行世界。当前世界：${String(current.world || '').slice(0,200)}。不得重复这些已到访名称：${JSON.stringify([...visited].slice(-80)).slice(0,3500)}。本次尝试：${attempt}。`;
          const draft = await composer.generate(current, seed);
          signal?.throwIfAborted();
          const confirmed = await composer.confirm(current, { generationId: draft.id });
          signal?.throwIfAborted();
          const name = worldName(confirmed.world);
          if (draft.source !== 'dsh' || confirmed.tripSource !== 'dsh' || !name) throw Error('盲盒旅行必须使用DSH创作的新世界');
          if (visited.has(name)) continue;
          patch = Object.fromEntries(worldFields.filter(key => Object.hasOwn(confirmed, key)).map(key => [key, confirmed[key]]));
          patch.tripStartDay = chinaDay(now());
          patch.interactionPrompt = '';
          patch.interactionId = '';
          accepted = true;
          break;
        }
        if (!accepted) throw Error('DSH连续三次返回已到访的重复世界，请重新创作新世界；未使用本地预设替代');
      }
      if (interaction) {
        patch.interactionPrompt = `【用户${interaction.mode === 'reply' ? '回信' : interaction.mode === 'today'?'今日剧情':'干涉世界'}指令】\n${interaction.text.trim()}\n请将以上指令融入本次虚构世界的画面与事件，延续当前世界和角色。`;
        patch.interactionId = randomUUID();
      }
      if (!Object.keys(patch).length) return baseline;
      const storedPatch = Object.fromEntries(Object.entries(patch).map(([key, value]) => [baseline.rolesEnabled === false ? observerFields[key] || key : key, value]));
      const execution={...baseline,...storedPatch};
      // Journal destination before changing preferences, so a crash can replay
      // this exact world rather than spending another model request.
      await checkpoint?.({executionConfig:execution,executionPatch:storedPatch});
      signal?.throwIfAborted();
      const updateConfig = latest => {signal?.throwIfAborted();return sameContext(baseline, latest) ? { ...latest, ...storedPatch } : latest;};
      if (mutateConfig) await mutateConfig(updateConfig);
      else await serialize(async () => {
        const latest = await getConfig(), updated = updateConfig(latest);
        if (updated !== latest) await saveConfig(updated);
      });
      // This execution keeps the selection that initiated it, even if the user
      // selected a different travel context while DSH was preparing the world.
      return execution;
    },
  };
}
