// §715 A — one take: what runs off camera, what is recorded, and how a take fails. Every collaborator is
// a fake that records its calls, so no browser runs here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSING, OPENING, TITLE } from './narration/beats.mjs';
import { runTake, takeNarration, waitForAi } from './take.mjs';
import * as ui from './ui.mjs';
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
    ui: {
      caption: async (_c, text) => { calls.push(`caption(${text})`); },
      titleCard: async (_c, title) => { calls.push(`titleCard(${title})`); },
      closingBeat: async () => { calls.push('closingBeat'); },
      holdVoice: async () => {},
    },
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
      'screencast.start', 'titleCard(T)', 'caption(Open)', 'run(a)', 'run(b)', 'closingBeat', 'screencast.stop',
    ]);
  });

  it('a first-run take asks the setup for the first-run walk-through', async () => {
    const h = harness();
    await runTake(def({ prologueOnCamera: true, firstRun: true, prologue: [h.s('wizard')], steps: [h.s('a')] }), h.deps);
    expect(h.calls.slice(0, 5)).toEqual(['screencast.start', 'titleCard(T)', 'caption(Open)', 'connect(onCamera=true,firstRun=true)', 'run(wizard)']);
  });

  it('the prologue is on camera for ch2-connect and big', async () => {
    const h = harness();
    await runTake(def({ prologueOnCamera: true, prologue: [h.s('wizard')], steps: [h.s('a')] }), h.deps);
    expect(h.calls).toEqual([
      'screencast.start', 'titleCard(T)', 'caption(Open)', 'connect(onCamera=true)', 'run(wizard)', 'exploreDemo', 'seedDeviceState(p1)',
      'enableDigest', 'enableChat', 'run(a)', 'closingBeat', 'screencast.stop',
    ]);
  });

  it("the demo opens during the prologue's last voice; the device setup after it is an off-camera cut (§715)", async () => {
    const h = harness();
    h.deps.ui.holdVoice = async () => { h.calls.push('holdVoice'); };
    const r = await runTake(def({ prologueOnCamera: true, prologue: [h.s('cancel')], steps: [h.s('a')] }), h.deps);
    expect(h.calls).toEqual([
      'screencast.start', 'titleCard(T)', 'caption(Open)', 'holdVoice', 'connect(onCamera=true)', 'run(cancel)', 'exploreDemo', 'holdVoice',
      'seedDeviceState(p1)', 'enableDigest', 'enableChat', 'run(a)', 'holdVoice', 'closingBeat', 'screencast.stop',
    ]);
    expect(r.cuts).toHaveLength(1);
    expect(r.cuts[0].end).toBeGreaterThanOrEqual(r.cuts[0].start);
  });

  it('a recorded take returns where it ended on its timeline; a take with its demo off camera has no cuts (§715)', async () => {
    const h = harness();
    const r = await runTake(def({ steps: [h.s('a')] }), h.deps);
    expect(typeof r.endAt).toBe('number');
    expect(r.endAt).toBeGreaterThanOrEqual(0);
    expect(r.cuts).toEqual([]);
  });

  it('an opening that only repeats the title is not shown twice (the chapters)', async () => {
    const h = harness();
    await runTake(def({ opening: 'T', steps: [h.s('a')] }), h.deps);
    expect(h.calls.filter((c) => c.startsWith('caption(') || c.startsWith('titleCard('))).toEqual(['titleCard(T)']);
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

describe('runTake with narration (§715)', () => {
  let clock;
  beforeEach(() => {
    clock = 5000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });
  afterEach(() => vi.restoreAllMocks());

  /** The real ui on a fake page whose waits advance the clock; `beats` maps an id to its duration (s). */
  function narrated({ beats, own = Object.keys(beats), rehearse = false } = {}) {
    const h = harness();
    Object.assign(h.deps.ctx.page, {
      evaluate: async () => {},
      waitForTimeout: async (ms) => { clock += ms; },
    });
    h.deps.ctx.rehearse = rehearse;
    h.deps.ctx.narration = new Map(Object.entries(beats).map(([id, d]) => [id, { text: `say ${id}`, duration: rehearse ? null : d }]));
    h.deps.ui = ui;
    h.deps.opts = { ...h.deps.opts, rehearse, ownBeatIds: own };
    return h;
  }
  const says = (id, beat) => step(id, { run: async (c) => { await ui.caption(c, `text of ${beat}`, beat); clock += 100; } });

  it('a recorded take returns its beats in caption order, with increasing times', async () => {
    const h = narrated({ beats: { [TITLE]: 1.0, [OPENING]: 1.5, 'mon-a': 2.0, 'mon-b': 0.5, [CLOSING]: 1.0 } });
    const r = await runTake(def({ steps: [says('a', 'mon-a'), says('b', 'mon-b')] }), h.deps);
    expect(r.status).toBe('ok');
    expect(r.beats.map((b) => b.id)).toEqual([TITLE, OPENING, 'mon-a', 'mon-b', CLOSING]);
    const at = r.beats.map((b) => b.at);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThan(at[i - 1]);
    expect(r.unusedBeats).toEqual([]);
    expect(r.warnings).toBe(0);
  });

  it('returns its captions, and ends 1.9 s after the closing voice (the pause and the hold) (§715)', async () => {
    const h = narrated({ beats: { 'mon-a': 2.0, [CLOSING]: 1.0 } });
    const r = await runTake(def({ opening: 'T', steps: [says('a', 'mon-a')] }), h.deps);
    const closing = r.beats.at(-1);
    expect(closing.id).toBe(CLOSING);
    expect(r.endAt).toBeCloseTo(closing.at + closing.duration + 0.4 + 1.5, 3);
    expect(r.captions.map((c) => c.id)).toEqual(['mon-a', CLOSING]);
  });

  // I1: a beat's voice never runs on into the next view. A step that navigates before its first caption
  // starts only once the previous step's voice and its pause are over.
  it("a step that navigates first starts only after the previous step's voice (I1)", async () => {
    const h = narrated({ beats: { 'mon-a': 2.0, 'mon-b': 0.5 } });
    let freeAt;
    let bStart;
    const a = step('a', { run: async (c) => { await ui.caption(c, 'text of mon-a', 'mon-a'); freeAt = c.voiceFreeAt; } });
    const b = step('b', { run: async (c) => { bStart = clock; await ui.caption(c, 'text of mon-b', 'mon-b'); } });
    const r = await runTake(def({ opening: 'T', steps: [a, b] }), h.deps);
    expect(r.status).toBe('ok');
    expect(freeAt).toBeGreaterThan(5000 + 2000);
    expect(bStart).toBeGreaterThanOrEqual(freeAt);
  });

  it("an AI step's after still runs over its voice; the next step waits for the voice once it is done", async () => {
    const h = narrated({ beats: { 'mon-a': 2.0 } });
    let freeAt;
    let afterAt;
    let bStart;
    const a = step('ai-a', {
      ai: true,
      run: async (c) => { await ui.caption(c, 'text of mon-a', 'mon-a'); freeAt = c.voiceFreeAt; },
      check: async () => null,
      after: async () => { afterAt = clock; },
    });
    const b = step('b', { run: async () => { bStart = clock; } });
    await runTake(def({ opening: 'T', steps: [a, b] }), h.deps);
    expect(afterAt).toBeLessThan(freeAt);
    expect(bStart).toBeGreaterThanOrEqual(freeAt);
  });

  it("the first step starts only after the opening's voice", async () => {
    const h = narrated({ beats: { [OPENING]: 1.5 }, own: [] });
    let freeAt;
    let aStart;
    const a = step('a', { run: async (c) => { aStart = clock; freeAt = c.voiceFreeAt; } });
    await runTake(def({ steps: [a] }), h.deps);
    expect(freeAt).toBeGreaterThan(5000 + 1500);
    expect(aStart).toBeGreaterThanOrEqual(freeAt);
  });

  it('a rehearsal (no audio) adds no wait between steps', async () => {
    const h = narrated({ beats: { 'mon-a': 2.0 }, rehearse: true });
    let aEnd;
    let bStart;
    const a = step('a', { run: async (c) => { await ui.caption(c, 'text of mon-a', 'mon-a'); aEnd = clock; } });
    const b = step('b', { run: async () => { bStart = clock; } });
    const r = await runTake(def({ opening: 'T', steps: [a, b] }), h.deps);
    expect(r.status).toBe('ok');
    expect(bStart).toBe(aEnd);
  });

  it("an unused beat of the video's own file fails a recorded take, and is listed as a warning", async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-a': 1, 'mon-spare': 1 } });
    const r = await runTake(def({ steps: [says('a', 'mon-a')] }), h.deps);
    expect(r.status).toBe('failed');
    expect(r.error).toBe('narration beats never shown: mon-spare');
    expect(r.unusedBeats).toEqual(['mon-spare']);
    expect(r.warnings).toBe(1);
    expect(h.lines).toContain('NARRATION unused mon-spare');
  });

  it("in a rehearsal, an unused beat of the video's own file is a warning only", async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-a': 1, 'mon-spare': 1 }, rehearse: true });
    const r = await runTake(def({ steps: [says('a', 'mon-a')] }), h.deps);
    expect(r.status).toBe('ok');
    expect(r.error).toBeUndefined();
    expect(r.unusedBeats).toEqual(['mon-spare']);
    expect(r.warnings).toBe(1);
    expect(h.lines).toContain('NARRATION unused mon-spare');
  });

  it("big: a chapter beat it never shows is not unused, only big's own ids count", async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-a': 1, 'first-gdpr': 1 }, own: [OPENING] });
    const r = await runTake(def({ id: 'big', steps: [says('a', 'mon-a')] }), h.deps);
    expect(r.unusedBeats).toEqual([]);
    expect(r.warnings).toBe(0);
  });

  it('a step that declares a beat it may not show exempts exactly that beat', async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-a': 1, 'mon-alt': 1, 'mon-spare': 1 } });
    const maybe = step('a', { mayNotShow: ['mon-alt'], run: async (c) => { await ui.caption(c, 'x', 'mon-a'); clock += 100; } });
    const r = await runTake(def({ steps: [maybe] }), h.deps);
    expect(r.status).toBe('failed');
    expect(r.unusedBeats).toEqual(['mon-spare']);
    expect(r.warnings).toBe(1);
    expect(h.lines).not.toContain('NARRATION unused mon-alt');
  });

  it('a take whose declared beats are all unshown is ok', async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-a': 1, 'mon-alt': 1 } });
    const maybe = step('a', { mayNotShow: ['mon-alt'], run: async (c) => { await ui.caption(c, 'x', 'mon-a'); clock += 100; } });
    const r = await runTake(def({ steps: [maybe] }), h.deps);
    expect(r).toMatchObject({ status: 'ok', unusedBeats: [], warnings: 0 });
  });

  it("a step that is not in the video exempts nothing", async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-a': 1, 'mon-alt': 1 } });
    const other = step('other', { mayNotShow: ['mon-alt'] });
    expect(other.mayNotShow).toEqual(['mon-alt']);
    const r = await runTake(def({ steps: [says('a', 'mon-a')] }), h.deps);
    expect(r).toMatchObject({ status: 'failed', unusedBeats: ['mon-alt'] });
  });

  const aiSays = (id) => step(id, { ai: true, run: async (c) => { await ui.caption(c, 'x', 'mon-ai'); }, trigger: () => ({ isEnabled: async () => true }) });

  it('a rehearsal without --with-ai exempts the beats of the AI steps it skipped, and no others', async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-a': 1, 'mon-ai': 1, 'mon-spare': 1 }, rehearse: true });
    const r = await runTake(def({ steps: [says('a', 'mon-a'), aiSays('ai')] }), h.deps);
    expect(r.unusedBeats).toEqual(['mon-spare']);
    expect(h.lines).not.toContain('NARRATION unused mon-ai');
  });

  it('an AI step declaring its beats exempts them when skipped', async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-dyn': 1 }, rehearse: true });
    const dyn = (b) => step('ai', { ai: true, beats: [b], run: async (c) => { await ui.caption(c, 'x', b); }, trigger: () => ({ isEnabled: async () => true }) });
    const r = await runTake(def({ steps: [dyn('mon-dyn')] }), h.deps);
    expect(r.unusedBeats).toEqual([]);
  });

  it('a wrapped AI step (atView) exempts its beats of its inner step when skipped', async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-ai': 1 }, rehearse: true });
    const inner = aiSays('ai');
    const wrapped = step(inner.id, { ...inner, inner, run: async (c) => { await inner.run(c); } });
    const r = await runTake(def({ steps: [wrapped] }), h.deps);
    expect(r.unusedBeats).toEqual([]);
  });

  it('a --with-ai rehearsal still warns on an AI step beat that never showed', async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-ai': 1 }, rehearse: true });
    h.deps.opts.withAi = true;
    const r = await runTake(def({ steps: [step('ai', { ai: true, run: async () => { void 'mon-ai'; } })] }), h.deps);
    expect(r.unusedBeats).toEqual(['mon-ai']);
  });

  it('a recorded take still fails on an AI step beat that never showed', async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-ai': 1 } });
    const r = await runTake(def({ steps: [step('ai', { ai: true, run: async () => { void 'mon-ai'; } })] }), h.deps);
    expect(r).toMatchObject({ status: 'failed', unusedBeats: ['mon-ai'] });
  });

  it("the setup's own optional captions are exempt when it ran on camera", async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-a': 1, 'setup-review': 1 } });
    h.deps.setup.MAY_NOT_SHOW = ['setup-review'];
    const r = await runTake(def({ prologueOnCamera: true, firstRun: true, steps: [says('a', 'mon-a')] }), h.deps);
    expect(r).toMatchObject({ status: 'ok', unusedBeats: [] });
    const h3 = narrated({ beats: { [OPENING]: 1, 'mon-a': 1, 'setup-review': 1 } });
    h3.deps.setup.MAY_NOT_SHOW = ['setup-review'];
    const r3 = await runTake(def({ prologueOnCamera: true, steps: [says('a', 'mon-a')] }), h3.deps);
    expect(r3.unusedBeats).toEqual(['setup-review']);
    const h2 = narrated({ beats: { [OPENING]: 1, 'mon-a': 1, 'setup-review': 1 } });
    h2.deps.setup.MAY_NOT_SHOW = ['setup-review'];
    const r2 = await runTake(def({ steps: [says('a', 'mon-a')] }), h2.deps);
    expect(r2.unusedBeats).toEqual(['setup-review']);
  });

  it('a rehearsal returns no beats, and a missing beat is a warning', async () => {
    const h = narrated({ beats: { [OPENING]: 1, 'mon-a': 1 }, rehearse: true });
    const r = await runTake(def({ steps: [says('a', 'mon-a'), says('b', 'mon-missing')] }), h.deps);
    expect(r.status).toBe('ok');
    expect(r.beats).toBeUndefined();
    expect(r.unusedBeats).toEqual([]);
    expect(r.warnings).toBe(1);
    expect(h.lines).toContain('NARRATION missing mon-missing');
  });

  it('a recorded take fails on a caption id with no beat', async () => {
    const h = narrated({ beats: { [OPENING]: 1 } });
    const r = await runTake(def({ steps: [says('b', 'mon-missing')] }), h.deps);
    expect(r).toMatchObject({ status: 'failed', error: 'no narration for beat mon-missing' });
  });

  it('a video without narration keeps its result as today', async () => {
    const h = harness();
    const r = await runTake(def({ steps: [h.s('a')] }), h.deps);
    expect(r.beats).toBeUndefined();
    expect(r.unusedBeats).toBeUndefined();
  });
});

describe('takeNarration (§715)', () => {
  const beats = new Map([['opening', 'Hello.'], ['mon-a', 'A.']]);
  const audio = (text) => (text === 'Hello.' ? { file: 'x.mp3', duration: 1.2 } : null);

  it('a recorded take needs audio for every beat', () => {
    expect(() => takeNarration({ id: 'ch3-monday' }, beats, { rehearse: false, audio }))
      .toThrow('no audio for beat mon-a — run narrate.mjs --video ch3-monday');
  });

  it('a recorded take carries each duration', () => {
    const all = () => ({ file: 'x.mp3', duration: 2 });
    expect(takeNarration({ id: 'x' }, beats, { rehearse: false, audio: all }).get('mon-a')).toEqual({ text: 'A.', duration: 2 });
  });

  it('a rehearsal needs no audio: durations are null', () => {
    const n = takeNarration({ id: 'x' }, beats, { rehearse: true, audio: () => { throw new Error('no audio in a rehearsal'); } });
    expect([...n]).toEqual([['opening', { text: 'Hello.', duration: null }], ['mon-a', { text: 'A.', duration: null }]]);
  });

  it('a video without beats has no narration', () => {
    expect(takeNarration({ id: 'x' }, new Map(), { rehearse: false, audio })).toBeNull();
  });
});
