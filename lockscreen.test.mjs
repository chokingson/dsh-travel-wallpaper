import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { publishLockScreen } from './desktop.js';

const image = 'C:\\旅行壁纸\\夜色 $星球\'s.png';
const confirmation = (path = image, extra = {}) => ({ stdout: JSON.stringify({ applied: true, verified: true, path, ...extra }) });

test('lock screen publisher uses inline PowerShell and safely passes Unicode image path in environment', async () => {
  let execution;
  const result = await publishLockScreen(image, { platform: 'win32', execute: async (...args) => { execution = args; return confirmation(); } });
  assert.deepEqual(result, { state: 'applied', path: image });
  const [program, args, options] = execution;
  assert.equal(program, 'powershell.exe');
  assert.deepEqual(args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-Command']);
  assert.ok(!args.includes('-File'));
  assert.ok(!args[3].includes(image), 'image paths must never be interpolated into shell code');
  assert.equal(options.env.PLANET_LOCKSCREEN_IMAGE_PATH, image);
  assert.equal(options.windowsHide, true);
  assert.equal(options.encoding, 'utf8');
});

test('lock screen uses only the first image in a WallpaperEngine slideshow', async () => {
  let calls = 0;
  const result = await publishLockScreen([image, 'C:\\other.png'], { platform: 'win32', execute: async (_program, _args, options) => { calls++; return confirmation(options.env.PLANET_LOCKSCREEN_IMAGE_PATH); } });
  assert.equal(calls, 1);
  assert.deepEqual(result, { state: 'applied', path: image });
});

test('non-Windows platforms report unavailable without starting a process', async () => {
  let calls = 0;
  const result = await publishLockScreen(image, { platform: 'linux', execute: async () => { calls++; return confirmation(); } });
  assert.equal(result.state, 'unavailable');
  assert.equal(calls, 0);
  assert.ok(result.error);
});

test('unverified, malformed, wrong-path and failed acknowledgments cannot claim applied', async () => {
  for (const response of [
    { stdout: 'not JSON' }, { stdout: '' }, { stdout: 'null' },
    confirmation(image, { verified: false }), confirmation(image, { applied: false, error: 'API unavailable' }),
    confirmation('C:\\different.png'), confirmation(''),
    { stdout: JSON.stringify({ applied: true, path: image }) },
  ]) {
    const result = await publishLockScreen(image, { platform: 'win32', execute: async () => response });
    assert.equal(result.state, 'unavailable', JSON.stringify(response));
    assert.ok(result.error);
  }
});

test('PowerShell failures and empty selections remain nonfatal to desktop publishing', async () => {
  const result = await publishLockScreen(image, { platform: 'win32', execute: async () => { throw Error('Windows policy rejected this call'); } });
  assert.equal(result.state, 'unavailable'); assert.match(result.error, /policy/);
  for (const selected of [[], null, undefined, '', ['']]) {
    let called = false;
    const empty = await publishLockScreen(selected, { platform: 'win32', execute: async () => { called = true; } });
    assert.equal(empty.state, 'unavailable'); assert.equal(called, false);
  }
});

test('verified PowerShell JSON accepts UTF8 BOM and Windows path case differences', async () => {
  const result = await publishLockScreen('C:\\Pictures\\星球.png', { platform: 'win32', execute: async () => ({ stdout: '\uFEFF' + JSON.stringify({ applied: true, verified: true, path: 'c:\\pictures\\星球.png' }) + '\r\n' }) });
  assert.equal(result.state, 'applied');
});

test('Windows PowerShell parses the script and supports its WinRT async adapters without changing the lock screen', { skip: process.platform !== 'win32' }, async () => {
  const command = `
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$tokens = $null; $errors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($env:PLANET_LOCKSCREEN_SCRIPT, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0].Message }
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$storageType = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
$lockScreenType = [Windows.System.UserProfile.LockScreen, Windows.System.UserProfile, ContentType=WindowsRuntime]
$operation = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\x601' } | Select-Object -First 1
$actions = @([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and -not $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.FullName -eq 'Windows.Foundation.IAsyncAction' })
$fileOperation = $storageType::GetFileFromPathAsync($env:PLANET_LOCKSCREEN_PROBE_FILE)
$task = $operation.MakeGenericMethod([Type[]]@($storageType)).Invoke($null, [object[]]@($fileOperation))
$file = $task.GetAwaiter().GetResult()
@{ edition = $PSVersionTable.PSEdition; path = $file.Path; actionAwaiters = $actions.Count; lockScreenType = $lockScreenType.FullName } | ConvertTo-Json -Compress
`;
  const probeFile = fileURLToPath(new URL('./desktop.js', import.meta.url));
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    windowsHide: true, timeout: 15_000, encoding: 'utf8',
    env: { ...process.env, PLANET_LOCKSCREEN_SCRIPT: fileURLToPath(new URL('./lockscreen.ps1', import.meta.url)), PLANET_LOCKSCREEN_PROBE_FILE: probeFile },
  });
  const result = JSON.parse(stdout.trim());
  assert.equal(result.edition, 'Desktop');
  assert.equal(result.path.toLowerCase(), probeFile.toLowerCase());
  assert.equal(result.actionAwaiters, 1);
  assert.equal(result.lockScreenType, 'Windows.System.UserProfile.LockScreen');
});
