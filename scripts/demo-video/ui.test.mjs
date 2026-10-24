// §715 on-screen helpers: how a caption paces the take once it has a narration beat, and the guard that
// every caption in the step modules names a beat id. A fake page records its calls; the clock is faked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSING, OPENING, TITLE, parseNarration } from './narration/beats.mjs';
import { PAUSE_MS, caption, closingBeat, holdVoice, speak, titleCard } from './ui.mjs';

let clock;
beforeEach(() => {
  clock = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

/** A ctx whose page records `show(<text>)` and `wait(<ms>)`; waiting advances the clock. `narration` maps an
 *  id to its duration in seconds (null in a rehearsal). `onCamera`: the take has started; a recorded take also
 *  has its recording start. */
function fakeCtx({ narration, rehearse = false, onCamera = true } = {}) {
  const calls = [];
  const lines = [];
  const page = {
    // The caption placement (ui.placeCaption) measures the box: not a caption change, so not recorded.
    evaluate: async (fn, t) => { if (!String(fn).includes('getBoundingClientRect')) calls.push(`show(${t})`); },
    waitForTimeout: async (ms) => { calls.push(`wait(${ms})`); clock += ms; },
  };
  const ctx = { page, rehearse, log: (l) => lines.push(l), lines };
  if (narration) ctx.narration = new Map(Object.entries(narration).map(([id, duration]) => [id, { text: `say ${id}`, duration }]));
  if (onCamera) {
    ctx.onCamera = true;
    if (!rehearse) ctx.recordingStartedAt = clock;
  }
  return { ctx, calls, lines };
}

describe('caption with narration (§715)', () => {
  it('the next beat starts no earlier than the previous audio plus the pause', async () => {
    const { ctx } = fakeCtx({ narration: { 'mon-a': 2.0, 'mon-b': 1.0 } });
    await caption(ctx, 'A', 'mon-a');
    await caption(ctx, 'B', 'mon-b');
    expect(PAUSE_MS).toBe(400);
    expect(ctx.beatLog.map((b) => b.id)).toEqual(['mon-a', 'mon-b']);
    expect(ctx.beatLog[1].at - ctx.beatLog[0].at).toBeGreaterThanOrEqual(2.4);
    expect(ctx.beatLog[0]).toEqual({ id: 'mon-a', at: 0, duration: 2.0 });
  });

  it('returns before the audio ends: the voice plays over the next action', async () => {
    const { ctx, calls } = fakeCtx({ narration: { 'mon-a': 2.0 } });
    await caption(ctx, 'A', 'mon-a');
    expect(calls).toEqual(['show(A)']);
    expect(clock - ctx.recordingStartedAt).toBeLessThan(2000);
    expect(ctx.voiceFreeAt).toBe(1000 + 2000 + PAUSE_MS);
  });

  it("without narration, the calls are today's: show, then 1200 ms", async () => {
    const { ctx, calls } = fakeCtx();
    await caption(ctx, 'A', 'mon-a');
    await caption(ctx, '');
    expect(calls).toEqual(['show(A)', 'wait(1200)', 'show()']);
    expect(ctx.beatLog).toBeUndefined();
  });

  it('a caption id with no beat fails a recorded take', async () => {
    const { ctx } = fakeCtx({ narration: { 'mon-a': 2.0 } });
    await expect(caption(ctx, 'X', 'mon-x')).rejects.toThrow('no narration for beat mon-x');
  });

  it('in a rehearsal, a caption id with no beat is logged and counted, at the token pace', async () => {
    const { ctx, calls, lines } = fakeCtx({ narration: { 'mon-a': null }, rehearse: true });
    await caption(ctx, 'X', 'mon-x');
    await caption(ctx, 'A', 'mon-a');
    expect(lines).toContain('NARRATION missing mon-x');
    expect(ctx.narrationMissing).toBe(1);
    expect(calls).toEqual(['show(X)', 'wait(150)', 'show(A)', 'wait(150)']);
    expect([...ctx.beatsUsed]).toEqual(['mon-a']);
    expect(ctx.beatLog).toBeUndefined();
  });

  it('before the recording starts, a narrated caption neither waits for the voice nor logs a beat', async () => {
    const { ctx, calls, lines } = fakeCtx({ narration: { 'mon-a': 2.0 }, onCamera: false });
    await caption(ctx, 'A', 'mon-a');
    await caption(ctx, 'B', 'mon-not-a-beat');
    expect(calls).toEqual(['show(A)', 'wait(1200)', 'show(B)', 'wait(1200)']);
    expect(ctx.beatLog).toBeUndefined();
    expect(ctx.beatsUsed).toBeUndefined();
    expect(lines.filter((l) => l.startsWith('NARRATION'))).toEqual([]);
  });
});

describe('a beat shown again (§715)', () => {
  it('speaks the first time only: a later show keeps the caption at the token pace and leaves the voice alone', async () => {
    const { ctx, calls } = fakeCtx({ narration: { 'mon-a': 2.0, 'mon-b': 1.0 } });
    await caption(ctx, 'A', 'mon-a');
    const freeAt = ctx.voiceFreeAt;
    await caption(ctx, 'A again', 'mon-a');
    expect(calls).toEqual(['show(A)', `wait(${2000 + PAUSE_MS})`, 'show(A again)', 'wait(150)']);
    expect(ctx.voiceFreeAt).toBe(freeAt);
    expect(ctx.beatLog.map((b) => b.id)).toEqual(['mon-a']);
    // The next new beat still waits for the first voice, not for the repeat.
    await caption(ctx, 'B', 'mon-b');
    expect(ctx.beatLog.map((b) => b.id)).toEqual(['mon-a', 'mon-b']);
    expect(ctx.beatLog[1].at).toBeGreaterThanOrEqual(2.4);
  });

  it('a repeat waits for the voice of the beat shown since, then shows', async () => {
    const { ctx } = fakeCtx({ narration: { 'mon-a': 1.0, 'mon-b': 2.0 } });
    const shownAt = [];
    const evaluate = ctx.page.evaluate;
    ctx.page.evaluate = async (fn, t) => { if (!String(fn).includes('getBoundingClientRect')) shownAt.push([t, clock]); await evaluate(fn, t); };
    await caption(ctx, 'A', 'mon-a');
    await caption(ctx, 'B', 'mon-b');
    const freeAt = ctx.voiceFreeAt;
    await caption(ctx, 'A again', 'mon-a');
    expect(shownAt[2]).toEqual(['A again', freeAt]);
    expect(ctx.voiceFreeAt).toBe(freeAt);
    expect(ctx.beatLog.map((b) => b.id)).toEqual(['mon-a', 'mon-b']);
  });

  it('speak of a beat already spoken does nothing', async () => {
    const { ctx, calls } = fakeCtx({ narration: { 'mon-a': 1.0 } });
    await caption(ctx, 'A', 'mon-a');
    await speak(ctx, 'mon-a');
    expect(calls).toEqual(['show(A)']);
    expect(ctx.beatLog.length).toBe(1);
  });
});

describe('voice-only beats (§715)', () => {
  it('speak keeps the pace and changes no caption', async () => {
    const { ctx, calls } = fakeCtx({ narration: { 'mon-a': 1.0, 'mon-why': 0.5 } });
    await caption(ctx, 'A', 'mon-a');
    await speak(ctx, 'mon-why');
    expect(calls).toEqual(['show(A)', `wait(${1000 + PAUSE_MS})`]);
    expect(ctx.beatLog.map((b) => [b.id, b.at])).toEqual([['mon-a', 0], ['mon-why', 1.4]]);
  });

  it('holdVoice waits for the pending voice and its pause, then returns at once', async () => {
    const { ctx, calls } = fakeCtx({ narration: { 'mon-a': 2.0 } });
    await caption(ctx, 'A', 'mon-a');
    await holdVoice(ctx);
    await holdVoice(ctx);
    expect(calls).toEqual(['show(A)', `wait(${2000 + PAUSE_MS})`]);
    expect(clock).toBe(ctx.voiceFreeAt);
  });

  it('holdVoice holds nothing without a voice: a rehearsal, or before the recording starts', async () => {
    const rehearsal = fakeCtx({ narration: { 'mon-a': null }, rehearse: true });
    await caption(rehearsal.ctx, 'A', 'mon-a');
    await holdVoice(rehearsal.ctx);
    expect(rehearsal.calls).toEqual(['show(A)', 'wait(150)']);
    const off = fakeCtx({ onCamera: false });
    off.ctx.voiceFreeAt = clock + 5000;
    await holdVoice(off.ctx);
    expect(off.calls).toEqual([]);
  });

  it('closingBeat lets the last voice finish before it clears the caption, then holds 1500 ms', async () => {
    const { ctx, calls } = fakeCtx({ narration: { 'mon-a': 2.0 } });
    const shownAt = [];
    const evaluate = ctx.page.evaluate;
    ctx.page.evaluate = async (fn, t) => { if (!String(fn).includes('getBoundingClientRect')) shownAt.push([t, clock]); await evaluate(fn, t); };
    await caption(ctx, 'A', 'mon-a');
    await closingBeat(ctx, CLOSING);
    expect(calls).toEqual(['show(A)', `wait(${2000 + PAUSE_MS})`, 'show()', 'wait(1500)']);
    // The clear comes once the voice and its pause are over, not while "A" is still being spoken.
    expect(shownAt).toEqual([['A', 1000], ['', 1000 + 2000 + PAUSE_MS]]);
  });

  it('closingBeat shows the closing beat as its caption, speaks it, and holds the voice plus 1500 ms', async () => {
    const { ctx, calls } = fakeCtx({ narration: { [CLOSING]: 1.0 } });
    await closingBeat(ctx, CLOSING);
    expect(ctx.beatLog.map((b) => b.id)).toEqual([CLOSING]);
    expect(calls).toEqual([`show(say ${CLOSING})`, `wait(${1000 + PAUSE_MS})`, 'wait(1500)']);
  });

  it('closingBeat keeps the closing caption on screen to the end: shown after the last voice, never cleared', async () => {
    const { ctx, calls } = fakeCtx({ narration: { 'mon-a': 2.0, [CLOSING]: 1.0 } });
    await caption(ctx, 'A', 'mon-a');
    await closingBeat(ctx, CLOSING);
    expect(calls).toEqual(['show(A)', `wait(${2000 + PAUSE_MS})`, `show(say ${CLOSING})`, `wait(${1000 + PAUSE_MS})`, 'wait(1500)']);
    expect(calls.filter((c) => c.startsWith('show(')).at(-1)).toBe(`show(say ${CLOSING})`);
  });

  it('in a rehearsal, closingBeat shows the closing caption at the rehearsal pace', async () => {
    const { ctx, calls } = fakeCtx({ narration: { [CLOSING]: null }, rehearse: true });
    await closingBeat(ctx, CLOSING);
    expect(calls).toEqual([`show(say ${CLOSING})`, 'wait(150)', 'wait(150)']);
  });

  it('a recorded caption is logged on the timeline with its beat id, once per id', async () => {
    const { ctx } = fakeCtx({ narration: { 'mon-a': 1.0 } });
    await caption(ctx, 'A', 'mon-a');
    await caption(ctx, 'A again', 'mon-a');
    await caption(ctx, '');
    expect(ctx.captionLog).toEqual([{ id: 'mon-a', at: 0, text: 'A' }]);
  });

  it('titleCard speaks the title beat after showing the title, and only when there is one', async () => {
    const voiced = fakeCtx({ narration: { [TITLE]: 1.0 } });
    await titleCard(voiced.ctx, 'T', TITLE);
    expect(voiced.ctx.beatLog.map((b) => b.id)).toEqual([TITLE]);
    expect(voiced.calls).toEqual(['show(T)', 'wait(1200)', 'wait(1800)']);
    const silent = fakeCtx({ narration: { 'mon-a': 1.0 } });
    await titleCard(silent.ctx, 'T', TITLE);
    expect(silent.ctx.beatLog).toBeUndefined();
    expect(silent.calls).toEqual(['show(T)', 'wait(1200)', 'wait(1800)']);
  });
});

// ---- the guard: every caption in the step modules names its beat ----
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODULES = ['steps/week.mjs', 'steps/ai.mjs', 'steps/features.mjs', 'steps/first-run.mjs', 'setup.mjs'];
const sources = MODULES.map((f) => [f, fs.readFileSync(path.join(HERE, f), 'utf8')]);
const count = (re) => sources.reduce((n, [, s]) => n + (s.match(re) ?? []).length, 0);
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Every beat id in the step modules: the literal third arguments, plus the Gantt view toggles, whose id
 *  is built from their step id (`f-gantt-<id>`, features.mjs `viewToggle`). */
function beatIds() {
  const ids = [];
  for (const [, s] of sources) {
    for (const m of s.matchAll(/caption\(ctx,[^\n]*,\s*'([^'\n]*)'\s*\);/g)) ids.push(m[1]);
    for (const m of s.matchAll(/digestStep\('([^']*)'\)/g)) ids.push(m[1]);
    for (const m of s.matchAll(/viewToggle\('([^']*)'/g)) ids.push(`f-gantt-${m[1]}`);
  }
  return ids;
}

describe('beat ids in the step modules (§715)', () => {
  it('every caption passes a beat id (a clear, caption(ctx, \'\'), has none)', () => {
    const calls = count(/caption\(ctx,/g);
    const clears = count(/caption\(ctx,\s*''\s*\)/g);
    // Each call is one line, and a caption's text may hold a ';', so a call ends at its line's ');'.
    const withId = count(/caption\(ctx,[^\n]*,\s*['`][^'`\n]*['`]\s*\);/g);
    expect(calls).toBeGreaterThan(100);
    // The digest step's caption takes its id from a parameter (digestStep), so its call ends in an identifier.
    expect(withId).toBe(calls - clears - 1);
  });

  it('the only ids built at run time are the Gantt view toggle and the digest step, whose two ids are literal', () => {
    expect(count(/caption\(ctx,[^\n]*,\s*beatId\);/g)).toBe(1);
    expect(count(/digestStep\('/g)).toBe(2);
    expect(count(/caption\(ctx,[^\n]*,\s*`[^`\n]*`\s*\);/g)).toBe(1);
    expect(sources.find(([f]) => f === 'steps/features.mjs')[1]).toContain('caption(ctx, text, `f-gantt-${id}`)');
    expect(count(/viewToggle\('/g)).toBe(5);
  });

  it('every id is well-formed, unique, and not a reserved one', () => {
    const ids = beatIds();
    expect(ids.length).toBe(count(/caption\(ctx,/g) - count(/caption\(ctx,\s*''\s*\)/g) - 2 + 5 + 2);
    expect(ids.filter((id) => !ID_RE.test(id))).toEqual([]);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(ids.filter((id) => [TITLE, OPENING, CLOSING].includes(id))).toEqual([]);
  });
});

// ---- the narration files name only beats some caption shows ----
const NARRATION_DIR = path.join(HERE, 'narration', 'en');
const RESERVED = [TITLE, OPENING, CLOSING];

describe('narration files against the step captions (§715)', () => {
  it('every non-reserved beat id in every narration file is shown by some caption', () => {
    const shown = new Set(beatIds());
    const files = fs.readdirSync(NARRATION_DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');
    expect(files.length).toBeGreaterThan(0);
    const stray = [];
    for (const f of files) {
      for (const { id } of parseNarration(fs.readFileSync(path.join(NARRATION_DIR, f), 'utf8'))) {
        if (!RESERVED.includes(id) && !shown.has(id)) stray.push(`${f}: ${id}`);
      }
    }
    expect(stray).toEqual([]);
  });
});
