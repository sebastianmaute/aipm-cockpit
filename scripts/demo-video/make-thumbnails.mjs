// §715 renders a YouTube thumbnail for every video that has a render: a frame of its .mp4 (ffmpeg), composed with its
// approved headline (thumbnails.mjs) in a page laid out at 1920×1080 and rendered at 1280×720 (YouTube's thumbnail size) as a PNG, `<name>.thumbnail.png`
// beside the .mp4. A video with no .mp4 is skipped and said so; a PNG over YouTube's 2 MB is flagged.
//   node scripts/demo-video/make-thumbnails.mjs [--video <id>]
// Reads DEMO_VIDEO_DIR like the recorder (lib.mjs OUT). See README.md.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from '@playwright/test';
import * as L from './lib.mjs';
import { outPath } from './cli.mjs';
import { VIDEOS } from './videos.mjs';
import { THUMBNAILS, defaultFrameTime, fitHeadline, tagFor, thumbnailHtml } from './thumbnails.mjs';
import { probeDuration } from './trim.mjs';

const YOUTUBE_MAX_BYTES = 2 * 1024 * 1024;
/** The page is laid out at 1920×1080; this scale renders it at 1280×720. */
const OUTPUT_SCALE = 1280 / 1920;

function readSidecar(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Number.isFinite(s?.duration) && Array.isArray(s.beats) ? s : null;
  } catch {
    return null;
  }
}

/** One frame of `mp4` at `sec`, as a PNG data URL. */
function frameAt(mp4, sec) {
  const png = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(sec), '-i', mp4, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'], { maxBuffer: 64 * 1024 * 1024 });
  return `data:image/png;base64,${png.toString('base64')}`;
}

const argv = process.argv.slice(2);
const only = argv.includes('--video') ? argv[argv.indexOf('--video') + 1] : null;
const defs = only ? VIDEOS.filter((d) => d.id === only) : VIDEOS;
if (only && !defs.length) throw new Error('unknown video ' + only);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: OUTPUT_SCALE });
let made = 0;
let flagged = 0;
for (const def of defs) {
  const mp4 = outPath(L.OUT, def, VIDEOS).replace(/\.webm$/, '.mp4');
  if (!fs.existsSync(mp4)) {
    console.log(`SKIP    ${def.id} no render (${mp4})`);
    continue;
  }
  const sidecar = readSidecar(mp4.replace(/\.mp4$/, '.beats.json'));
  const sec = defaultFrameTime(sidecar, THUMBNAILS[def.id]) ?? probeDuration(mp4) / 3;
  await page.setContent(thumbnailHtml({ tag: tagFor(def), headline: THUMBNAILS[def.id].headline, frame: frameAt(mp4, sec) }));
  // The headline is fitted only once its font has loaded: measured against a fallback font it comes out wrong.
  await page.evaluate(async () => { await document.fonts.load('255px Impact'); await document.fonts.ready; });
  const fit = await page.evaluate(fitHeadline);
  const file = mp4.replace(/\.mp4$/, '.thumbnail.png');
  await page.screenshot({ path: file, type: 'png' });
  const bytes = fs.statSync(file).size;
  const big = bytes > YOUTUBE_MAX_BYTES;
  if (big) flagged++;
  made++;
  console.log(`${big ? 'TOO BIG' : 'OK     '} ${def.id} at ${sec.toFixed(1)} s, headline ${fit.size} px on ${fit.lines} line(s), ${(bytes / 1024 / 1024).toFixed(2)} MB ${file}`);
}
await browser.close();
console.log(`RESULT made ${made} too-big ${flagged}`);
process.exitCode = flagged ? 1 : 0;
