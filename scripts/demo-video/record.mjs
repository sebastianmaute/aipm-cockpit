// §715 demo recorder: takes the video guides, one command per video, on the demo project and the
// throwaway Turso database.
//   node scripts/demo-video/record.mjs --video <id> | --tier <big|chapters|ai|features> | --all | --list
//   flags: --rehearse (no recording), --with-ai (a rehearsal also makes the AI calls), --probe (stop
//   after the demo opens: print the nav items and save a screenshot).
// Every take: cleanup → fresh browser context → setup off camera → preconditions → recording.
// Never prints credentials; the Turso host is blurred on screen. See README.md.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';
import { cleanup } from './cleanup.mjs';
import { exitCode, outPath, parseArgs, selectVideos } from './cli.mjs';
import * as setup from './setup.mjs';
import { checkDayFacts } from './steps/week.mjs';
import { runTake } from './take.mjs';
import { MAX_AI_WAIT_S, trimAiWaits } from './trim.mjs';
import * as ui from './ui.mjs';
import { VIDEOS } from './videos.mjs';

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
const SECRETS = [T.url, T.host, T.token, KEY];
const mask = (s) => SECRETS.reduce((acc, v, i) => (v ? acc.split(v).join(['<URL>', '<HOST>', '<TOKEN>', '<KEY>'][i]) : acc), String(s));

/** A `{ banner: <view> }` opening is that view's own banner text, read from the page. A sub-view names its
 *  path ("Resources>Planning"): its nav item shows only while its parent is open. */
async function resolveOpening(ctx, opening) {
  if (typeof opening === 'string') return opening;
  for (const view of opening.banner.split('>')) await ui.nav(ctx, view);
  // The view's callout (view-callout.tsx): its text is the <p> beside the "Dismiss hint" button.
  const text = await ctx.page.locator('main div:has(> button[aria-label="Dismiss hint"]) > p').first().innerText().catch(() => '');
  if (!text) throw new Error(`no banner text on ${opening.banner}`);
  return text.trim().replace(/\s+/g, ' ');
}

async function take(browser, def) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const lines = [];
  // The raw line is kept for the secret scan (take.mjs); the console only ever sees it masked.
  const log = (line) => { lines.push(String(line)); console.log(`[${def.id}]`, mask(line)); };
  const ctx = { page, clipId: def.id, rehearse: args.rehearse, withAi: args.withAi, log, lines, secrets: { url: T.url, token: T.token, key: KEY } };
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
      opts: { rehearse: args.rehearse, withAi: args.withAi, outFile: file, secrets: SECRETS },
    });
    // The day a chapter records (and the big video's last day) is checked once its steps are done.
    // ch2-connect ends as the demo opens, before any day's steps, so it has no day to check.
    const daysChecked = def.tier === 'big' || (def.tier === 'chapters' && !def.prologueOnCamera);
    if (r.status === 'ok' && ctx.checkDay && def.clock && daysChecked) {
      await ctx.checkDay(def.tier === 'big' ? 'fri' : def.clock);
    }
    // A short AI clip shows at most MAX_AI_WAIT_S of each wait for Claude (trim.mjs).
    if (r.status === 'ok' && r.file && def.tier === 'ai') {
      const cut = trimAiWaits(r.file, r.aiWaits, L.OUT);
      log(`TRIM ${r.aiWaits.length} AI wait(s) capped at ${MAX_AI_WAIT_S} s, ${cut.toFixed(1)} s cut`);
    }
    if (r.status !== 'ok') await page.screenshot({ path: path.join(L.OUT, `warn-${def.id}.png`) }).catch(() => {});
    return { ...r, warnings: r.warnings + warnings };
  } finally {
    await context.close();
  }
}

const browser = await chromium.launch({ headless: true });
const tally = { ok: 0, skipped: 0, failed: 0, warnings: 0 };
const notes = [];
try {
  fs.mkdirSync(L.OUT, { recursive: true });
  for (const def of selectVideos(VIDEOS, args)) {
    if (def.handRecorded) { notes.push(`${def.id}: hand-recorded, not taken`); continue; }
    await cleanup();
    const r = await take(browser, def).catch((e) => ({ status: 'failed', warnings: 0, error: mask(String(e?.message ?? e).split('\n')[0]) }));
    tally[r.status]++;
    tally.warnings += r.warnings;
    console.log(r.status.toUpperCase().padEnd(7), def.id, r.file ? mask(r.file) : '', r.error ? '- ' + mask(r.error) : '');
    if (r.status === 'skipped') notes.push(`${def.id}: missing ${r.missing.join('; ')}`);
  }
} finally {
  await browser.close();
  await cleanup().catch((e) => console.error('cleanup failed:', mask(e.message)));
}
for (const n of notes) console.log('NOTE', n);
console.log(`RESULT ok ${tally.ok} skipped ${tally.skipped} failed ${tally.failed} WARNINGS ${tally.warnings}`);
process.exitCode = exitCode({ warnings: tally.warnings, skipped: tally.skipped, failed: tally.failed });
