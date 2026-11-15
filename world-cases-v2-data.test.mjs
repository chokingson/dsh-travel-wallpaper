import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timeTags } from './world-cases.js';

const expectedNames = [
  '熔岩地球漂浮岛', '寒武纪海底奇旅', '穿越侏罗纪巨兽森林', '冰河时代迁徙谷', '史前洞穴壁画国',
  '三国演义小说平行世界', '盛唐灯河梦境', '宋朝汴京夜市', '航海钟表群岛', '民国烟雨江南',
  '黑白侦探都会', '蛙世界', '像素街机世界', '千禧年互联网城', '给它爱星球／罗胜都',
  '华强买瓜平行世界', '鬼畜剪辑平行世界', '赛博朋克霓虹城', '无生命黄金星球', '兽娘星球联邦',
  '汪咚星', '粘粘星', '恐龙修仙宗门', '蒸汽雾都', '精灵之森',
  '桃源世界', '百鬼夜行城', '山村夜祀', '西部荒野', '亡者末班列车',
  '无尽后室', '永夜血族古堡', '海盗与海怪之海', '超级英雄都市', '天灾荒岛',
  '异兽契约大陆', '魔王与勇者之境', '青春校园群像', '折纸山河', '翻页童话国',
  '魔女糖果森林', '巨人国', '倒置重力大陆', '地底菌光迷宫', '丧尸围城',
  '架空冷战谍影', '武侠江湖', '深宫夺嫡', '魔法学院', '无限试炼空间',
];

const retainedIds = {
  '熔岩地球漂浮岛': 'lava-earth', '寒武纪海底奇旅': 'cambrian-sea', '穿越侏罗纪巨兽森林': 'jurassic',
  '冰河时代迁徙谷': 'ice-migration', '史前洞穴壁画国': 'cave-painting', '三国演义小说平行世界': 'three-kingdoms-novel',
  '盛唐灯河梦境': 'tang-lantern', '宋朝汴京夜市': 'song-night-market', '航海钟表群岛': 'sail-clock-island',
  '民国烟雨江南': 'republic-rain', '黑白侦探都会': 'noir-detective', '像素街机世界': 'pixel-arcade',
  '千禧年互联网城': 'millennium-web', '华强买瓜平行世界': 'huaqiang-melon', '鬼畜剪辑平行世界': 'remix-world',
  '赛博朋克霓虹城': 'cyberpunk', '兽娘星球联邦': 'beast-federation', '恐龙修仙宗门': 'dinosaur-cultivation',
  '蒸汽雾都': 'victoria', '精灵之森': 'elf-machinery',
};

const retiredIds = [
  'cosmic-dawn', 'solar-dust', 'first-life', 'asteroid-eve', 'first-river-city', 'clay-star-market',
  'bronze-salt-road', 'bronze-dragon', 'hundred-schools', 'qin-courier', 'silk-oasis', 'ming-voyage',
  'steampunk-port', 'mysteries-novel', 'jazz-record-city', 'new-city-neighborhood', 'moon-cafe', 'cassette-town',
  'mobile-spring', 'rain-memory-city', 'threebody-novel', 'pacific-islands', 'mars-greenhouse', 'whale-ocean',
  'orbital-post', 'dyson-school', 'wasteland-seed', 'memory-library', 'desk-planet', 'far-starlight',
];

const load = async () => (await import('./world-cases-v2-data.js')).approvedWorldData;
const worldText = row => [row.environment, row.society, ...row.rules, ...row.motifs].join('；');

test('approved catalogue exposes the exact 50 requested worlds in order', async () => {
  const rows = await load();
  assert.equal(rows.length, 50);
  assert.deepEqual(rows.map(row => row.world), expectedNames);
  assert.equal(new Set(rows.map(row => row.id)).size, 50);
});

test('retained worlds keep semantic IDs and new worlds never inherit retired IDs', async () => {
  const rows = await load();
  for (const [world, id] of Object.entries(retainedIds)) {
    assert.equal(rows.find(row => row.world === world)?.id, id, world);
  }
  for (const row of rows) {
    assert.match(row.id, /^[a-z][a-z0-9-]*$/, row.world);
    assert.ok(!retiredIds.includes(row.id), row.id);
  }
});

test('world facts use existing time tags and fiction does not borrow unrelated historical dates', async () => {
  const rows = await load();
  const ids = new Set(timeTags.map(tag => tag.id));
  assert.equal(ids.size, 50);
  for (const row of rows) {
    assert.ok(row.timeIds.length, row.world);
    assert.equal(new Set(row.timeIds).size, row.timeIds.length, row.world);
    for (const id of row.timeIds) assert.ok(ids.has(id), `${row.world}: ${id}`);
    if (!Object.values(retainedIds).includes(row.id) && row.world !== '西部荒野') {
      assert.deepEqual(row.timeIds, ['fiction'], row.world);
    }
  }
  const byName = Object.fromEntries(rows.map(row => [row.world, row]));
  for (const [name, ids] of [
    ['寒武纪海底奇旅', ['cambrian']], ['穿越侏罗纪巨兽森林', ['jurassic']],
    ['冰河时代迁徙谷', ['ice-age']], ['三国演义小说平行世界', ['ce208']],
    ['盛唐灯河梦境', ['ce755']], ['宋朝汴京夜市', ['ce1000']],
    ['民国烟雨江南', ['ce1912', 'ce1920', 'ce1930']], ['西部荒野', ['ce1870', 'ce1880']],
  ]) assert.deepEqual(byName[name].timeIds, ids, name);
});

test('catalogue contains world facts without preset travelers, moral positions, tones or plot routes', async () => {
  const rows = await load();
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['id', 'world', 'timeIds', 'environment', 'society', 'rules', 'motifs'].sort(), row.world);
    for (const key of ['environment', 'society']) assert.ok(typeof row[key] === 'string' && row[key].trim(), `${row.world}: ${key}`);
    for (const key of ['rules', 'motifs']) {
      assert.ok(Array.isArray(row[key]) && row[key].length >= 1 && row[key].length <= 3, `${row.world}: ${key}`);
      assert.ok(row[key].every(value => typeof value === 'string' && value.trim()), `${row.world}: ${key}`);
    }
    assert.doesNotMatch(worldText(row), /旅行角色|旅行主角|旅人|你将|你必须|必须帮助|最终|转向|温暖喜剧|幽默冒险|第一幕|第一步|第二步|第三步|→/, row.world);
  }
});

test('special world facts preserve approved limits and the steam and elf revisions', async () => {
  const rows = await load();
  const text = name => worldText(rows.find(row => row.world === name));
  assert.match(text('蛙世界'), /蛙文明/);
  for (const detail of ['空间技术', '抹茶绿', '珍贵', '永不过期', '茶叶蛋']) assert.ok(text('蛙世界').includes(detail), detail);
  for (const detail of ['空间快递', '宇宙商贸', '甜喵族', '汪咚', '贫兮兮', '竞争', '主导']) assert.ok(text('汪咚星').includes(detail), detail);
  assert.match(text('无生命黄金星球'), /无本地生命|没有本地生命/);
  assert.doesNotMatch(text('无生命黄金星球'), /居民|聚落|矿工|城市|商店|商人|文明/);
  assert.match(text('蒸汽雾都'), /维多利亚/);
  assert.match(text('蒸汽雾都'), /天空城|浮空街区/);
  assert.match(text('精灵之森'), /精灵/);
  assert.match(text('精灵之森'), /古树|自然魔法/);
  assert.doesNotMatch(text('精灵之森'), /机械|机关|蒸汽|齿轮/);
  assert.doesNotMatch(text('青春校园群像'), /成为学生|学生身份|新生身份/);
  assert.match(text('魔王与勇者之境'), /称号.*善恶|善恶.*称号/);
});

test('new facts introduce no unapproved source names or franchise shorthand', async () => {
  const rows = await load();
  const text = rows.map(row => [row.world, worldText(row)].join('；')).join('\n');
  assert.doesNotMatch(text, /三体|诡秘之主|侠盗猎车|Grand Theft Auto|\bGTA\b|洛圣都|宝可梦|霍格沃茨|克苏鲁|漫威|DC宇宙|小马宝莉|魔戒|加勒比海盗/i);
});
