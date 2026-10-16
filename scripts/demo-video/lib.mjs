// §715 demo recorder: shared helpers for record.mjs and cleanup.mjs. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const NAV = 'aside a, aside button, nav a, nav button, [role="tab"]';
export const BASE = process.env.QA_BASE_URL || 'http://localhost:3300';
// The pinned "today" of the recording (09:00 in Berlin, where the browser runs); chapter 7 jumps
// three weeks past it. The explicit offset keeps day() independent of this machine's time zone.
export const T0 = new Date('2026-11-02T09:00:00+01:00');
export const OUT = process.env.DEMO_VIDEO_DIR || path.join(ROOT, '.superpowers', 'tmp', 'demo-video');

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

export async function openView(page, name) {
  const ok = await page.evaluate(({ name, sel }) => {
    const el = [...document.querySelectorAll(sel)].find(
      (e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ') === name);
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
