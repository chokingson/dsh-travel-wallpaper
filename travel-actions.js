import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tripFields } from './trip-composer.js';
import { effectiveConfig, observerFields } from './mode-config.js';

// All helpers sharing a file serialize their read/modify/write operations.
const queues = new Map();
const roleFields = ['rolesEnabled', 'characters', 'referenceId', 'imageToImage', 'referenceInstructions'];
const worldFields = [...tripFields, 'world', 'era', 'rules', 'tags', 'topic', 'textPrompt', 'extraPrompt', 'carrierInstructions','sourceMode','presentation', 'interactionPrompt', 'interactionId'];
const contextFields = [...new Set([...roleFields, ...worldFields, ...Object.values(observerFields)])];
const chinaDay = date => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);
const snapshot = config => Object.fromEntries(contextFields.map(key => [key, config[key]]));
const sameContext = (a, b) => JSON.stringify(snapshot(a)) === JSON.stringify(snapshot(b));
const worldName = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function createTravelActions({ directory, composer, getConfig, saveConfig, mutateConfig, listWorlds, now = () => new Date() }) {
  const file = join(resolve(directory), 'travel-booking.json'), sessionId = randomUUID();
  const serialize = operation => {
    const previous = queues.get(file) || Promise.resolve();
    const pending = previous.catch(() => {}).then(operation);
    queues.set(file, pending);
    void pending.finally(() => { if (queues.get(file) === pending) queues.delete(file); }).catch(() => {});
    return pending;
  };
  const readBooking = async () => {
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const writeBooking = async booking => {
    await mkdir(resolve(directory), { recursive: true });
    const temporary = file + '.' + randomUUID() + '.tmp';
    await writeFile(temporary, JSON.stringify(booking, null, 2));
    await rename(temporary, file);
  };

  return {
    getBooking() {
      return serialize(async () => {
        const booking = await readBooking();
        return booking?.state === 'canceled' ? null : booking;
      });
    },
    book(config) {
      return serialize(async () => {
        if (!Number.isInteger(config.hour) || config.hour < 0 || config.hour > 23) throw Error('预订小时 hour 必须为0至23的整数');
        const day = chinaDay(new Date(now().getTime() + 86400000));
        const booking = {
          id: randomUUID(), day, hour: config.hour,
          dueAt: new Date(`${day}T${String(config.hour).padStart(2, '0')}:00:00+08:00`).toISOString(),
          state: 'booked', character: config.rolesEnabled === false ? '' : config.characters || '',
          role: Object.fromEntries(roleFields.map(key => [key, config[key] ?? (key === 'rolesEnabled' ? true : key === 'imageToImage' ? false : '')])),
        };
        await writeBooking(booking);
        return booking;
      });
    },
    cancel() {
      return serialize(async () => {
        const booking = await readBooking();
        if (booking) await writeBooking({ ...booking, state: 'canceled', canceledAt: now().toISOString() });
        return null;
      });
    },
    claimDue(config) {
      return serialize(async () => {
        const booking = await readBooking();
        if (!booking) return null;
        const due = booking.state === 'booked' && Number.isFinite(Date.parse(booking.dueAt)) && Date.parse(booking.dueAt) <= now().getTime();
        const resume = booking.state === 'running' && booking.sessionId !== sessionId;
        if (!due && !resume) return null;
        const running = { ...booking, state: 'running', sessionId, startedAt: booking.startedAt || now().toISOString() };
        await writeBooking(running);
        const result = { booking: running, config: { ...(config || await getConfig()), ...booking.role } };
        if (booking.executionConfig) result.executionConfig = booking.executionConfig;
        if (booking.issueId) result.resumeIssueId = booking.issueId;
        return result;
      });
    },
    rememberExecution(id, config, issueId) {
      return serialize(async () => {
        const booking = await readBooking();
        if (booking?.id !== id || booking.state !== 'running') return;
        await writeBooking({ ...booking, executionConfig: config, issueId });
      });
    },
    finish(id, { issueId, error } = {}) {
      return serialize(async () => {
        const booking = await readBooking();
        if (booking?.id !== id || booking.state === 'canceled') return;
        const finished = { ...booking, state: error ? 'error' : 'completed', finishedAt: now().toISOString() };
        if (issueId) finished.issueId = issueId;
        if (error) finished.error = error.message || String(error);
        else delete finished.error;
        await writeBooking(finished);
      });
    },
    async prepare(config, { blindbox = false, interaction = null } = {}) {
      const baseline = structuredClone(config), current = effectiveConfig(baseline);
      if (interaction !== null) {
        if (!interaction || !['reply', 'interfere'].includes(interaction.mode)) throw Error('交互模式无效');
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
          const confirmed = await composer.confirm(current, { generationId: draft.id });
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
        patch.interactionPrompt = `【用户${interaction.mode === 'reply' ? '回信' : '干涉世界'}指令】\n${interaction.text.trim()}\n请将以上指令融入本次虚构世界的画面与事件，延续当前世界和角色。`;
        patch.interactionId = randomUUID();
      }
      if (!Object.keys(patch).length) return baseline;
      const storedPatch = Object.fromEntries(Object.entries(patch).map(([key, value]) => [baseline.rolesEnabled === false ? observerFields[key] || key : key, value]));
      const updateConfig = latest => sameContext(baseline, latest) ? { ...latest, ...storedPatch } : latest;
      if (mutateConfig) await mutateConfig(updateConfig);
      else await serialize(async () => {
        const latest = await getConfig(), updated = updateConfig(latest);
        if (updated !== latest) await saveConfig(updated);
      });
      // This execution keeps the selection that initiated it, even if the user
      // selected a different travel context while DSH was preparing the world.
      return { ...baseline, ...storedPatch };
    },
  };
}
