// §715 demo recorder: takes the video guides, one command per video, on the demo project and the
// throwaway Turso database.
//   node scripts/demo-video/record.mjs --video <id> | --tier <big|chapters|ai|features> | --all | --list
//   flags: --rehearse (no recording), --with-ai (a rehearsal also makes the AI calls), --probe (stop
//   after the demo opens: print the nav items and save a screenshot).
// Every take: cleanup → fresh browser context → setup off camera → preconditions → recording. A video with a
// narration file is paced by its beats' audio (rendered first by narrate.mjs); a rehearsal checks its beat ids.
// Never prints credentials; the Turso host is blurred on screen. See README.md.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import { cleanup } from './cleanup.mjs';
import { exitCode, outPath, parseArgs, selectVideos } from './cli.mjs';
import { narrationFor, trimAndMix } from './narrated.mjs';
import * as setup from './setup.mjs';
import { checkDayFacts } from './steps/week.mjs';
import { runTake } from './take.mjs';
import * as ui from './ui.mjs';
import { VIDEOS } from './videos.mjs';
import { writeDetailsPage } from './youtube.mjs';

const args = parseArgs(process.argv.slice(2));

if (args.list) {
  for (const d of VIDEOS) {
    const n = VIDEOS.filter((v) => v.tier === d.tier).indexOf(d) + 1;
    console.log([d.tier.padEnd(9), String(n).padStart(2, '0'), d.id.padEnd(20), d.title + (d.handRecorded ? '  (hand-recorded)' : '')].join('  '));
  }
  process.exit(0);
}

const T = L.throwaway();
const KEY = L.readEnv('ANTHROPIC_API_KEY');
if (!KEY) throw new Error('ANTHROPIC_API_KEY not set in .env.local');
// Read here only so the output scan can find it (ruling R6); only the render code (narrate.mjs) uses it.
// Empty when unset, and an empty secret is skipped by the mask and the scan.
const ELEVENLABS_KEY = L.readEnv('ELEVENLABS_API_KEY');
const SECRETS = [T.url, T.host, T.token, KEY, ELEVENLABS_KEY];
const mask = (s) => SECRETS.reduce((acc, v, i) => (v ? acc.split(v).join(['<URL>', '<HOST>', '<TOKEN>', '<KEY>', '<ELEVENLABS_KEY>'][i]) : acc), String(s));

/** The narration's language: English for now. */
const NARRATION_LANG = 'en';

/** A `{ banner: <view> }` opening is that view's own banner text, read from the page. A sub-view names its
 *  path ("Resources>Planning"): its nav item shows only while its parent is open. */
async function resolveOpening(ctx, opening) {
  if (typeof opening === 'string') return opening;
  for (const view of opening.banner.split('>')) await ui.nav(ctx, view);
  // The visible callout only: a panel kept mounted while hidden (RAID) keeps its callout in the DOM.
  return ui.viewHint(ctx, opening.banner);
}

async function take(browser, def) {
  const { narration, ownBeatIds } = narrationFor(def, { lang: NARRATION_LANG, rehearse: args.rehearse });
  const context = await browser.newContext({ viewport: L.VIEWPORT, locale: 'en-US', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const lines = [];
  // The raw line is kept for the secret scan (take.mjs); the console only ever sees it masked.
  const log = (line) => { lines.push(String(line)); console.log(`[${def.id}]`, mask(line)); };
  const ctx = { page, clipId: def.id, rehearse: args.rehearse, withAi: args.withAi, log, lines, secrets: { url: T.url, token: T.token, key: KEY } };
  if (narration) ctx.narration = narration;
  let warnings = 0;
  ctx.goToDay = (day) => setup.goToDay(ctx, day);
  // A rehearsal checks each finished day against DAY_FACTS (week-story.mjs); a mismatch is a warning.
  ctx.checkDay = args.rehearse
    ? async (day) => {
      const wrong = await checkDayFacts(await setup.currentProjectId(ctx), day);
      for (const w of wrong) log('FACT ' + w);
      warnings += wrong.length;
    }
    : undefined;
  await page.clock.install({ time: L.T0 });
  await page.addInitScript(() => {
    if (!localStorage.getItem('aipm-cockpit:settings')) localStorage.setItem('aipm-cockpit:settings', JSON.stringify({ tourSeen: true }));
  });
  await page.addInitScript(ui.OVERLAY, T.host);
  await L.guardTurso(context, T.host, () => { warnings++; });
  page.on('pageerror', (e) => log('PAGEERROR ' + e.message.slice(0, 200)));
  try {
    await page.goto(L.BASE + '/');
    // The Next.js dev badge would sit in every frame: its dev server must run with DEMO_RECORDER=1.
    await page.waitForLoadState('load');
    await page.waitForTimeout(1500);
    warnings += await ui.checkDevBadge(ctx);
    if (args.probe) {
      await setup.connect(ctx, { onCamera: false });
      await setup.exploreDemo(ctx);
      log('NAV ' + JSON.stringify([...new Set(await L.navItems(page))]));
      await page.screenshot({ path: path.join(L.OUT, 'probe-after-demo.png') });
      return { status: 'failed', warnings: warnings + 1, error: 'probe stop' };
    }
    const file = outPath(L.OUT, def, VIDEOS);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const r = await runTake(def, {
      ctx, setup, ui, resolveOpening,
      afterDay: async (c, day) => { if (c.checkDay) await c.checkDay(day); },
      opts: { rehearse: args.rehearse, withAi: args.withAi, outFile: file, secrets: SECRETS, ownBeatIds },
    });
    // The day a chapter records (and the big video's last day) is checked once its steps are done.
    // ch2-connect ends as the demo opens, before any day's steps, so it has no day to check.
    const daysChecked = def.tier === 'big' || (def.tier === 'chapters' && !def.prologueOnCamera);
    if (r.status === 'ok' && ctx.checkDay && def.clock && daysChecked) {
      await ctx.checkDay(def.tier === 'big' ? 'fri' : def.clock);
    }
    if (r.status !== 'ok') await page.screenshot({ path: path.join(L.OUT, `warn-${def.id}.png`) }).catch(() => {});
    return { ...r, warnings: r.warnings + warnings, narration };
  } finally {
    await context.close();
  }
}

/** The finished take, trimmed and (when narrated) mixed in the take's language (narrated.mjs), its logs masked. */
const trimTake = (def, r) => trimAndMix(def, r, { lang: NARRATION_LANG, outRoot: L.OUT, log: (...parts) => console.log(...parts.map(mask)) });

// Headless Chromium hides every scrollbar by default (Playwright adds --hide-scrollbars); the videos show
// the app as a user sees it, so a scrollable list looks scrollable.
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const tally = { ok: 0, skipped: 0, failed: 0, warnings: 0 };
const notes = [];
try {
  fs.mkdirSync(L.OUT, { recursive: true });
  for (const def of selectVideos(VIDEOS, args)) {
    if (def.handRecorded) { notes.push(`${def.id}: hand-recorded, not taken`); continue; }
    await cleanup();
    const r = trimTake(def, await take(browser, def).catch((e) => ({ status: 'failed', warnings: 0, error: mask(String(e?.message ?? e).split('\n')[0]) })));
    tally[r.status]++;
    tally.warnings += r.warnings;
    console.log(r.status.toUpperCase().padEnd(7), def.id, r.file ? mask(r.file) : '', r.error ? '- ' + mask(r.error) : '');
    if (r.status === 'skipped') notes.push(`${def.id}: missing ${r.missing.join('; ')}`);
  }
} finally {
  await browser.close();
  await cleanup().catch((e) => console.error('cleanup failed:', mask(e.message)));
  // Rewritten after every run, a partial one too: every video, rendered or not yet (youtube.mjs).
  try {
    console.log('DETAILS', mask(writeDetailsPage(L.OUT, VIDEOS, (def) => outPath(L.OUT, def, VIDEOS))));
  } catch (e) {
    console.error('DETAILS FAILED', mask(String(e?.message ?? e)));
  }
}
for (const n of notes) console.log('NOTE', n);
console.log(`RESULT ok ${tally.ok} skipped ${tally.skipped} failed ${tally.failed} WARNINGS ${tally.warnings}`);
process.exitCode = exitCode({ warnings: tally.warnings, skipped: tally.skipped, failed: tally.failed });
