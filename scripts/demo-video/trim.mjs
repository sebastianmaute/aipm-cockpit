// §715 demo recorder: a video shows at most MAX_AI_WAIT_S of Claude thinking. take.mjs notes each AI wait
// on the recording's timeline (ai-wait.mjs); after a take, a wait longer than the cap keeps its first and
// last half of it (the busy state, then the result arriving) and its middle is cut with ffmpeg. The
// untrimmed take is kept under `<out>/untrimmed/`. See README.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_AI_WAIT_S = 3;
// A cut shorter than this is a jump of a few frames on the spinner, which reads as a glitch: such a wait is kept.
const MIN_CUT_S = 1;
// The screencast's frame rate (ffprobe: 25/1); the trimmed file keeps it.
const FPS = 25;
// The big video (about 18 minutes) encodes in a few minutes; a hung ffmpeg must not hold the run.
const TRIM_TIMEOUT_MS = 30 * 60 * 1000;

const isCut = (w, max) => w.end - w.start > max + MIN_CUT_S;

/** The spans of a `duration`-second video to keep, once each wait longer than `max` (by more than
 *  MIN_CUT_S) keeps only its first and last `max / 2` seconds. Waits may arrive in any order and overlap
 *  (a retry inside a longer wait). */
export function keepRanges(waits, duration, max = MAX_AI_WAIT_S) {
  const cuts = waits
    .filter((w) => isCut(w, max))
    .map((w) => [w.start + max / 2, w.end - max / 2])
    .sort((a, b) => a[0] - b[0]);
  const ranges = [];
  let from = 0;
  for (const [a, b] of cuts) {
    if (a > from) ranges.push([from, Math.min(a, duration)]);
    from = Math.max(from, b);
  }
  if (from < duration) ranges.push([from, duration]);
  return ranges.filter(([a, b]) => b > a);
}

/** ffmpeg arguments that keep `ranges` of `src` and join them into `dst`. */
export function trimArgs(src, dst, ranges) {
  const parts = ranges.map(([a, b], i) => `[0:v]trim=start=${a}:end=${b},setpts=PTS-STARTPTS[v${i}]`);
  const join = `${ranges.map((_, i) => `[v${i}]`).join('')}concat=n=${ranges.length}:v=1:a=0[out]`;
  return [
    // Errors only: a long encode's progress lines would overflow the buffer that keeps the diagnostic.
    '-v', 'error', '-nostats',
    '-y', '-i', src,
    '-filter_complex', [...parts, join].join(';'),
    '-map', '[out]',
    '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
    '-r', String(FPS),
    dst,
  ];
}

/** Trims `file` in place. Returns the seconds cut and how many waits were capped (both 0 when no wait
 *  was over the cap). A failed encode or rename throws with ffmpeg's message (or the error's) and leaves `file` untouched.
 *  `exec` has `execFileSync`'s shape; tests pass a fake. */
export function trimAiWaits(file, waits, outRoot, { exec = execFileSync } = {}) {
  const run = (cmd, args) => exec(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: TRIM_TIMEOUT_MS });
  const total = Number(String(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])).trim());
  if (!Number.isFinite(total) || total <= 0) throw new Error(`no duration for ${path.basename(file)}`);
  const raw = path.join(outRoot, 'untrimmed', path.relative(outRoot, file));
  const ranges = keepRanges(waits ?? [], total);
  if (ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === total) {
    // An untrimmed copy from an earlier take would no longer match this one.
    fs.rmSync(raw, { force: true });
    return { cut: 0, capped: 0 };
  }
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  fs.copyFileSync(file, raw);
  const tmp = file.replace(/\.webm$/, '.trim.webm');
  try {
    run('ffmpeg', trimArgs(raw, tmp, ranges));
    fs.renameSync(tmp, file);
  } catch (e) {
    // The take was never replaced, so its untrimmed copy would only duplicate it.
    fs.rmSync(tmp, { force: true });
    fs.rmSync(raw, { force: true });
    const why = String(e?.stderr ?? '').trim().split('\n').slice(-3).join(' | ') || String(e?.message ?? e).split('\n')[0];
    throw new Error(`trim failed for ${path.basename(file)}: ${why}`);
  }
  const kept = ranges.reduce((s, [a, b]) => s + (b - a), 0);
  return { cut: total - kept, capped: (waits ?? []).filter((w) => isCut(w, MAX_AI_WAIT_S)).length };
}
