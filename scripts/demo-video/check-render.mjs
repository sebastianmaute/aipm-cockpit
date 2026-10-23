// §715 checks finished renders without a take: for each .mp4, the gap and tail checks of render-check.mjs on
// its .srt (the cues are the voices), the length read with ffprobe. A caption's time is not in the files, so
// the desync check needs a take. An AI clip's waits are not in the files either: its long silences are listed
// as unverified, not as stalls.
//   node scripts/demo-video/check-render.mjs <file.mp4> [...]
// Prints one line per finding (or "ok"), and exits 1 when any finding is not unverified. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gapFindings, parseSrt, tailFinding } from './render-check.mjs';
import { probeDuration } from './trim.mjs';

/** The findings for one render: `srt` is its subtitle text, `duration` its length, `ai` whether it is an AI
 *  clip (its waits unknown). */
export function checkRender({ srt, duration, ai }) {
  const cues = parseSrt(srt);
  if (!cues.length) return ['RENDER no subtitles'];
  const lastEnd = Math.max(...cues.map((c) => c.end));
  return [...gapFindings(cues, [], { unverified: ai }), tailFinding(lastEnd, duration)].filter(Boolean);
}

/** An AI clip is any render under `ai/`, or named `NN-ai-<id>`. */
const isAiClip = (file) => path.basename(path.dirname(file)) === 'ai' || /^\d+-ai-/.test(path.basename(file));

function main(files) {
  if (!files.length) {
    console.error('usage: node scripts/demo-video/check-render.mjs <file.mp4> [...]');
    return 2;
  }
  let failed = false;
  for (const file of files) {
    const srtFile = file.replace(/\.mp4$/, '.srt');
    if (!fs.existsSync(srtFile)) {
      console.log(`${file}: no .srt beside it`);
      failed = true;
      continue;
    }
    const found = checkRender({ srt: fs.readFileSync(srtFile, 'utf8'), duration: probeDuration(file), ai: isAiClip(file) });
    for (const f of found) console.log(`${file}: ${f}`);
    if (!found.length) console.log(`${file}: ok`);
    if (found.some((f) => !f.includes('unverified'))) failed = true;
  }
  return failed ? 1 : 0;
}

// Run as a script, not when a test imports checkRender.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
