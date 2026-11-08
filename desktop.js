import sharp from 'sharp';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile } from 'node:fs/promises';
import { join, win32 } from 'node:path';

const exec = promisify(execFile);
export async function prepareImage(bytes, config) {
  const pipeline = sharp(bytes, { limitInputPixels: 64_000_000, animated: false }).rotate();
  const metadata = await pipeline.metadata();
  const width = config.width || 1920, height = config.height || 1080;
  const output = await pipeline.resize(width, height, { fit: config.fit || 'contain', background: '#111318' }).flatten({ background: '#111318' }).png().toBuffer();
  return { bytes: output, width, height, originalWidth: metadata.width, originalHeight: metadata.height };
}

export async function publishNative(image, config, directory, { execute = exec } = {}) {
  if (Array.isArray(image)) {
    if (image.length !== 1) throw new Error('Windows 静态壁纸只支持单张；轮播请选择小红车');
    [image] = image;
  }
  await mkdir(directory, { recursive: true });
  if (config.wallpaperExe) {
    const { stdout } = await execute('tasklist.exe', ['/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq wallpaper*'], { windowsHide: true, timeout: 5000 });
    if (/^"wallpaper(?:32|64)\.exe",/im.test(stdout)) {
      // Remove the foreground desktop layer so the chosen Windows background is visible.
      await execute(config.wallpaperExe, ['-control', 'closeWallpaper', '-monitor', '0'], { windowsHide: true, timeout: 15_000 });
    }
  }
  const source = await readFile(new URL('./wallpaper.ps1', import.meta.url), 'utf8');
  const command = source.replace(/^param\([^\n]*\)\r?\n/, '$ImagePath = $env:PLANET_IMAGE_PATH\n$BitmapPath = $env:PLANET_BITMAP_PATH\n');
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, timeout: 30_000, maxBuffer: 256_000,
    env: { ...process.env, PLANET_IMAGE_PATH: image, PLANET_BITMAP_PATH: join(directory, 'windows-current.bmp') },
  });
  if (!JSON.parse(stdout.replace(/^\uFEFF/, '').trim()).applied) throw new Error('Windows 未确认应用壁纸');
}

export async function publishLockScreen(image, { execute = exec, platform = process.platform } = {}) {
  try {
    if (platform !== 'win32') return { state: 'unavailable', error: '锁屏壁纸同步仅支持 Windows' };
    if (Array.isArray(image)) [image] = image;
    if (typeof image !== 'string' || !image.trim()) return { state: 'unavailable', error: '没有可同步的锁屏图片' };
    const command = await readFile(new URL('./lockscreen.ps1', import.meta.url), 'utf8');
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, timeout: 30_000, maxBuffer: 256_000, encoding: 'utf8',
      env: { ...process.env, PLANET_LOCKSCREEN_IMAGE_PATH: image },
    });
    const result = JSON.parse(String(stdout).replace(/^\uFEFF/, '').trim());
    if (result?.applied !== true || result?.verified !== true || typeof result.path !== 'string' || !result.path ||
        win32.resolve(result.path).toLowerCase() !== win32.resolve(image).toLowerCase()) {
      return { state: 'unavailable', error: result?.error || 'Windows 未确认锁屏图片已同步' };
    }
    return { state: 'applied', path: result.path };
  } catch (error) {
    return { state: 'unavailable', error: error.message || String(error) };
  }
}
