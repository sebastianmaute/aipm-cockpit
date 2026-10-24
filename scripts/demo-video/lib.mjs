// §715 demo recorder: shared helpers for record.mjs and cleanup.mjs. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_WEEK_DATES } from './week-story.mjs';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NAV = 'aside a, aside button, nav a, nav button, [role="tab"]';
export const BASE = process.env.QA_BASE_URL || 'http://localhost:3300';
// The pinned "today" of every take: Monday of the demo week, 08:30 in Berlin, where the browser runs.
// The master is authored as of the Friday before (DEMO_AS_OF), so the demo's date shift is 0 and the
// viewer sees the master's own dates. September is Berlin summer time, hence +02:00; the explicit
// offset keeps day() and atDay() independent of this machine's time zone.
export const T0 = new Date(`${DEMO_WEEK_DATES.mon}T08:30:00+02:00`);

// 08:30 in Berlin on a day of the demo week ('mon' … 'fri'): each chapter's clock.
export function atDay(d) {
  const date = DEMO_WEEK_DATES[d];
  if (!date) throw new Error('atDay: unknown day ' + d);
  return new Date(`${date}T08:30:00+02:00`);
}
export const OUT = process.env.DEMO_VIDEO_DIR || path.join(ROOT, '.superpowers', 'tmp', 'demo-video');

// The frame of every video: the browser's viewport and the screencast's size, true 1080p.
export const VIEWPORT = Object.freeze({ width: 1920, height: 1080 });

/** "v<APP_VERSION> <APP_MILESTONE>" from the text of src/app/version.ts, read from the two declarations (the file's
 *  prose quotes older values). Parsed as text: the recorder never imports the app's TypeScript. */
export function appVersionLabel(text) {
  const read = (name) => {
    const m = new RegExp(`^export const ${name} = "([^"]+)";`, 'm').exec(text);
    if (!m) throw new Error(`version.ts: no ${name} declaration`);
    return m[1];
  };
  return `v${read('APP_VERSION')} ${read('APP_MILESTONE')}`;
}

/** The app's version label, read from src/app/version.ts at take time. */
export const readAppVersionLabel = () => appVersionLabel(fs.readFileSync(path.join(ROOT, 'src', 'app', 'version.ts'), 'utf8'));

// Reads one key from the repo's .env.local. Values are returned, never printed.
export function readEnv(key) {
  const txt = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  return (txt.match(new RegExp('^' + key + '=(.*)$', 'm'))?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
}

// The throwaway Turso pair. Only this database is ever written to.
export function throwaway() {
  const url = readEnv('TURSO_THROWAWAY_DATABASE_URL');
  const token = readEnv('TURSO_THROWAWAY_AUTH_TOKEN');
  if (!url || !token) throw new Error('TURSO_THROWAWAY_DATABASE_URL / TURSO_THROWAWAY_AUTH_TOKEN not set in .env.local');
  let host;
  try {
    host = new URL(url.replace(/^libsql:\/\//, 'https://')).host;
  } catch {
    // The URL error carries its input; keep the address out of the output.
    throw new Error('TURSO_THROWAWAY_DATABASE_URL is not a valid URL');
  }
  return { url, token, host };
}

// The throwaway pair, read once on first use: importing this module reads nothing.
let throwawayPair;
const pair = () => (throwawayPair ??= throwaway());

// Runs statements as one pipeline on the throwaway database and returns each statement's result, ok
// or error.
export async function pipeline(stmts) {
  const T = pair();
  const r = await fetch('https://' + T.host + '/v2/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + T.token, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [...stmts.map((s) => ({ type: 'execute', stmt: s })), { type: 'close' }] }),
  });
  if (!r.ok) throw new Error('Turso HTTP ' + r.status);
  return (await r.json()).results.slice(0, stmts.length);
}

// Runs one statement and returns its rows; an error result throws with the database's message.
export async function query(sql, args) {
  const [x] = await pipeline([args ? { sql, args } : { sql }]);
  if (x.type !== 'ok') throw new Error('Turso: ' + (x.error?.message ?? 'statement failed'));
  return x.response.result.rows;
}

// Aborts any Turso request that is not the throwaway database, on every page of the context.
export async function guardTurso(context, host, onBlocked = () => {}) {
  await context.route(/\.turso\.io\//, (r) => {
    const h = new URL(r.request().url()).host;
    if (h !== host) {
      console.error('GUARD: blocked non-throwaway Turso host');
      onBlocked();
      return r.abort();
    }
    return r.continue();
  });
}

// Waits until <main> stops changing size for three ticks in a row.
export async function settle(page) {
  let prev = -1;
  let stable = 0;
  for (let i = 0; i < 50 && stable < 3; i++) {
    const len = await page.evaluate(() => document.querySelector('main')?.innerHTML.length ?? 0);
    if (len === prev) stable++;
    else { stable = 0; prev = len; }
    await page.waitForTimeout(100);
  }
}

export async function navItems(page) {
  return page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .filter((e) => e.offsetParent !== null)
    .map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)), NAV);
}

// A nav item matches by name with whitespace collapsed and a trailing count badge dropped, since off its
// own view the Dashboard item reads "Dashboard2" (and Next actions "Next actions2"). ui.nav matches the
// same way.
export async function openView(page, name) {
  const ok = await page.evaluate(({ name, sel }) => {
    const norm = (s) => (s || '').trim().replace(/\s+/g, ' ').replace(/\s*\d+$/, '');
    const el = [...document.querySelectorAll(sel)].find(
      (e) => norm(e.getAttribute('aria-label') || e.textContent) === name);
    if (el) el.click();
    return !!el;
  }, { name, sel: NAV });
  if (!ok) throw new Error('openView: no nav item "' + name + '"');
  await settle(page);
}

// ISO date n days after T0.
export function day(n) {
  const d = new Date(T0);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
