// §715 checks finished renders without a take: for each .mp4, the gap and tail checks of render-check.mjs on
// its .srt (the cues are the voices), the length read with ffprobe. The AI waits come from the `.waits.json`
// a take writes beside its render (narrated.mjs; format in render-check.mjs parseWaits). Without that file (an
// old render) the waits are unknown: in an AI clip, a chapter or big (they hold AI steps) a long silence is
// listed as unverified, not as a stall. The tier is read from the folder the render sits in, so run it on the
// files in `<out>/<tier>/`. A caption's time is not in the files, so the desync check needs a take.
//   node scripts/demo-video/check-render.mjs <file.mp4> [...]
// Prints one line per finding (or "ok"). Exits 1 when any finding is not unverified (or a file could not be
// checked), 3 when the only findings are unverified ones, 0 when every render is clean. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPLASH_S, gapFindings, parseSrt, parseWaits, tailFinding } from './render-check.mjs';
import { probeDuration } from './trim.mjs';

/** The findings for one render: `srt` is its subtitle text, `duration` its length, `waits` its AI waits on its
 *  timeline, or null when they are not known. */
export function checkRender({ srt, duration, waits }) {
  const cues = parseSrt(srt);
  if (!cues.length) return ['RENDER no subtitles'];
  const lastEnd = Math.max(...cues.map((c) => c.end));
  return [...gapFindings(cues, waits ?? [], { unverified: waits == null, from: SPLASH_S }), tailFinding(lastEnd, duration)].filter(Boolean);
}

/** The tiers that hold AI steps: an old render of one, with no waits file, cannot be judged on its gaps. */
const AI_TIERS = ['ai', 'chapters', 'big'];

const firstLine = (e) => String(e?.message ?? e).split('\n')[0];

/** The findings for one file, or the one line saying why it could not be checked. */
function checkFile(file, { exists, read, probe }) {
  if (!file.endsWith('.mp4')) return { error: 'not an .mp4' };
  const srtFile = file.replace(/\.mp4$/, '.srt');
  const waitsFile = file.replace(/\.mp4$/, '.waits.json');
  if (!exists(srtFile)) return { error: 'no .srt beside it' };
  let duration;
  try {
    duration = probe(file);
  } catch (e) {
    return { error: `probe failed: ${firstLine(e)}` };
  }
  let srt;
  let waitsText;
  try {
    srt = read(srtFile);
    waitsText = exists(waitsFile) ? read(waitsFile) : null;
  } catch (e) {
    return { error: `read failed: ${firstLine(e)}` };
  }
  let waits;
  try {
    waits = waitsText != null ? parseWaits(waitsText, duration) : AI_TIERS.includes(path.basename(path.dirname(file))) ? null : [];
  } catch (e) {
    return { error: firstLine(e) };
  }
  return { found: checkRender({ srt, duration, waits }) };
}

/** Checks each render, one at a time: a file it cannot read, probe or parse is reported and the next one is
 *  checked. `exists`, `read` and `probe` (a video's length in seconds) are overridable for tests. Returns the
 *  lines to print, whether any finding (not an unverified one) or any error was found, and whether any
 *  unverified finding was. */
export function checkFiles(files, { exists = fs.existsSync, read = (p) => fs.readFileSync(p, 'utf8'), probe = probeDuration } = {}) {
  const lines = [];
  let failed = false;
  let unverified = false;
  for (const file of files) {
    const { error, found } = checkFile(file, { exists, read, probe });
    if (error) {
      lines.push(`${file}: ${error}`);
      failed = true;
      continue;
    }
    for (const f of found) lines.push(`${file}: ${f}`);
    if (!found.length) lines.push(`${file}: ok`);
    if (found.some((f) => !f.includes('unverified'))) failed = true;
    if (found.some((f) => f.includes('unverified'))) unverified = true;
  }
  return { lines, failed, unverified };
}

// Run as a script, not when a test imports checkRender.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node scripts/demo-video/check-render.mjs <file.mp4> [...]');
    process.exitCode = 2;
  } else {
    const { lines, failed, unverified } = checkFiles(files);
    for (const l of lines) console.log(l);
    process.exitCode = failed ? 1 : unverified ? 3 : 0;
  }
}
