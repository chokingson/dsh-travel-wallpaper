import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

function localOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('只允许连接本机 HTTP 服务'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new Error('只允许连接本机 HTTP 服务');
  }
  return url.origin;
}

const validPromptId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value);
const failure = (code, message, remote) => Object.assign(new Error(message), { code, ...(remote && { remote: { ...remote } }) });
const canceled = remote => Object.assign(failure('ABORT_ERR', 'ComfyUI 操作已取消', remote), { name: 'AbortError' });

/**
 * Resume an accepted ComfyUI job using a durable checkpoint supplied by the caller.
 * REMOTE_PENDING preserves the job id; SUBMISSION_UNCERTAIN must not be reposted.
 * A checkpoint marked failed may be supplied to an explicitly authorized retry.
 */
export async function renderComfy(prompt, config, options = {}) {
  const { fetchImpl = fetch, delay = wait, timeoutMs = 300_000, pollMs = 1000, signal: callerSignal, resume, checkpoint = async () => {} } = options;
  if (callerSignal?.aborted) throw canceled();
  const origin = localOrigin(config.comfy);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647 || !Number.isFinite(pollMs) || pollMs < 0) {
    throw new Error('ComfyUI 超时和查询间隔无效');
  }
  const graph = JSON.parse(await readFile(new URL('./moss-workflow.json', import.meta.url), 'utf8'));
  graph['25'].inputs.text = prompt;
  // Hash before choosing a random seed: polling an existing job must have a stable key.
  const requestKey = createHash('sha256').update(JSON.stringify({ workflow: graph, width: config.width || 1920, height: config.height || 1080 })).digest('hex');
  const matches = resume?.kind === 'comfy' && resume.origin === origin && resume.requestKey === requestKey;
  let remote = { kind: 'comfy', origin, requestKey, state: 'submitting' };
  if (matches && resume.state !== 'failed') {
    if (!validPromptId(resume.promptId)) throw failure('SUBMISSION_UNCERTAIN', 'ComfyUI 先前提交结果未知，请先检查原任务，未重复提交', remote);
    remote = { ...remote, promptId: resume.promptId, state: 'queued' };
  }
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  const checkCanceled = () => { if (callerSignal?.aborted) throw canceled(remote); };
  const checkWaiting = () => {
    checkCanceled();
    if (signal.aborted) throw failure('REMOTE_PENDING', 'ComfyUI 原任务仍待查询，稍后继续，不重复提交', remote);
  };
  const persist = async () => {
    try { await checkpoint({ ...remote }); }
    catch {
      throw failure(remote.promptId ? 'SUBMISSION_UNCERTAIN' : 'CHECKPOINT_FAILED', 'ComfyUI 任务状态未能保存，请先检查任务记录', remote);
    }
  };
  const failed = async message => {
    remote = { ...remote, state: 'failed' };
    await persist();
    throw failure('REMOTE_FAILED', message, remote);
  };

  if (!remote.promptId) {
    checkCanceled();
    // A crash after sending POST but before saving its reply must never silently repost.
    await persist();
    checkCanceled();
    graph['16'].inputs.seed = randomBytes(6).readUIntBE(0, 6);
    let response, payload;
    try {
      response = await fetchImpl(origin + '/prompt', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph }), signal, redirect: 'error',
      });
      if (response.ok) payload = await response.json();
    } catch {
      checkCanceled();
      throw failure('SUBMISSION_UNCERTAIN', 'ComfyUI 提交结果未知，请先检查原任务，未重复提交', remote);
    }
    if (!response.ok) await failed(`ComfyUI 提交失败（HTTP ${response.status}）`);
    if (!validPromptId(payload?.prompt_id)) {
      checkCanceled();
      throw failure('SUBMISSION_UNCERTAIN', 'ComfyUI 未返回可恢复的任务 ID，请先检查原任务，未重复提交', remote);
    }
    remote = { ...remote, promptId: payload.prompt_id, state: 'queued' };
    // Save acceptance even if cancellation arrived while POST was in flight.
    await persist();
  }

  for (;;) {
    checkWaiting();
    let result;
    try {
      const response = await fetchImpl(origin + '/history/' + encodeURIComponent(remote.promptId), { signal, redirect: 'error' });
      if (!response.ok) throw Error('history unavailable');
      result = (await response.json())?.[remote.promptId];
    } catch {
      checkCanceled();
      throw failure('REMOTE_PENDING', 'ComfyUI 原任务查询暂未完成，稍后继续，不重复提交', remote);
    }
    checkWaiting();
    const messages = Array.isArray(result?.status?.messages) ? result.status.messages : [];
    if (result?.status?.status_str === 'error' || messages.some(message => ['execution_error', 'execution_interrupted'].includes(message?.[0]))) {
      await failed('ComfyUI 原任务执行失败');
    }
    const image = result?.outputs?.['13']?.images?.[0];
    if (image && typeof image.filename === 'string' && image.filename) {
      let bytes;
      try {
        const params = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder || '', type: image.type || 'output' });
        const response = await fetchImpl(`${origin}/view?${params}`, { signal, redirect: 'error' });
        if (!response.ok) throw Error('image unavailable');
        bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('invalid PNG');
      } catch {
        checkCanceled();
        throw failure('REMOTE_PENDING', 'ComfyUI 成图尚未下载成功，稍后继续下载原图，不重复提交', remote);
      }
      checkWaiting();
      remote = { ...remote, state: 'completed' };
      await persist();
      checkCanceled();
      return bytes;
    }
    if (result?.status?.completed) await failed('ComfyUI 原任务已结束但没有产出图片');
    try { await delay(pollMs, undefined, { signal }); }
    catch {
      checkCanceled();
      throw failure('REMOTE_PENDING', 'ComfyUI 原任务仍待查询，稍后继续，不重复提交', remote);
    }
  }
}
