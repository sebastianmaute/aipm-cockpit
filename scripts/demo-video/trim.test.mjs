// §715 A — a video shows at most a few seconds of Claude thinking: each AI wait is noted on the
// recording's timeline, and a wait longer than MAX_AI_WAIT_S keeps only its first and last seconds.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { timedAiWait, waitForAi } from './ai-wait.mjs';
import { MAX_AI_WAIT_S, keepRanges, mapTime, protectSpans, trimAiWaits, trimArgs } from './trim.mjs';

describe('keepRanges', () => {
  it('keeps the whole video when no wait is longer than the cap', () => {
    expect(keepRanges([{ start: 2, end: 4.5 }], 20)).toEqual([[0, 20]]);
  });

  it('keeps the first and last half of the cap of a long wait, and cuts its middle', () => {
    expect(MAX_AI_WAIT_S).toBe(3);
    expect(keepRanges([{ start: 5, end: 25 }], 40)).toEqual([[0, 6.5], [23.5, 40]]);
  });

  it('cuts several waits in order, whatever order they were noted in', () => {
    expect(keepRanges([{ start: 30, end: 40 }, { start: 5, end: 15 }], 50))
      .toEqual([[0, 6.5], [13.5, 31.5], [38.5, 50]]);
  });

  it('merges overlapping waits, such as a retry noted inside a longer wait', () => {
    expect(keepRanges([{ start: 5, end: 30 }, { start: 10, end: 20 }], 40)).toEqual([[0, 6.5], [28.5, 40]]);
  });

  it('leaves a wait only just over the cap alone: a cut of a few frames reads as a glitch', () => {
    expect(keepRanges([{ start: 5, end: 8.9 }], 20)).toEqual([[0, 20]]);
  });

  it('ends at the video when a wait runs past it', () => {
    expect(keepRanges([{ start: 10, end: 60 }], 30)).toEqual([[0, 11.5]]);
  });
});

describe('keepRanges with protected spans', () => {
  it('splits a cut around a narrated beat, so no range boundary falls inside it', () => {
    const ranges = keepRanges([{ start: 10, end: 30 }], 60, 3, [[20, 24]]);
    expect(ranges).toEqual([[0, 11.5], [20, 24], [28.5, 60]]);
    for (const [a, b] of ranges) {
      expect(a > 20 && a < 24).toBe(false);
      expect(b > 20 && b < 24).toBe(false);
    }
  });

  it('does not cut a wait that a protected span covers whole', () => {
    expect(keepRanges([{ start: 10, end: 30 }], 60, 3, [[0, 40]])).toEqual([[0, 60]]);
  });

  it('does not cut a piece shorter than the minimum that a protected span leaves', () => {
    expect(keepRanges([{ start: 10, end: 30 }], 60, 3, [[12, 28]])).toEqual([[0, 60]]);
  });
});

describe('keepRanges with the take end and off-camera cuts (§715)', () => {
  it("ends at the take's end: the recorder's padding after it is dropped", () => {
    expect(keepRanges([], 50.28, 3, [], { end: 46.57 })).toEqual([[0, 46.57]]);
    expect(keepRanges([{ start: 5, end: 25 }], 50, 3, [], { end: 45 })).toEqual([[0, 6.5], [23.5, 45]]);
  });

  it('keeps the whole video when the end is past it, or not given', () => {
    expect(keepRanges([], 40, 3, [], { end: 41 })).toEqual([[0, 40]]);
    expect(keepRanges([], 40, 3, [], {})).toEqual([[0, 40]]);
  });

  it('cuts an off-camera span whole, never into a narrated beat', () => {
    expect(keepRanges([], 60, 3, [], { cuts: [{ start: 20, end: 45 }] })).toEqual([[0, 20], [45, 60]]);
    expect(keepRanges([], 60, 3, [[18, 22]], { cuts: [{ start: 20, end: 45 }] })).toEqual([[0, 22], [45, 60]]);
  });
});

describe('protectSpans', () => {
  it('turns beats into [at, at + duration] spans', () => {
    expect(protectSpans([{ id: 'a', at: 20, duration: 4 }])).toEqual([[20, 24]]);
    expect(protectSpans(undefined)).toEqual([]);
  });
});

describe('mapTime', () => {
  const ranges = [[0, 10], [20, 30]];
  it('keeps a time before the first cut', () => expect(mapTime(5, ranges)).toBe(5));
  it('shifts a time after a cut by the cut length', () => expect(mapTime(25, ranges)).toBe(15));
  it('maps a time inside a cut to the cut start', () => expect(mapTime(15, ranges)).toBe(10));
  it('maps a time past the end to the trimmed length', () => expect(mapTime(99, ranges)).toBe(20));
});

describe('trimArgs', () => {
  it('trims each kept range, joins them, and writes VP9 at the recording rate', () => {
    const args = trimArgs('in.webm', 'out.webm', [[0, 6.5], [23.5, 40]]);
    // Errors only: a long encode's progress lines would overflow the buffer that keeps the diagnostic.
    expect(args.slice(0, 6)).toEqual(['-v', 'error', '-nostats', '-y', '-i', 'in.webm']);
    const filter = args[args.indexOf('-filter_complex') + 1];
    expect(filter).toBe(
      '[0:v]trim=start=0:end=6.5,setpts=PTS-STARTPTS[v0];' +
      '[0:v]trim=start=23.5:end=40,setpts=PTS-STARTPTS[v1];' +
      '[v0][v1]concat=n=2:v=1:a=0[out]',
    );
    expect(args).toEqual(expect.arrayContaining(['-map', '[out]', '-c:v', 'libvpx-vp9', '-r', '25']));
    expect(args.at(-1)).toBe('out.webm');
  });
});

describe('timedAiWait', () => {
  it('notes the wait in seconds since the recording started', async () => {
    const ctx = { recordingStartedAt: performance.now() - 2000 };
    await timedAiWait(ctx, async () => {});
    expect(ctx.aiWaits).toHaveLength(1);
    expect(ctx.aiWaits[0].start).toBeGreaterThanOrEqual(1.9);
    expect(ctx.aiWaits[0].end).toBeGreaterThanOrEqual(ctx.aiWaits[0].start);
  });

  it('notes nothing off camera', async () => {
    const ctx = {};
    await timedAiWait(ctx, async () => {});
    expect(ctx.aiWaits).toBeUndefined();
  });

  it('is how waitForAi waits, so every AI step on camera is noted', async () => {
    const ok = { waitFor: async () => {} };
    const ctx = { clipId: 'x', recordingStartedAt: performance.now() };
    await waitForAi(ctx, { busy: ok, done: ok, label: 'l' });
    expect(ctx.aiWaits).toHaveLength(1);
  });
});

describe('trimAiWaits', () => {
  // A fake ffprobe answers the duration; a fake ffmpeg writes its output file, or fails with a diagnostic.
  function setup({ fail = false } = {}) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'trim-'));
    const file = path.join(out, 'ai', '01-x.webm');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'TAKE');
    const exec = (cmd, args) => {
      if (cmd === 'ffprobe') return '40.0\n';
      if (fail) {
        fs.writeFileSync(args.at(-1), 'PARTIAL');
        throw Object.assign(new Error('Command failed: ffmpeg'), { stderr: 'line 1\nUnknown encoder libvpx-vp9\n' });
      }
      fs.writeFileSync(args.at(-1), 'TRIMMED');
      return '';
    };
    return { out, file, exec, raw: path.join(out, 'untrimmed', 'ai', '01-x.webm') };
  }

  it('replaces the take with the trimmed one and keeps the untrimmed copy', () => {
    const t = setup();
    const r = trimAiWaits(t.file, [{ start: 5, end: 25 }, { start: 30, end: 31 }], t.out, { exec: t.exec });
    expect(r).toEqual({ cut: 17, capped: 1, ranges: [[0, 6.5], [23.5, 40]] });
    expect(fs.readFileSync(t.file, 'utf8')).toBe('TRIMMED');
    expect(fs.readFileSync(t.raw, 'utf8')).toBe('TAKE');
  });

  it('leaves a take with nothing to cut as it is, and drops an untrimmed copy from an earlier take', () => {
    const t = setup();
    fs.mkdirSync(path.dirname(t.raw), { recursive: true });
    fs.writeFileSync(t.raw, 'OLD');
    expect(trimAiWaits(t.file, [{ start: 5, end: 6 }], t.out, { exec: t.exec })).toEqual({ cut: 0, capped: 0, ranges: [[0, 40]] });
    expect(fs.readFileSync(t.file, 'utf8')).toBe('TAKE');
    expect(fs.existsSync(t.raw)).toBe(false);
  });

  it("cuts a take with no AI wait at its end: the recorder's padded tail goes (§715)", () => {
    const t = setup();
    const r = trimAiWaits(t.file, [], t.out, { exec: t.exec, end: 36.2 });
    expect(r.ranges).toEqual([[0, 36.2]]);
    expect(r.cut).toBeCloseTo(3.8);
    expect(fs.readFileSync(t.file, 'utf8')).toBe('TRIMMED');
  });

  it('cuts an off-camera span (§715)', () => {
    const t = setup();
    expect(trimAiWaits(t.file, [], t.out, { exec: t.exec, cuts: [{ start: 10, end: 20 }] }).ranges).toEqual([[0, 10], [20, 40]]);
  });

  it('passes protected spans through, and returns the kept ranges', () => {
    const t = setup();
    const r = trimAiWaits(t.file, [{ start: 5, end: 25 }], t.out, { exec: t.exec, protect: [[12, 16]] });
    expect(r.ranges).toEqual([[0, 6.5], [12, 16], [23.5, 40]]);
    expect(r.cut).toBe(40 - (6.5 + 4 + 16.5));
  });

  it('a failed encode keeps the take, removes the partial file, and names the cause', () => {
    const t = setup({ fail: true });
    expect(() => trimAiWaits(t.file, [{ start: 5, end: 25 }], t.out, { exec: t.exec })).toThrow(/Unknown encoder libvpx-vp9/);
    expect(fs.readFileSync(t.file, 'utf8')).toBe('TAKE');
    expect(fs.readdirSync(path.dirname(t.file))).toEqual(['01-x.webm']);
    expect(fs.existsSync(t.raw)).toBe(false);
  });
});
