// §715 A — one take: what runs off camera, what is recorded, and how a take fails. Every collaborator is
// a fake that records its calls, so no browser runs here.
import { describe, expect, it } from 'vitest';
import { runTake, waitForAi } from './take.mjs';
import { step } from './steps/step.mjs';

function harness({ preconditionsOk = true, checks = [], days } = {}) {
  const calls = [];
  const lines = [];
  // A collaborator's first argument is the ctx; the rest are rendered: `name`, `name(p1)`, `name(onCamera=true)`.
  const rec = (name) => async (_ctx, ...args) => {
    const shown = args.map((a) => (a && typeof a === 'object' ? Object.entries(a).map(([k, v]) => `${k}=${v}`).join(',') : String(a)));
    calls.push(shown.length ? `${name}(${shown.join(',')})` : name);
  };
  const page = { screencast: { start: async () => { calls.push('screencast.start'); }, stop: async () => { calls.push('screencast.stop'); } } };
  const ctx = { page, clipId: 'x', log: (l) => lines.push(l), lines };
  const deps = {
    ctx,
    setup: {
      connect: rec('connect'), exploreDemo: rec('exploreDemo'), seedDeviceState: rec('seedDeviceState'),
      enableDigest: rec('enableDigest'), enableChat: rec('enableChat'), goToDay: rec('goToDay'), currentProjectId: async () => 'p1',
    },
    ui: { caption: async (_c, text) => { calls.push(`caption(${text})`); }, closingBeat: async (_c, title) => { calls.push(`closingBeat(${title})`); } },
    resolveOpening: async (_c, o) => o,
    days: days ?? {},
    opts: { rehearse: false, withAi: false, outFile: 'o.webm', secrets: ['SECRET-TOKEN'] },
  };
  const s = (id, extra = {}) => step(id, { run: async () => { calls.push(`run(${id})`); }, ...extra });
  const pre = { what: 'two near-duplicate tasks', check: async () => { calls.push('precondition'); return preconditionsOk; } };
  let n = 0;
  const aiStep = step('ai1', { ai: true, run: async () => { calls.push('run(ai1)'); }, check: async () => checks[n++] ?? null, trigger: () => ({ isEnabled: async () => { calls.push('trigger(ai1)'); return true; } }) });
  return { calls, lines, deps, s, pre, aiStep };
}

const def = (extra) => ({ id: 'x', tier: 'features', title: 'T', opening: 'Open', preconditions: [], steps: [], ...extra });

describe('runTake (§715)', () => {
  it('order: setup, preconditions, then recording', async () => {
    const h = harness();
    const r = await runTake(def({ preconditions: [h.pre], steps: [h.s('a'), h.s('b')] }), h.deps);
    expect(r.status).toBe('ok');
    expect(h.calls).toEqual([
      'connect(onCamera=false)', 'exploreDemo', 'seedDeviceState(p1)', 'enableDigest', 'enableChat', 'precondition',
      'screencast.start', 'caption(Open)', 'run(a)', 'run(b)', 'closingBeat(T)', 'screencast.stop',
    ]);
  });

  it('the prologue is on camera for ch2-connect and big', async () => {
    const h = harness();
    await runTake(def({ prologueOnCamera: true, prologue: [h.s('wizard')], steps: [h.s('a')] }), h.deps);
    expect(h.calls).toEqual([
      'screencast.start', 'caption(Open)', 'connect(onCamera=true)', 'run(wizard)', 'exploreDemo', 'seedDeviceState(p1)',
      'enableDigest', 'enableChat', 'run(a)', 'closingBeat(T)', 'screencast.stop',
    ]);
  });

  it('a failed precondition skips the take before recording', async () => {
    const h = harness({ preconditionsOk: false });
    const r = await runTake(def({ preconditions: [h.pre], steps: [h.s('a')] }), h.deps);
    expect(r).toMatchObject({ status: 'skipped', missing: ['two near-duplicate tasks'] });
    expect(h.calls).not.toContain('screencast.start');
    expect(h.calls).not.toContain('run(a)');
  });

  it('rehearse never starts the screencast', async () => {
    const h = harness();
    h.deps.opts.rehearse = true;
    await runTake(def({ steps: [h.s('a')] }), h.deps);
    expect(h.calls).not.toContain('screencast.start');
    expect(h.calls).not.toContain('screencast.stop');
    expect(h.calls).toContain('run(a)');
  });

  it('rehearse without --with-ai runs no AI step and checks its trigger is enabled instead', async () => {
    const h = harness();
    h.deps.opts.rehearse = true;
    await runTake(def({ steps: [h.aiStep] }), h.deps);
    expect(h.calls).toContain('trigger(ai1)');
    expect(h.calls).not.toContain('run(ai1)');
  });

  it('chapters replay before recording', async () => {
    const monCalls = [];
    const days = {
      mon: [step('m1', { run: async () => monCalls.push('run(m1)') }), step('m2', { ai: true, replay: async () => monCalls.push('replay(m2)') })],
      tue: [step('t1', { run: async () => monCalls.push('run(t1)') })],
    };
    const h = harness({ days });
    const r = await runTake(def({ replayThrough: 'tue', clock: 'wed', steps: [h.s('w1')] }), h.deps);
    expect(r.status).toBe('ok');
    expect(monCalls).toEqual(['run(m1)', 'replay(m2)', 'run(t1)']);
    const start = h.calls.indexOf('screencast.start');
    expect(h.calls.slice(0, start)).toEqual([
      'connect(onCamera=false)', 'exploreDemo', 'seedDeviceState(p1)', 'enableDigest', 'enableChat',
      'goToDay(mon)', 'goToDay(tue)', 'goToDay(wed)',
    ]);
  });

  it('setup steps run before the preconditions and are never recorded', async () => {
    const h = harness();
    await runTake(def({ preconditions: [h.pre], steps: [h.s('prep', { setup: true }), h.s('a')] }), h.deps);
    expect(h.calls.indexOf('run(prep)')).toBeLessThan(h.calls.indexOf('precondition'));
    expect(h.calls.indexOf('run(prep)')).toBeLessThan(h.calls.indexOf('screencast.start'));
  });

  it("a secret in the take's log is a warning", async () => {
    const h = harness();
    const leaky = step('leak', { run: async (ctx) => ctx.log('oops SECRET-TOKEN') });
    const r = await runTake(def({ steps: [leaky] }), h.deps);
    expect(r.warnings).toBeGreaterThanOrEqual(1);
  });

  it('an empty AI result is retried once, then fails', async () => {
    const h = harness({ checks: ['no pairs', 'no pairs'] });
    const r = await runTake(def({ steps: [h.aiStep] }), h.deps);
    expect(h.calls.filter((c) => c === 'run(ai1)')).toHaveLength(2);
    expect(r.status).toBe('failed');
    expect(h.calls).toContain('screencast.stop');
  });

  it("an AI step's after runs once its result passed the check", async () => {
    const h = harness({ checks: ['no pairs', null] });
    const withAfter = step('ai2', { ai: true, run: async () => { h.calls.push('run(ai2)'); }, check: h.aiStep.check, after: async () => { h.calls.push('after(ai2)'); } });
    await runTake(def({ steps: [withAfter] }), h.deps);
    expect(h.calls.filter((c) => /ai2/.test(c))).toEqual(['run(ai2)', 'run(ai2)', 'after(ai2)']);
  });

  it('an AI result that is fine on the retry passes', async () => {
    const h = harness({ checks: ['no pairs', null] });
    const r = await runTake(def({ steps: [h.aiStep] }), h.deps);
    expect(r.status).toBe('ok');
  });
});

describe('waitForAi (§715)', () => {
  it('times out with the clip id', async () => {
    const never = { waitFor: ({ timeout }) => new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout exceeded')), timeout)) };
    await expect(waitForAi({ clipId: 'ai-dedup' }, { busy: never, done: never, timeoutMs: 50, label: 'dedup' }))
      .rejects.toThrow('ai-dedup: AI step dedup timed out');
  });

  it('resolves once the busy state ends and the result shows', async () => {
    const waits = [];
    const loc = (name) => ({ waitFor: async (o) => { waits.push(`${name}:${o.state}`); } });
    await waitForAi({ clipId: 'c' }, { busy: loc('busy'), done: loc('done'), timeoutMs: 50, label: 'x' });
    expect(waits).toEqual(['busy:hidden', 'done:visible']);
  });
});

describe('runTake notes the AI waits on camera (§715)', () => {
  const ok = { waitFor: async () => {} };
  const waiting = () => step('ai-w', { ai: true, run: async (c) => { await waitForAi(c, { busy: ok, done: ok, label: 'w' }); } });

  it('a recorded take returns each AI wait, timed from the screencast start', async () => {
    const h = harness();
    const r = await runTake(def({ steps: [waiting()] }), h.deps);
    expect(r.status).toBe('ok');
    expect(r.aiWaits).toHaveLength(1);
    expect(r.aiWaits[0].start).toBeGreaterThanOrEqual(0);
  });

  it('a rehearsal with AI notes none', async () => {
    const h = harness();
    h.deps.opts = { ...h.deps.opts, rehearse: true, withAi: true };
    const r = await runTake(def({ steps: [waiting()] }), h.deps);
    expect(r.aiWaits).toBeUndefined();
  });
});
