import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTravelActions } from './travel-actions.js';
import { normalizeConfig } from './catalog.js';

const base = { hour: 8, rolesEnabled: true, characters: '大肥鱼', referenceId: 'fish', imageToImage: true, referenceInstructions: '保持鱼的身份', world: '旧世界', tripPrompt: '旧行程', tripMeta: '{"world":"旧世界"}', styleId: 'ink', width: 1920, height: 1080, imageChannel: 'moss', downloadDirectory: 'D:/pictures' };
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'travel-actions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let config = { ...base, ...options.config }, clock = new Date(options.at || '2026-11-08T15:59:00Z'), generated = 0;
  const calls = [];
  const composer = options.composer || {
    async generate(input, seed) { calls.push({ input, seed }); return { id: `generation-${++generated}`, source: 'dsh', idea: { world: options.world || `新世界${generated}` } }; },
    async confirm(input, { generationId }) { return { world: options.world || `新世界${generated}`, tripPrompt: '新世界行程', tripMeta: JSON.stringify({ world: options.world || `新世界${generated}` }), tripSource: 'dsh', tripGenerationId: generationId, tripStartDay: '2099-01-01', referenceInstructions: '不应覆盖底图说明', extraPrompt: '', sourceMode: 'world', presentation: 'illustration' }; },
  };
  const args = { directory, composer, now: () => clock, getConfig: async () => ({ ...config }), saveConfig: async next => { config = { ...next }; }, listWorlds: async () => options.visited || [] };
  if (options.mutateConfig) {
    args.mutateConfig = async update => { config = await update(await options.mutateConfig({ ...config })); };
    args.getConfig = async () => { throw Error('shared mutation must supply the latest config'); };
    args.saveConfig = async () => { throw Error('shared mutation must own the write'); };
  }
  return { directory, calls, actions: createTravelActions(args), restart: () => createTravelActions(args), readConfig: () => config, setConfig: next => { config = next; }, setClock: at => { clock = new Date(at); } };
}

test('booking uses tomorrow China day, selected hour and a locked role snapshot', async t => {
  const f = await fixture(t);
  const booking = await f.actions.book(base);
  assert.equal(booking.day, '2026-11-09');
  assert.equal(booking.dueAt, '2026-11-09T00:00:00.000Z');
  assert.equal(booking.hour, 8);
  assert.equal(booking.character, '大肥鱼');
  assert.deepEqual(booking.role, { rolesEnabled: true, characters: '大肥鱼', referenceId: 'fish', imageToImage: true, referenceInstructions: '保持鱼的身份' });
  f.setClock('2026-11-08T16:01:00Z');
  assert.equal((await f.actions.book({ ...base, hour: 23 })).day, '2026-11-10');
  assert.equal((await f.actions.getBooking()).dueAt, '2026-11-10T15:00:00.000Z');
  for (const hour of [-1, 24, 1.5, undefined]) await assert.rejects(f.actions.book({ ...base, hour }), /小时|hour/);
});

test('cancel hides booking while preserving canceled state and never claims it', async t => {
  const f = await fixture(t); await f.actions.book(base);
  assert.equal(await f.actions.cancel(), null);
  assert.equal(await f.actions.getBooking(), null);
  assert.equal(JSON.parse(await readFile(join(f.directory, 'travel-booking.json'), 'utf8')).state, 'canceled');
  f.setClock('2026-11-10T00:00:00Z');
  assert.equal(await f.actions.claimDue(base), null);
});
test('盲盒从圈子日报切换为新世界事件来源，不继续搜旧B站故事',async t=>{
 const f=await fixture(t,{config:{sourceMode:'bili-report'}});const execution=await f.actions.prepare(f.readConfig(),{blindbox:true});assert.equal(execution.sourceMode,'world');assert.equal(f.readConfig().sourceMode,'world');
});

test('only one due timer claims a booking and locked role overrides later role edits', async t => {
  const f = await fixture(t); await f.actions.book(base);
  assert.equal(await f.actions.claimDue(base), null);
  f.setClock('2026-11-09T00:00:00Z');
  const current = { ...base, characters: '新角色', referenceId: 'new', styleId: 'watercolor', dailyEnabled: false };
  const results = await Promise.all([f.actions.claimDue(current), f.actions.claimDue(current)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(results.find(Boolean).config.characters, '大肥鱼');
  assert.equal(results.find(Boolean).config.styleId, 'watercolor');
  assert.equal(results.find(Boolean).config.dailyEnabled, false);
});

test('restart resumes stored execution and issue once without changing destination', async t => {
  const f = await fixture(t); const booking = await f.actions.book(base); f.setClock('2026-11-09T00:00:00Z');
  await f.actions.claimDue(base);
  await f.actions.rememberExecution(booking.id, { ...base, world: '已选新世界' }, 'issue-original');
  const restarted = f.restart(); const resumed = await restarted.claimDue({ ...base, world: '用户另一世界' });
  assert.equal(resumed.resumeIssueId, 'issue-original');
  assert.equal(resumed.executionConfig.world, '已选新世界');
  assert.equal(await restarted.claimDue(base), null);
  await restarted.finish(booking.id, { issueId: 'issue-original' });
  assert.equal((await restarted.getBooking()).state, 'completed');
});

test('an old completion cannot overwrite a newer booking, and failed bookings do not loop', async t => {
  const f = await fixture(t); const old = await f.actions.book(base); const newer = await f.actions.book(base);
  await f.actions.finish(old.id, { issueId: 'old' });
  await f.actions.rememberExecution(old.id, base, 'old');
  assert.equal((await f.actions.getBooking()).id, newer.id);
  await f.actions.finish(newer.id, { error: new Error('服务失败') });
  assert.equal((await f.actions.getBooking()).state, 'error');
  f.setClock('2026-11-12T00:00:00Z'); assert.equal(await f.actions.claimDue(base), null);
});

test('blindbox selects a fresh DSH world today and keeps role, reference and rendering preferences', async t => {
  const f = await fixture(t); const prepared = await f.actions.prepare(base, { blindbox: true });
  assert.equal(prepared.world, '新世界1'); assert.equal(prepared.tripSource, 'dsh');
  assert.equal(prepared.tripStartDay, '2026-11-08');
  for (const key of ['characters', 'referenceId', 'referenceInstructions', 'imageToImage', 'styleId', 'width', 'height', 'imageChannel']) assert.equal(prepared[key], base[key], key);
  assert.equal(f.readConfig().world, '新世界1');
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].seed, /旧世界/);
});

test('blindbox uses observation fields and does not alter stored role travel', async t => {
  const config = { ...base, rolesEnabled: false, observerWorld: '观察旧世界', observerTripPrompt: '观察旧行程', observerTripMeta: '{"world":"观察旧世界"}' };
  const f = await fixture(t, { config }); const result = await f.actions.prepare(config, { blindbox: true });
  assert.equal(result.world, '旧世界'); assert.equal(result.observerWorld, '新世界1');
  assert.equal(result.observerTripStartDay, '2026-11-08'); assert.equal(result.rolesEnabled, false);
  assert.equal(f.calls[0].input.world, '观察旧世界'); assert.equal(f.calls[0].input.characters, '');
});

test('blindbox rejects previously visited names after three attempts and has no local fallback', async t => {
  const f = await fixture(t, { world: '已来过的新世界', visited: ['已来过的新世界'] });
  await assert.rejects(f.actions.prepare(base, { blindbox: true }), /新世界|到访|重复/);
  assert.equal(f.calls.length, 3); assert.equal(f.readConfig().world, '旧世界');
});

test('preparation saves onto latest config while preserving unrelated edits', async t => {
  let release, started; const ready = new Promise(resolve => { started = resolve; }); const pending = new Promise(resolve => { release = resolve; });
  const composer = { async generate() { started(); await pending; return { id: 'generation', source: 'dsh', idea: { world: '新世界' } }; }, async confirm() { return { world: '新世界', tripPrompt: '新行程', tripSource: 'dsh', tripMeta: '{"world":"新世界"}' }; } };
  const f = await fixture(t, { composer }); const run = f.actions.prepare(base, { blindbox: true }); await ready;
  f.setConfig({ ...base, downloadDirectory: 'E:/new-folder', imageChannel: 'new-channel' }); release(); await run;
  assert.equal(f.readConfig().world, '新世界'); assert.equal(f.readConfig().downloadDirectory, 'E:/new-folder'); assert.equal(f.readConfig().imageChannel, 'new-channel');
});

test('preparation does not overwrite a newer world or role selection', async t => {
  let release, started; const ready = new Promise(resolve => { started = resolve; }); const pending = new Promise(resolve => { release = resolve; });
  const composer = { async generate() { started(); await pending; return { id: 'generation', source: 'dsh', idea: { world: '新世界' } }; }, async confirm() { return { world: '新世界', tripPrompt: '新行程', tripSource: 'dsh' }; } };
  const f = await fixture(t, { composer }); const run = f.actions.prepare(base, { blindbox: true }); await ready;
  f.setConfig({ ...base, world: '用户刚选的世界', characters: '新角色' }); release(); const result = await run;
  assert.equal(f.readConfig().world, '用户刚选的世界'); assert.equal(f.readConfig().characters, '新角色');
  assert.equal(result.world, '新世界'); assert.equal(result.characters, '大肥鱼');
});

test('reply and fictional interference replace bounded interaction context while preserving original prompts', async t => {
  const f = await fixture(t);
  for (const mode of ['reply', 'interfere']) {
    const result = await f.actions.prepare(base, { interaction: { mode, text: '让虚构星球毁灭后长出新的森林' } });
    assert.equal(result.world, '旧世界'); assert.equal(result.characters, '大肥鱼');
    assert.match(result.interactionPrompt, /虚构星球毁灭/);
    assert.match(result.interactionId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(result.tripPrompt, base.tripPrompt); assert.equal(result.extraPrompt, base.extraPrompt);
  }
  for (const interaction of [{ mode: 'unknown', text: 'x' }, { mode: 'reply', text: '' }, { mode: 'interfere', text: 'x'.repeat(4001) }]) await assert.rejects(f.actions.prepare(base, { interaction }), /交互|指令|4000|模式/);
  const observer = { ...base, rolesEnabled: false, observerTripPrompt: '观察正文' };
  await assert.rejects(f.actions.prepare(observer, { interaction: { mode: 'reply', text: '你好' } }), /观察/);
  const result = await f.actions.prepare(observer, { interaction: { mode: 'interfere', text: '陨石改变海岸' } });
  assert.match(result.observerInteractionPrompt, /陨石改变海岸/);
  assert.ok(result.observerInteractionId);
  assert.equal(result.observerTripPrompt, '观察正文'); assert.equal(result.tripPrompt, '旧行程');
});

test('two maximum-length interactions never grow user prompts and remain valid normalized config', async t => {
  const initial = normalizeConfig({ ...base, imageToImage: false, referenceId: '', tripPrompt: '旅'.repeat(6000), extraPrompt: '额'.repeat(5900) });
  const f = await fixture(t, { config: initial });
  const first = await f.actions.prepare(initial, { interaction: { mode: 'reply', text: '甲'.repeat(4000) } });
  const second = await f.actions.prepare(f.readConfig(), { interaction: { mode: 'interfere', text: '乙'.repeat(4000) } });
  assert.equal(second.tripPrompt, initial.tripPrompt); assert.equal(second.extraPrompt, initial.extraPrompt);
  assert.ok(second.interactionPrompt.length <= 4500);
  assert.match(second.interactionPrompt, /乙{4000}/); assert.doesNotMatch(second.interactionPrompt, /甲/);
  assert.notEqual(second.interactionId, first.interactionId);
  assert.doesNotThrow(() => normalizeConfig(f.readConfig()));
});

test('blindbox clears prior interaction context in its new world', async t => {
  const initial = { ...base, interactionPrompt: '旧世界干涉命令', interactionId: 'old-id' };
  const f = await fixture(t, { config: initial }); const result = await f.actions.prepare(initial, { blindbox: true });
  assert.equal(result.interactionPrompt, ''); assert.equal(result.interactionId, '');
  assert.equal(f.readConfig().interactionPrompt, ''); assert.equal(f.readConfig().interactionId, '');
});

test('shared config mutation merges onto settings supplied inside the mutation callback', async t => {
  const f = await fixture(t, { mutateConfig: latest => ({ ...latest, downloadDirectory: 'F:/changed-during-mutation', imageChannel: 'new-channel' }) });
  await f.actions.prepare(base, { interaction: { mode: 'reply', text: '留下新的标记' } });
  assert.equal(f.readConfig().downloadDirectory, 'F:/changed-during-mutation');
  assert.equal(f.readConfig().imageChannel, 'new-channel');
  assert.match(f.readConfig().interactionPrompt, /留下新的标记/);
});

test('shared config mutation leaves a newer interaction untouched', async t => {
  const f = await fixture(t, { mutateConfig: latest => ({ ...latest, interactionPrompt: '较新的另一条命令', interactionId: 'newer-id' }) });
  await f.actions.prepare(base, { interaction: { mode: 'reply', text: '较旧命令' } });
  assert.equal(f.readConfig().interactionPrompt, '较新的另一条命令');
  assert.equal(f.readConfig().interactionId, 'newer-id');
});
