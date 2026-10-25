// §715 a playback chapter: a video recorded by hand (ch1-install), played full-frame in a page the take records
// like any other, so it gets every chapter's splash, title card, captions, narration, music and subtitles.
// The page and the video are served by the take's own routes on the app's origin, where the splash loads from.
// The source is WebM: the browser Playwright drives decodes no H.264. See README.md "Playback chapters".
import fs from 'node:fs';
import * as L from './lib.mjs';

export const PLAYBACK_PAGE = '/__demo-playback';
const SOURCE_URL = '/__demo-playback.webm';

/** The page: the source full-frame on black, paused on its first frame, muted (its sound is never used). */
export function playbackHtml() {
  return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#000;overflow:hidden}'
    + 'video{position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;background:#000}</style></head>'
    + `<body><video id="pb" src="${SOURCE_URL}" muted playsinline preload="auto"></video></body></html>`;
}

/** Opens the playback page for the source `file` and waits until it can play through. Throws when the file is
 *  missing: a take of a playback chapter needs its source first. */
export async function openPlayback(ctx, file) {
  if (!fs.existsSync(file)) throw new Error(`playback source missing: ${file}`);
  await ctx.page.route(L.BASE + SOURCE_URL, (route) => route.fulfill({ path: file, contentType: 'video/webm' }));
  await ctx.page.route(L.BASE + PLAYBACK_PAGE, (route) => route.fulfill({ body: playbackHtml(), contentType: 'text/html' }));
  await ctx.page.goto(L.BASE + PLAYBACK_PAGE);
  await ctx.page.waitForFunction(() => (document.getElementById('pb')?.readyState ?? 0) >= 4, null, { timeout: 60000 });
}

/** How long a stretch may take beyond its own length before the take fails: a stalled video, not a slow one. */
const PLAY_SLACK_MS = 30000;

/** Plays the source from where it stands to `sec`, then pauses on that frame. A rehearsal seeks there at once. */
export async function playTo(ctx, sec) {
  const at = await ctx.page.evaluate(() => document.getElementById('pb').currentTime);
  if (ctx.rehearse) {
    await ctx.page.evaluate((s) => { document.getElementById('pb').currentTime = s; }, sec);
    return;
  }
  await ctx.page.evaluate(() => document.getElementById('pb').play());
  const timeout = Math.max(0, sec - at) * 1000 + PLAY_SLACK_MS;
  await ctx.page.waitForFunction((s) => { const v = document.getElementById('pb'); return v.currentTime >= s || v.ended; }, sec, { timeout, polling: 'raf' });
  await ctx.page.evaluate(() => document.getElementById('pb').pause());
}
