// §715 A — a video shows at most a few seconds of Claude thinking: each AI wait is noted on the
// recording's timeline, and a wait longer than MAX_AI_WAIT_S keeps only its first and last seconds.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { timedAiWait, waitForAi } from './ai-wait.mjs';
import { MAX_AI_WAIT_S, keepRanges, trimAiWaits, trimArgs } from './trim.mjs';

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
    expect(r).toEqual({ cut: 17, capped: 1 });
    expect(fs.readFileSync(t.file, 'utf8')).toBe('TRIMMED');
    expect(fs.readFileSync(t.raw, 'utf8')).toBe('TAKE');
  });

  it('leaves a take with nothing to cut as it is, and drops an untrimmed copy from an earlier take', () => {
    const t = setup();
    fs.mkdirSync(path.dirname(t.raw), { recursive: true });
    fs.writeFileSync(t.raw, 'OLD');
    expect(trimAiWaits(t.file, [{ start: 5, end: 6 }], t.out, { exec: t.exec })).toEqual({ cut: 0, capped: 0 });
    expect(fs.readFileSync(t.file, 'utf8')).toBe('TAKE');
    expect(fs.existsSync(t.raw)).toBe(false);
  });

  it('a failed encode keeps the take, removes the partial file, and names the cause', () => {
    const t = setup({ fail: true });
    expect(() => trimAiWaits(t.file, [{ start: 5, end: 25 }], t.out, { exec: t.exec })).toThrow(/Unknown encoder libvpx-vp9/);
    expect(fs.readFileSync(t.file, 'utf8')).toBe('TAKE');
    expect(fs.readdirSync(path.dirname(t.file))).toEqual(['01-x.webm']);
  });
});
