// §715 checks finished renders without a take: for each .mp4, the gap and tail checks of render-check.mjs on
// its .srt (the cues are the voices), the length read with ffprobe. The AI waits come from the `.waits.json`
// a take writes beside its render (narrated.mjs). Without that file (an old render) the waits are unknown: in
// an AI clip, a chapter or big (they hold AI steps) a long silence is listed as unverified, not as a stall. A
// caption's time is not in the files, so the desync check needs a take.
//   node scripts/demo-video/check-render.mjs <file.mp4> [...]
// Prints one line per finding (or "ok"), and exits 1 when any finding is not unverified. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gapFindings, parseSrt, tailFinding } from './render-check.mjs';
import { probeDuration } from './trim.mjs';

/** The findings for one render: `srt` is its subtitle text, `duration` its length, `waits` its AI waits on its
 *  timeline, or null when they are not known. */
export function checkRender({ srt, duration, waits }) {
  const cues = parseSrt(srt);
  if (!cues.length) return ['RENDER no subtitles'];
  const lastEnd = Math.max(...cues.map((c) => c.end));
  return [...gapFindings(cues, waits ?? [], { unverified: waits == null }), tailFinding(lastEnd, duration)].filter(Boolean);
}

/** The tiers that hold AI steps: an old render of one, with no waits file, cannot be judged on its gaps. */
const AI_TIERS = ['ai', 'chapters', 'big'];

/** Checks each render, one at a time: a file it cannot read or probe is reported and the next one is checked.
 *  `exists`, `read` and `probe` (a video's length in seconds) are overridable for tests. Returns the lines to
 *  print and whether any finding (not an unverified one) or any error was found. */
export function checkFiles(files, { exists = fs.existsSync, read = (p) => fs.readFileSync(p, 'utf8'), probe = probeDuration } = {}) {
  const lines = [];
  let failed = false;
  for (const file of files) {
    const srtFile = file.replace(/\.mp4$/, '.srt');
    const waitsFile = file.replace(/\.mp4$/, '.waits.json');
    if (!exists(srtFile)) {
      lines.push(`${file}: no .srt beside it`);
      failed = true;
      continue;
    }
    let duration;
    try {
      duration = probe(file);
    } catch (e) {
      lines.push(`${file}: probe failed: ${String(e?.message ?? e).split('\n')[0]}`);
      failed = true;
      continue;
    }
    const known = exists(waitsFile) ? JSON.parse(read(waitsFile)) : null;
    const waits = known ?? (AI_TIERS.includes(path.basename(path.dirname(file))) ? null : []);
    const found = checkRender({ srt: read(srtFile), duration, waits });
    for (const f of found) lines.push(`${file}: ${f}`);
    if (!found.length) lines.push(`${file}: ok`);
    if (found.some((f) => !f.includes('unverified'))) failed = true;
  }
  return { lines, failed };
}

// Run as a script, not when a test imports checkRender.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node scripts/demo-video/check-render.mjs <file.mp4> [...]');
    process.exitCode = 2;
  } else {
    const { lines, failed } = checkFiles(files);
    for (const l of lines) console.log(l);
    process.exitCode = failed ? 1 : 0;
  }
}
