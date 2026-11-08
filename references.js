import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { characterAliases } from './character-tags.js';

const valid = id => typeof id === 'string' && /^[a-f\d]{32}$/.test(id);
export const characters = [
  { id:'deepseek', name:'DS大肥鱼', character:'DS大肥鱼（DeepSeek鲸鱼娘；蓝发、头鳍、鲸尾）', referenceId:'builtin-deepseek', file:'deepseek.webp' },
  { id:'gpt', name:'GPT 龙娘', character:'GPT龙娘（白发、龙角、龙翼与龙尾）', referenceId:'builtin-gpt', file:'gpt.webp' },
  { id:'claude', name:'Claude 大小姐', character:'Claude大小姐（橙发、花饰、优雅长裙）', referenceId:'builtin-claude', file:'claude.webp' },
].map(item=>({...item, aliases:characterAliases[item.id], source:'https://fisharchive.cc/characters', notice:'社区参考图，来源站标注非商业许可；作品权利归原作者。'}));
export async function saveReference(directory, data, name = '参考图') {
  if (!Buffer.isBuffer(data) || data.length > 16 * 1024 * 1024 || !data.length) throw new Error('参考图最多 16 MB');
  const source = sharp(data, { limitInputPixels: 64_000_000, animated: false }).rotate();
  const raw = await source.metadata();
  if (!['png', 'jpeg', 'webp'].includes(raw.format)) throw new Error('参考图仅支持 PNG、JPEG、WebP');
  const bytes = await source.resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  if (bytes.length > 16 * 1024 * 1024) throw new Error('参考图解码后过大，请缩小后上传');
  const meta = await sharp(bytes).metadata();
  const id = randomBytes(16).toString('hex');
  const record = { id, name: String(name).slice(0, 160), width: meta.width, height: meta.height };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${id}.png`), bytes);
  await writeFile(join(directory, `${id}.json`), JSON.stringify(record));
  return record;
}
export async function readReference(directory, id) {
  const builtin = characters.find(item=>item.referenceId===id);
  if (builtin) {
    const bytes = await readFile(new URL(`./assets/characters/${builtin.file}`, import.meta.url));
    const { width, height } = await sharp(bytes).metadata();
    return { meta:{id,name:builtin.name,width,height,source:builtin.source,notice:builtin.notice},bytes,source:{mediaType:'image/webp',data:bytes.toString('base64'),name:builtin.name} };
  }
  if (!valid(id)) throw new Error('参考图编号无效');
  try {
    const meta = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8'));
    const bytes = await readFile(join(directory, `${id}.png`));
    return { meta, bytes, source: { mediaType: 'image/png', data: bytes.toString('base64'), name: meta.name } };
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('参考图不存在，请重新上传或从图库选择');
    throw error;
  }
}
