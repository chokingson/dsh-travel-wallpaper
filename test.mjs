import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createServer } from 'node:http';
import * as api from './package.json' with { type: 'json' };

const load = async () => import(api.default.main).catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') assert.fail('缺少晨报任务实现');
  throw error;
});
const testImage = Buffer.from('89504e470d0a1a0a0102', 'hex');

test('范围内且未使用过的新闻优先，旧选题不重复', async () => {
  const { selectStory } = await load();
  const now = new Date('2026-11-04T12:00:00Z');
  const old = { title: '旧展会', url: 'https://example.org/old', publishedAt: '2026-09-01' };
  const seen = { title: '已用', url: 'https://example.org/seen', publishedAt: '2026-11-03' };
  const fresh = { title: '展会增设休息区', url: 'https://example.org/fresh', publishedAt: '2026-11-01' };
  assert.deepEqual(selectStory([old, seen, fresh], [seen.url], 30, now), fresh);
});

test('换图失败只重试应用，同一天不会重新生图', async () => {
  const { createDailyJob } = await load();
  const dir = await mkdtemp(join(tmpdir(), 'planet-news-'));
  try {
    let renders = 0;
    let attempts = 0;
    const story = { title: '兽装展', url: 'https://example.org/expo', publishedAt: '2026-11-03' };
    const deps = {
      dir, now: () => new Date('2026-11-04T12:00:00Z'),
      collect: async () => [story],
      writePrompt: async () => '兽娘国播报',
      render: async () => { renders++; return testImage; },
      publish: async (image) => {
        assert.deepEqual(await readFile(image), testImage);
        if (++attempts === 1) throw new Error('Wallpaper Engine 尚未运行');
      },
    };
    await assert.rejects(createDailyJob(deps).run({ days: 30 }), /尚未运行/);
    assert.equal((await createDailyJob(deps).run({ days: 30 })).state, 'published');
    assert.equal((await createDailyJob(deps).run({ days: 30 })).state, 'published');
    assert.equal(renders, 1);
    assert.equal(attempts, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('提示词撰写直接使用配置的 DSH 文本模型，且不开放工具', async () => {
  const { writePrompt } = await load();
  const llm = { async *stream(request) {
    assert.equal(request.provider, 'test-provider');
    assert.equal(request.model, 'test-model');
    assert.equal(request.tools, undefined);
    assert.match(request.messages[0].content[0].text, /空调补贴/);
    yield { type: 'text-delta', index: 0, text: '新闻演播厅。' };
    yield { type: 'text-delta', index: 0, text: '标题：空调补贴' };
    yield { type: 'finish', reason: 'stop' };
  } };
  const prompt = await writePrompt(llm, { title: '空调补贴' }, { textProvider: 'test-provider', textModel: 'test-model' }, []);
  assert.equal(prompt, '新闻演播厅。标题：空调补贴');
});

test('订阅生图复用 Studio 已登录的模型和附件，不读账号凭证', async () => {
  const { renderWithStudio } = await load();
  assert.equal(typeof renderWithStudio, 'function', '应支持调用已安装的 Studio');
  const calls = [];
  const bytes = Buffer.from('89504e470d0a1a0a0102', 'hex');
  const attachment = { attachmentId: 'test-image' };
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    calls.push([req.method, req.url, input]);
    if (req.method === 'GET') res.end(JSON.stringify({ providers: [{ provider: 'google-sub', model: 'test-model', configured: true, ratioOptions: [{ value: '16:9' }], defaultQuality: 'standard' }] }));
    else if (req.url.endsWith('/studio')) res.end(`\n${JSON.stringify({ attachment })}`);
    else res.end(bytes);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await renderWithStudio(`http://127.0.0.1:${server.address().port}`, 'google-sub', '兽娘国播报');
    assert.deepEqual(result, bytes);
    assert.deepEqual(calls, [
      ['GET', '/plugins/dsh-image-gen/studio', null],
      ['POST', '/plugins/dsh-image-gen/studio', { mode: 'generate', provider: 'google-sub', model: 'test-model', prompt: '兽娘国播报', ratio: '16:9', quality: 'standard', count: 1 }],
      ['POST', '/plugins/dsh-image-gen/image', { attachment }],
    ]);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('故事壁纸无需新闻源，可沿用文明和画风每天续写', async () => {
  const { createDailyJob } = await load();
  const dir = await mkdtemp(join(tmpdir(), 'planet-world-'));
  try {
    let observed;
    const job = createDailyJob({ dir, now: () => new Date('2026-11-06T04:00:00Z'),
      collect: async () => { throw new Error('世界故事应当能够独立制作'); },
      writePrompt: async (story, config) => { observed = { story, config }; return '江东续篇'; },
      render: async () => testImage, publish: async () => {},
    });
    assert.equal((await job.run({ sourceMode: 'world', world: '穿越三国', style: '2.5D', characters: '大乔，小乔，甄姬' })).state, 'published');
    assert.equal(observed.config.style, '2.5D');
    assert.equal(observed.story.dateKind, 'fiction');
    assert.match(observed.story.title, /穿越三国/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('故事插画写稿遵循用户画风，不套用主播演播室构图', async () => {
  const { writePrompt } = await load();
  let task;
  const llm = { async *stream(request) {
    task = request.messages[0].content[0].text;
    yield { type: 'text-delta', text: '小乔在竹林中发现异时代的信笺。' };
    yield { type: 'finish', reason: 'stop' };
  } };
  await writePrompt(llm, { title: '小乔 · 竹林来信', character: '小乔' }, {
    presentation: 'illustration', world: '穿越三国', style: '2.5D 半写实国风',
    textProvider: 'test', textModel: 'test',
  }, [{ story: { title: '大乔 · 江东来客' } }]);
  assert.match(task, /2.5D 半写实国风/);
  assert.match(task, /小乔/);
  assert.doesNotMatch(task, /主播在新闻演播室/);
});

test('同日另做一张会保存原图和原提示词，失败时可重试应用', async () => {
  const { createDailyJob } = await load();
  const dir = await mkdtemp(join(tmpdir(), 'planet-revision-'));
  try {
    await writeFile(join(dir, '2026-11-06.json'), JSON.stringify({ day: '2026-11-06', state: 'published', prompt: '大乔原稿', story: { title: '大乔', url: '' } }));
    await writeFile(join(dir, '2026-11-06.png'), 'original');
    let renders = 0;
    const job = createDailyJob({ dir, now: () => new Date('2026-11-06T04:00:00Z'),
      collect: async () => [], writePrompt: async () => '小乔新稿', render: async () => { renders++; return testImage; }, publish: async () => {},
    });
    const result = await job.run({ sourceMode: 'world', world: '穿越三国', characters: '小乔' }, { force: true });
    assert.equal(result.state, 'published');
    assert.equal(renders, 1);
    assert.equal(await readFile(join(dir, '2026-11-06.png'), 'utf8'), 'original');
    assert.equal(JSON.parse(await readFile(join(dir, '2026-11-06.json'), 'utf8')).prompt, '大乔原稿');
    assert.equal(result.prompt, '小乔新稿');
    assert.notEqual(result.imageFile, '2026-11-06.png');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('设置接口兼容旧图库，预览只写稿，未知操作保留配置', async () => {
  const { apply } = await load();
  const dir = await mkdtemp(join(tmpdir(), 'planet-host-'));
  const previousHome = process.env.DSH_HOME;
  const cleanups = [];
  let route;
  let writes = 0;
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, 'planet-news', 'issues'), { recursive: true });
  await writeFile(join(dir, 'planet-news', 'config.json'), '\uFEFF' + JSON.stringify({
    world: '穿越三国', sourceMode: 'world', presentation: 'illustration', characters: '大乔，小乔，甄姬',
    textProvider: 'test', textModel: 'test', promptMode: 'llm', enabled: false, newsBallEnabled:false,
  }));
  await writeFile(join(dir, 'planet-news', 'issues', '2026-11-05.json'), JSON.stringify({
    day: '2026-11-05', state: 'published', story: { title: '大乔 · 江东来客' }, prompt: '原提示词',
  }));
  await writeFile(join(dir, 'planet-news', 'issues', '2026-11-05.png'), testImage);
  process.env.DSH_HOME = dir;
  const server = createServer((req, res) => route.handler(req, res));
  try {
    apply({ effect(callback) { const dispose = callback(); if (typeof dispose === 'function') cleanups.push(dispose); },
      webServer: { register(value) { route = value; return () => {}; } },
      llm: { async *stream() { writes++; yield { type: 'text-delta', text: '小乔在织坊' }; yield { type: 'finish', reason: 'stop' }; } },
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const root = `http://127.0.0.1:${server.address().port}`;
    const post = body => fetch(root, { method: 'POST', headers: { origin: root, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const history = await (await fetch(root + '?history')).json();
    assert.equal(history.issues[0].title, '大乔 · 江东来客');
    assert.deepEqual(Buffer.from(await (await fetch(root + '?image=2026-11-05')).arrayBuffer()), testImage);
    assert.equal((await fetch(root + '?image=../../credentials')).status, 400);
    assert.equal((await post({ action: 'preview' })).status, 200);
    assert.equal((await post({ action: 'preview' })).status, 200);
    assert.equal(writes, 1, '预览相同稿件应重用文本结果');
    assert.equal((await post({ action: 'typo' })).status, 400);
    assert.equal((await (await fetch(root)).json()).config.world, '穿越三国');
    assert.equal((await (await fetch(root + '?catalog')).json()).styles.length, 20);
    assert.equal((await post({ config: { wallpaperMode: 'windows', dailyCount: 2 } })).status, 400);
    const sharp = (await import('sharp')).default;
    const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#118877' } }).png().toBuffer();
    const uploaded = await (await post({ action: 'upload', name: '<参考图>.png', data: png.toString('base64') })).json();
    assert.match(uploaded.reference.id, /^[a-f\d]{32}$/);
    assert.equal((await fetch(root + '?referenceImage=' + uploaded.reference.id)).status, 200);
    assert.equal((await fetch(root + '?referenceImage=../../config')).status, 400);
    assert.equal((await post({ config: { referenceId: uploaded.reference.id, imageChannel: 'chatgpt-sub' } })).status, 200);
    assert.equal((await post({ config: { referenceId: 'a'.repeat(32), imageToImage:false } })).status, 200);
    assert.equal((await fetch(root)).status,200,'底图丢失不阻断关闭图生图后的设置页');
    assert.equal((await post({ config: { imageToImage:true } })).status,400);
    assert.equal((await post({ config: { referenceId: uploaded.reference.id, imageToImage:false } })).status,200);
    const direct = await (await post({ config: { promptMode: 'direct', style: '我的水墨', textDensity: 'none' } })).json();
    assert.equal(direct.config.style, '我的水墨');
    const preview = await (await post({ action: 'preview' })).json();
    assert.equal(writes, 1, '默认直接交给生图模型，不暗中调用其它文本渠道');
    assert.equal(preview.parts[0].kind, 'style');
    assert.match(preview.prompt, /我的水墨/); assert.match(preview.prompt, /不出现任何文字/);
  } finally {
    cleanups.forEach(dispose => dispose());
    await new Promise(resolve => server.close(resolve));
    if (previousHome === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previousHome;
    await rm(dir, { recursive: true, force: true });
  }
});

test('重启后能恢复崩溃留下的空锁文件', async () => {
  const { createDailyJob } = await load();
  const dir = await mkdtemp(join(tmpdir(), 'planet-lock-'));
  try {
    const lock = join(dir, 'running.lock');
    await writeFile(lock, '');
    await utimes(lock, new Date(0), new Date(0));
    const job = createDailyJob({ dir, collect: async () => [], writePrompt: async () => '新一期', render: async () => testImage, publish: async () => {} });
    assert.equal((await job.run({ sourceMode: 'world', world: '穿越三国' })).state, 'published');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('小红车未运行时先独立启动，服务进程不算桌面主程序', async () => {
  const { openWallpaper } = await load();
  assert.equal(typeof openWallpaper, 'function');
  const calls = [];
  let queries = 0;
  await openWallpaper('D:/WE/wallpaper32.exe', 'C:/daily/project.json', {
    execute: async (file, args, options) => {
      calls.push({ file, args, options });
      if (file === 'tasklist.exe') return { stdout: ++queries === 1 ? '"wallpaperservice32.exe","123"' : '"wallpaper32.exe","456"' };
      return { stdout: '' };
    },
    launch: async (file, args, options) => calls.push({ launch: true, file, args, options }),
    delay: async () => {},
  });
  const launch = calls.find(item => item.launch);
  assert.ok(launch, '只有 Windows 服务时应启动桌面程序');
  assert.equal(launch.options.cwd.replaceAll('\\', '/'), 'D:/WE');
  assert.equal(launch.options.detached, true, '不能用有超时杀进程的命令启动常驻程序');
  assert.ok(calls.findIndex(item => item.launch) < calls.findIndex(item => item.args.includes('openWallpaper')));
});

test('换图成功必须收到壁纸实际载入成图的回执，命令返回不算成功', async () => {
  const { publishWallpaper } = await load();
  const dir = await mkdtemp(join(tmpdir(), 'planet-publish-'));
  try {
    const image = join(dir, 'source.png');
    await writeFile(image, testImage);
    await assert.rejects(publishWallpaper(image, { wallpaperExe: 'fake.exe' }, dir, {
      open: async () => {}, readyTimeout: 50,
    }), /未确认.*载入/);
    let callback;
    await publishWallpaper(image, { wallpaperExe: 'fake.exe' }, dir, {
      open: async () => {
        const html = await readFile(join(dir, 'index.html'), 'utf8');
        callback = /http:\/\/127\.0\.0\.1:\d+\/ready\/[a-f\d]+/.exec(html)?.[0];
        assert.ok(callback, '壁纸图片载入后应返回随机回执');
        assert.match(html, /onload/);
        assert.equal((await fetch(callback + 'wrong')).status, 404);
        assert.equal((await fetch(callback)).status, 204);
      }, readyTimeout: 1000,
    });
    assert.deepEqual(await readFile(join(dir, 'current.png')), testImage);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('20种画风均可追溯，提示词独立保存画风片段，tag可编辑且尺寸数量受限', async () => {
  const { styles, normalizeConfig, promptParts, randomWorld } = await import('./catalog.js');
  assert.equal(styles.length, 20);
  assert.equal(new Set(styles.map(item => item.id)).size, 20);
  for (const style of styles) assert.ok(style.prompt.length > 15);
  const config = normalizeConfig({ wallpaperMode: 'windows', style: '我的工笔', width: 1920, height: 1080, tags: '烟雨，<script>自定义</script>' });
  const parts = promptParts(config, '来到江东');
  assert.equal(parts[0].kind, 'style');
  assert.match(parts[0].text, /我的工笔/);
  assert.match(parts.map(item => item.text).join(''), /<script>自定义<\/script>/);
  assert.throws(() => normalizeConfig({ wallpaperMode: 'windows', dailyCount: 2 }), /小红车|Wallpaper Engine/);
  assert.throws(() => normalizeConfig({ wallpaperMode: 'engine', dailyCount: 21 }), /20/);
  assert.throws(() => normalizeConfig({ width: 99999 }), /分辨率/);
  assert.match(randomWorld('华强买瓜世界').world, /华强买瓜/);
});

test('每日多图中断后从已存图片续做，不重复生图且保留每张画风', async () => {
  const { createDailyJob } = await load();
  const dir = await mkdtemp(join(tmpdir(), 'planet-batch-'));
  try {
    let renders = 0;
    let fail = true;
    let published;
    const job = createDailyJob({ dir, now: () => new Date('2026-11-07T04:00:00Z'),
      collect: async () => [], writePrompt: async story => `画风：工笔。${story.character}`,
      render: async () => { renders++; if (renders === 2 && fail) throw new Error('暂时限流'); return testImage; },
      publish: async images => { published = images; },
    });
    const config = { dailyCount: 3, wallpaperMode: 'engine', sourceMode: 'world', world: '三国', characters: '大乔，小乔，甄姬', style: '工笔' };
    await assert.rejects(job.run(config), /暂时限流/);
    assert.equal(JSON.parse(await readFile(join(dir, '2026-11-07.json'))).images.length, 1);
    fail = false;
    const result = await job.run({ ...config, style: '中途改变' });
    assert.equal(result.images.length, 3);
    assert.equal(renders, 4, '只重试失败图片，已保存的第一张不重画');
    assert.deepEqual(result.images.map(item => item.story.character), ['大乔', '小乔', '甄姬']);
    assert.ok(result.images.every(item => item.style === '工笔'), '同一批次沿用启动时的设置');
    assert.equal(published.length, 3);
    await job.run(config);
    assert.equal(renders, 4);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('自定义输出尺寸真实适配，Windows模式不启动小红车且拒绝轮播', async () => {
  const { prepareImage, publishNative } = await import('./desktop.js');
  const sharp = (await import('sharp')).default;
  const source = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#aa7711' } }).png().toBuffer();
  const result = await prepareImage(source, { width: 320, height: 480, fit: 'contain' });
  const meta = await sharp(result.bytes).metadata();
  assert.equal(meta.width, 320); assert.equal(meta.height, 480);
  assert.equal(result.originalWidth, 400);
  const dir = await mkdtemp(join(tmpdir(), 'planet-native-'));
  try {
    const file = join(dir, 'image.png'); await writeFile(file, source);
    let applied;
    await publishNative(file, {}, dir, { execute: async (exe, args, options) => { applied = { exe, args, options }; return { stdout: '{"applied":true}' }; } });
    assert.equal(applied.exe, 'powershell.exe');
    assert.ok(applied.args.includes('-Command'), '默认禁止脚本文件的Windows也可通过固定API调用工作');
    assert.equal(applied.options.env.PLANET_IMAGE_PATH, file);
    assert.ok(!applied.args.includes('-ExecutionPolicy'), '不得修改脚本执行策略');
    await assert.rejects(publishNative([file, file], {}, dir), /单张|一张/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('参考图真正传入Studio edit，竖屏按渠道能力选择比例', async () => {
  const { renderWithStudio } = await load();
  let request;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') return res.end(JSON.stringify({ providers: [{ provider: 'chatgpt-sub', model: 'gpt', configured: true, supportsEditing: true,
      ratioOptions: [{ value: '16:9' }, { value: '9:16' }], defaultQuality: 'standard', defaultRatio: '16:9' }] }));
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    if (req.url.endsWith('/studio')) { request = JSON.parse(Buffer.concat(chunks)); res.end(JSON.stringify({ attachment: { id: 'output' } })); }
    else res.end(testImage);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const reference = { mediaType: 'image/png', data: testImage.toString('base64'), name: '人物.png' };
    await renderWithStudio(`http://127.0.0.1:${server.address().port}`, 'chatgpt-sub', '保留人物，改为水墨', { width: 1080, height: 1920, reference });
    assert.equal(request.mode, 'edit'); assert.equal(request.ratio, '9:16');
    assert.deepEqual(request.reference, reference);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('同日另做多图组可应用，图片路径仍拒绝目录穿越', async () => {
  const { createDailyJob } = await load();
  const dir = await mkdtemp(join(tmpdir(), 'planet-force-batch-'));
  try {
    let applied;
    const job = createDailyJob({ dir, collect: async () => [], writePrompt: async () => '国风', render: async () => testImage, publish: async files => { applied = files; } });
    const issue = await job.run({ sourceMode: 'world', dailyCount: 2, characters: '大乔，小乔', style: '工笔' }, { force: true });
    assert.equal(issue.state, 'published'); assert.equal(applied.length, 2);
    assert.deepEqual(await readFile(applied[1]), testImage);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('新闻参考来源消失后仍续做已经写好并保存的稿件', async () => {
  const { createDailyJob } = await load();
  const dir = await mkdtemp(join(tmpdir(), 'planet-pending-'));
  try {
    let collected = 0, rendered = 0;
    const job = createDailyJob({ dir, collect: async () => ++collected === 1 ? [{ title: '展会', url: 'https://example.org/news', publishedAt: '2026-11-07' }] : [],
      now: () => new Date('2026-11-07T12:00:00Z'), writePrompt: async () => '原稿', render: async () => { if (++rendered === 1) throw new Error('渠道暂时失败'); return testImage; }, publish: async () => {} });
    await assert.rejects(job.run({ days: 30 }), /暂时失败/);
    assert.equal((await job.run({ days: 30 })).state, 'published');
    assert.equal(rendered, 2); assert.equal(collected, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('图库换图期间阻止第二次应用和每日制作互相覆盖', async () => {
  const { apply } = await load();
  const dir = await mkdtemp(join(tmpdir(), 'planet-apply-lock-'));
  const previousHome = process.env.DSH_HOME;
  const { mkdir } = await import('node:fs/promises');
  const folder = join(dir, 'planet-news', 'issues'); await mkdir(folder, { recursive: true });
  await writeFile(join(dir, 'planet-news', 'config.json'), JSON.stringify({ enabled: false }));
  await writeFile(join(folder, '2026-11-07.json'), JSON.stringify({ day: '2026-11-07', state: 'rendered', prompt: '提示', story: { title: '测试' } }));
  await writeFile(join(folder, '2026-11-07.png'), testImage);
  process.env.DSH_HOME = dir;
  let route, release, entered, calls = 0;
  const gate = new Promise(resolve => { entered = resolve; });
  const cleanups = [];
  apply({ effect(fn) { const dispose = fn(); if (typeof dispose === 'function') cleanups.push(dispose); }, webServer: { register(value) { route = value; return () => {}; } }, llm: {} }, undefined,
    async () => { if (++calls === 1) { entered(); await new Promise(resolve => { release = resolve; }); } });
  const server = createServer((req,res)=>route.handler(req,res)); await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const post = action => fetch(origin, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ action, issueId: '2026-11-07' }) });
    const first = post('apply'); await gate;
    try { assert.equal((await post('apply')).status, 409); assert.equal((await post('run')).status, 409); }
    finally { release(); await first; }
  } finally {
    cleanups.forEach(fn=>fn()); await new Promise(resolve=>server.close(resolve));
    if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome;
    await rm(dir, { recursive: true, force: true });
  }
});

test('新用户复用壁纸引擎插件发现路径，找不到程序时不伪称可用', async () => {
  const { discoverEngine } = await load();
  assert.equal(typeof discoverEngine, 'function');
  const dir = await mkdtemp(join(tmpdir(), 'planet-engine-discover-'));
  const server = createServer((req, res) => res.end(JSON.stringify({ installDir: dir })));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await discoverEngine(origin, { ambient:false }), '');
    await writeFile(join(dir, 'wallpaper32.exe'), 'installed');
    assert.equal(await discoverEngine(origin, { ambient:false }), join(dir, 'wallpaper32.exe'));
  } finally { await new Promise(resolve=>server.close(resolve)); await rm(dir,{recursive:true,force:true}); }
});

test('小红车轮播页按设定间隔切换并循环，最多20张', async () => {
  const { publishWallpaper } = await load();
  const { runInNewContext } = await import('node:vm');
  const dir = await mkdtemp(join(tmpdir(), 'planet-slides-'));
  try {
    const source = join(dir, 'test.png'); await writeFile(source, testImage);
    await publishWallpaper(Array(20).fill(source), { wallpaperExe: 'fake', intervalMinutes: 7 }, dir, { open: async () => {
      const html = await readFile(join(dir, 'index.html'), 'utf8');
      const callback = /http:\/\/127\.0\.0\.1:\d+\/ready\/[a-f\d]+/.exec(html)[0];
      const script = /<script>([\s\S]+)<\/script>/.exec(html)[1];
      const element = { src: '' }; let next, interval;
      runInNewContext(script, { document: { getElementById() { return element; } }, setInterval(fn, ms) { next = fn; interval = ms; } });
      assert.equal(interval, 420000);
      next(); assert.match(element.src, /^slide-1-/);
      for (let i = 1; i < 20; i++) next();
      assert.match(element.src, /^current\.png/);
      await fetch(callback);
    }, readyTimeout: 500 });
    assert.equal(JSON.parse(await readFile(join(dir, 'playlist.json'))).slides.length, 20);
  } finally { await rm(dir,{recursive:true,force:true}); }
});
