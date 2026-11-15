import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import * as catalog from './catalog.js';

const expectedStyles = [
  ['guofeng', '2.5D国风卡牌', '2.5D国风插画，细腻设色，立体光影。', '#b89a63'],
  ['anime', '二次元', '二次元动漫插画，清晰线条，分层设色。', '#eaa1c8'],
  ['cel', '赛璐璐', '赛璐璐风，平整色块，硬边阴影。', '#61bdd1'],
  ['ink', '写意水墨', '写意水墨，浓淡干湿，宣纸质感。', '#879b91'],
  ['gongbi', '工笔重彩', '工笔重彩，细线勾勒，层层罩染。', '#bc6558'],
  ['watercolor', '透明水彩', '透明水彩，通透叠色，水痕晕染。', '#89bba8'],
  ['oil', '古典油画', '古典油画，厚薄笔触，画布肌理。', '#92684f'],
  ['cinema', '电影写实', '写实摄影，电影质感，真实材质。', '#7a98b5'],
  ['pixel', '精致像素', '像素艺术，清晰像素，有限色板。', '#8e83d0'],
  ['lowpoly', '低多边形', '低多边形风，几何切面，简约材质。', '#79a7bd'],
  ['clay', '黏土定格', '黏土定格风，手塑质感，细微颗粒。', '#d89a75'],
  ['render', '精致三维', '风格化三维渲染，立体造型，细致材质。', '#9f90bc'],
  ['paper', '层叠剪纸', '层叠剪纸，清晰纸边，层间投影。', '#ce866c'],
  ['nouveau', '新艺术装饰', '新艺术装饰风，流动曲线，精细纹样。', '#a9a06b'],
  ['poster', '复古海报', '复古印刷风，套色错版，纸张颗粒。', '#db8b65'],
  ['vapor', '蒸汽波', '蒸汽波风，粉紫青蓝，复古数码质感。', '#c486d2'],
  ['comic', '清线漫画', '清线漫画，均匀轮廓，平整配色。', '#d0af6c'],
  ['fantasy', '史诗幻想', '幻想概念绘画风，丰富层次，细致笔触。', '#7194a2'],
  ['flat', '几何平涂', '几何平涂，简洁形状，清楚色块。', '#d7ab79'],
  ['neon', '霓虹概念', '霓虹概念风，发光色彩，边缘光晕。', '#7c88d1'],
];

test('20种画风保留原ID、顺序和颜色，并使用确认的名称与简短提示词', () => {
  assert.equal(catalog.styles.length, 20);
  assert.deepEqual(
    catalog.styles.map(({ id, name, prompt, color }) => [id, name, prompt, color]),
    expectedStyles,
  );
  for (const [id, , prompt] of expectedStyles) {
    const style = catalog.styles.find(item => item.id === id);
    assert.equal(catalog.promptParts({ style: style.prompt }, '旅行场景')[0].text, `【画风】\n${prompt}\n\n`);
  }
});

test('新配置以二次元为默认画风', () => {
  const expectedPrompt = '二次元动漫插画，清晰线条，分层设色。';
  const config = catalog.normalizeConfig();
  assert.equal(config.styleId, 'anime');
  assert.equal(config.style, expectedPrompt);
  assert.equal(catalog.configDefaults.styleId, 'anime');
  assert.equal(catalog.configDefaults.style, expectedPrompt);
  assert.equal(catalog.defaultStyle, catalog.styles.find(style => style.id === 'anime'));
  assert.equal(catalog.promptParts(config, '旅行场景')[0].text, `【画风】\n${expectedPrompt}\n\n`);
});

test('画风缺省或为空时提示词回退到二次元', () => {
  const expectedPrompt = '二次元动漫插画，清晰线条，分层设色。';
  for (const value of [{}, { style: '' }]) {
    assert.equal(catalog.promptParts(value, '旅行场景')[0].text, `【画风】\n${expectedPrompt}\n\n`);
  }
});

test('显式自定义和已有用户画风原样保留，不迁移已保存的提示词', () => {
  for (const saved of [
    { styleId: 'custom', style: '  用户自定义：疏朗铅笔线稿，保留这段完整描述。  ' },
    { styleId: 'guofeng', style: '用户已保存的旧版国风提示词，完整保留。' },
    { styleId: 'custom', style: '' },
  ]) {
    const before = { ...saved };
    const config = catalog.normalizeConfig(saved);
    assert.equal(config.styleId, saved.styleId);
    assert.equal(config.style, saved.style);
    assert.deepEqual(saved, before);
    if (saved.style) assert.equal(catalog.promptParts(config, '旅行场景')[0].text, `【画风】\n${saved.style}\n\n`);
  }
});

test('20种原ID继续对应现有非空WebP预览文件', async () => {
  const manifest = JSON.parse(await readFile(new URL('./assets/styles/index.json', import.meta.url), 'utf8'));
  for (const [id] of expectedStyles) {
    const preview = new URL(`./assets/styles/${id}.webp`, import.meta.url);
    assert.ok((await stat(preview)).size > 0, `${id} preview must be present`);
    const bytes = await readFile(preview);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF', `${id} preview must be WebP`);
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP', `${id} preview must be WebP`);
    assert.ok(manifest.items.some(item => item.id === id), `${id} preview must remain in manifest`);
  }
});
