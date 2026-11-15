import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderComfy } from './comfy-render.js';

const png = Buffer.from('89504e470d0a1a0a00000000', 'hex');
const config = { comfy: 'http://127.0.0.1:8188', width: 1920, height: 1080 };
const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const complete = id => ({ [id]: { outputs: { '13': { images: [{ filename: 'picture.png', subfolder: 'PlanetNews', type: 'output' }] } }, status: { completed: true } } });
const timeout = () => { throw Object.assign(new Error('fake timeout'), { name: 'TimeoutError' }); };

function fixture(handler) {
  const calls = [], checkpoints = [];
  return {
    calls, checkpoints,
    options: {
      fetchImpl: async (url, init = {}) => {
        const parsed = new URL(url), call = { path: parsed.pathname, query: parsed.searchParams, ...init };
        calls.push(call);
        return handler(call, checkpoints);
      },
      checkpoint: async state => { checkpoints.push(structuredClone(state)); },
      delay: async () => {},
    },
  };
}

test('a queued task resumes across invocations without submitting another image', async () => {
  let ready = false;
  const f = fixture((call, checkpoints) => {
    if (call.path === '/prompt') return json({ prompt_id: 'job-original' });
    if (call.path.startsWith('/history/')) {
      assert.equal(checkpoints.at(-1).promptId, 'job-original', 'accepted id is persisted before polling');
      return json(ready ? complete('job-original') : {});
    }
    if (call.path === '/view') return new Response(png);
    throw Error('unexpected fake route');
  });
  let pending;
  await assert.rejects(renderComfy('same scene', config, { ...f.options, delay: timeout }), error => {
    pending = error.remote;
    return error.code === 'REMOTE_PENDING' && pending.promptId === 'job-original';
  });
  ready = true;
  assert.deepEqual(await renderComfy('same scene', config, { ...f.options, resume: pending }), png);
  assert.equal(f.calls.filter(call => call.path === '/prompt').length, 1);
  assert.equal(f.checkpoints.at(-1).state, 'completed');
  assert.equal(f.calls.at(-1).query.get('subfolder'), 'PlanetNews');
  assert.ok(f.calls.every(call => call.redirect === 'error'));
});

for (const phase of ['history', 'download']) {
  test(`${phase} transport failure retains the accepted task for a later invocation`, async () => {
    let fail = true;
    const f = fixture(call => {
      if (call.path === '/prompt') return json({ prompt_id: 'job-retry' });
      if (call.path.startsWith('/history/')) {
        if (phase === 'history' && fail) throw Error('secret in transport error');
        return json(complete('job-retry'));
      }
      if (call.path === '/view') {
        if (phase === 'download' && fail) throw Error('secret in transport error');
        return new Response(png);
      }
      throw Error('unexpected fake route');
    });
    let remote;
    await assert.rejects(renderComfy('scene', config, f.options), error => {
      remote = error.remote;
      return error.code === 'REMOTE_PENDING' && remote.promptId === 'job-retry' && !error.message.includes('secret');
    });
    fail = false;
    assert.deepEqual(await renderComfy('scene', config, { ...f.options, resume: remote }), png);
    assert.equal(f.calls.filter(call => call.path === '/prompt').length, 1);
  });
}

test('request changes and a different local origin never reuse a stale task', async () => {
  let submitted = 0;
  const f = fixture(call => {
    if (call.path === '/prompt') return json({ prompt_id: `job-${++submitted}` });
    if (call.path.startsWith('/history/')) return json(complete(call.path.split('/').at(-1)));
    return new Response(png);
  });
  await renderComfy('first scene', config, f.options);
  const first = f.checkpoints.at(-1);
  await renderComfy('different scene', config, { ...f.options, resume: first });
  await renderComfy('first scene', { ...config, width: 1080, height: 1920 }, { ...f.options, resume: first });
  await renderComfy('first scene', { ...config, comfy: 'http://localhost:8188' }, { ...f.options, resume: first });
  assert.equal(submitted, 4);
});

test('an explicit remote failure is checkpointed and a later retry may submit a fresh task', async () => {
  let fail = true, submitted = 0;
  const f = fixture(call => {
    if (call.path === '/prompt') return json({ prompt_id: `job-${++submitted}` });
    if (call.path.startsWith('/history/')) {
      const id = call.path.split('/').at(-1);
      return json(fail ? { [id]: { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'secret remote diagnostic' }]] } } } : complete(id));
    }
    return new Response(png);
  });
  await assert.rejects(renderComfy('scene', config, f.options), error => error.code === 'REMOTE_FAILED' && !error.message.includes('secret'));
  const failed = f.checkpoints.at(-1);
  assert.equal(failed.state, 'failed');
  fail = false;
  assert.deepEqual(await renderComfy('scene', config, { ...f.options, resume: failed }), png);
  assert.equal(submitted, 2);
});

test('failure to persist an accepted id is uncertain and does not start polling', async () => {
  const f = fixture(call => {
    assert.equal(call.path, '/prompt');
    return json({ prompt_id: 'accepted-job' });
  });
  await assert.rejects(renderComfy('scene', config, { ...f.options, checkpoint: async state => {
    if (state.promptId) throw Error('disk full with secret');
  } }), error => error.code === 'SUBMISSION_UNCERTAIN' && error.remote.promptId === 'accepted-job' && !error.message.includes('secret'));
  assert.equal(f.calls.length, 1);
});

test('a submission transport failure cannot be automatically reposted from its checkpoint', async () => {
  const f = fixture(() => { throw Error('connection dropped after acceptance'); });
  await assert.rejects(renderComfy('scene', config, f.options), error => error.code === 'SUBMISSION_UNCERTAIN');
  const resume = f.checkpoints.at(-1);
  assert.equal(resume.state, 'submitting');
  await assert.rejects(renderComfy('scene', config, { ...f.options, resume }), error => error.code === 'SUBMISSION_UNCERTAIN');
  assert.equal(f.calls.length, 1);
});

test('external, credential-bearing and non-HTTP origins are rejected before any request', async () => {
  for (const comfy of ['https://127.0.0.1:8188', 'http://example.org:8188', 'http://127.0.0.1.example.org', 'http://user:secret@localhost:8188', 'file:///tmp/comfy']) {
    let calls = 0;
    await assert.rejects(renderComfy('scene', { ...config, comfy }, { fetchImpl: async () => { calls++; throw Error('must not fetch'); }, delay: async () => {} }), /本机 HTTP/);
    assert.equal(calls, 0);
  }
});

test('cancellation before submission performs no requests', async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture(() => { throw Error('must not fetch'); });
  await assert.rejects(renderComfy('scene', config, { ...f.options, signal: controller.signal }), error => error.name === 'AbortError' && error.code === 'ABORT_ERR');
  assert.equal(f.calls.length, 0);
  assert.equal(f.checkpoints.length, 0);
});

test('cancellation while queued retains the accepted id and stops further polling', async () => {
  const controller = new AbortController();
  const f = fixture(call => call.path === '/prompt' ? json({ prompt_id: 'canceled-job' }) : json({}));
  await assert.rejects(renderComfy('scene', config, { ...f.options, signal: controller.signal, delay: async () => { controller.abort(); } }), error => error.code === 'ABORT_ERR' && error.remote.promptId === 'canceled-job');
  assert.equal(f.calls.length, 2);
  assert.equal(f.checkpoints.at(-1).promptId, 'canceled-job');
});

test('a checkpoint failure while recording a terminal remote error remains uncertain', async () => {
  const f = fixture(call => call.path === '/prompt' ? json({ prompt_id: 'failed-job' }) : json({ 'failed-job': { status: { status_str: 'error' } } }));
  await assert.rejects(renderComfy('scene', config, { ...f.options, checkpoint: async state => {
    if (state.state === 'failed') throw Error('disk full');
  } }), error => error.code === 'SUBMISSION_UNCERTAIN' && error.remote.promptId === 'failed-job');
});

test('cancellation while submitting still persists the accepted id before stopping', async () => {
  const controller = new AbortController();
  const f = fixture(call => {
    assert.equal(call.path, '/prompt');
    controller.abort();
    return json({ prompt_id: 'late-acceptance' });
  });
  await assert.rejects(renderComfy('scene', config, { ...f.options, signal: controller.signal }), error => error.code === 'ABORT_ERR' && error.remote.promptId === 'late-acceptance');
  assert.equal(f.calls.length, 1);
  assert.equal(f.checkpoints.at(-1).promptId, 'late-acceptance');
});

test('malformed status diagnostics do not lose a known queued task', async () => {
  const f = fixture(call => call.path === '/prompt' ? json({ prompt_id: 'queued-job' }) : json({ 'queued-job': { status: { messages: { some: 'not an array' } } } }));
  await assert.rejects(renderComfy('scene', config, { ...f.options, delay: timeout }), error => error.code === 'REMOTE_PENDING' && error.remote.promptId === 'queued-job');
});
