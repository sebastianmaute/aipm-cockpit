// §715 demo recorder: a short AI clip shows at most MAX_AI_WAIT_S of Claude thinking. take.mjs notes each
// AI wait on the recording's timeline (ai-wait.mjs); after an `ai` take, a wait longer than the cap keeps
// its first and last half of it (the busy state, then the result arriving) and its middle is cut with
// ffmpeg. The untrimmed take is kept under `<out>/untrimmed/`. See README.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_AI_WAIT_S = 3;
// The screencast's frame rate (ffprobe: 25/1); the trimmed file keeps it.
const FPS = 25;

/** The spans of a `duration`-second video to keep, once each wait longer than `max` keeps only its first
 *  and last `max / 2` seconds. Waits may arrive in any order and overlap (a retry inside a longer wait). */
export function keepRanges(waits, duration, max = MAX_AI_WAIT_S) {
  const cuts = waits
    .filter((w) => w.end - w.start > max)
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
    '-y', '-i', src,
    '-filter_complex', [...parts, join].join(';'),
    '-map', '[out]',
    '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
    '-r', String(FPS),
    dst,
  ];
}

function duration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = Number(out.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`no duration for ${file}`);
  return d;
}

/** Trims `file` in place. Returns the seconds cut (0 when no wait was over the cap). */
export function trimAiWaits(file, waits, outRoot) {
  const total = duration(file);
  const ranges = keepRanges(waits ?? [], total);
  const kept = ranges.reduce((s, [a, b]) => s + (b - a), 0);
  if (ranges.length === 1 && ranges[0][0] === 0 && ranges[0][1] === total) return 0;
  const raw = path.join(outRoot, 'untrimmed', path.relative(outRoot, file));
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  fs.copyFileSync(file, raw);
  const tmp = file.replace(/\.webm$/, '.trim.webm');
  execFileSync('ffmpeg', trimArgs(raw, tmp, ranges), { stdio: 'ignore' });
  fs.renameSync(tmp, file);
  return total - kept;
}
