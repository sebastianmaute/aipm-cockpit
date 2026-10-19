// §715 demo recorder: what every take does before its first recorded step — connect Turso and the key
// through the app's own setup wizard, Explore the demo, seed the device state, move the clock. Through
// the app's UI throughout: no test-only shortcut, so the secrets-at-rest rule holds. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from './lib.mjs';
import { caption, click, moveTo, nav, pace, skipTour, type } from './ui.mjs';

// Visible dialogs only: a closed modal can stay in the DOM after the one on screen.
const DLG = '[role="dialog"]:visible';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEVICE_STATE = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'device-state.json'), 'utf8'));

/** The setup wizard of a fresh browser: Turso (URL, token, test, portfolio storage), then the key.
 *  `ctx.secrets` = { url, token, key }. Filled, never typed: a typed secret is a frame per character. */
export async function connect(ctx, { onCamera }) {
  const page = ctx.page;
  await page.getByText(/No projects yet/).first().waitFor({ timeout: 180000 });
  await L.settle(page);
  if (onCamera) await caption(ctx, 'Connect the database and Claude.');
  await click(ctx, page.getByRole('button', { name: 'Set up Turso first' }), 'Set up Turso first');
  const d = page.locator(DLG).last();
  await click(ctx, d.getByRole('checkbox').nth(1), 'Turso checkbox');
  await acknowledge(ctx);
  if (onCamera) await caption(ctx, 'Paste URL and token, test, done.');
  await type(ctx, d.getByPlaceholder('libsql://your-db.turso.io'), ctx.secrets.url, 'url', { slow: false });
  await type(ctx, d.locator('input[type=password]').first(), ctx.secrets.token, 'token', { slow: false });
  await click(ctx, d.getByRole('button', { name: 'Test connection – Turso' }), 'Test connection', 5000);
  await d.getByLabel('Portfolio storage').selectOption({ index: 1 });
  await pace(ctx, 1000);
  await click(ctx, d.getByRole('button', { name: 'Next', exact: true }), 'Next');
  if (onCamera) await caption(ctx, 'Paste once. Stored encrypted on this device.');
  await click(ctx, d.getByRole('checkbox').first(), 'AI switch');
  await acknowledge(ctx);
  await type(ctx, d.getByPlaceholder('sk-ant-...'), ctx.secrets.key, 'key', { slow: false });
  await pickModel(ctx, d, onCamera);
  await pace(ctx, 2000);
  for (let i = 0; i < 4; i++) {
    const fin = d.getByRole('button', { name: 'Finish', exact: true });
    if (await fin.count()) {
      // Finish commits the portfolio storage choice and reloads the app onto Turso.
      const reloaded = page.waitForEvent('load', { timeout: 60000 });
      // A bare click: ui.click settles the page by evaluating in it, which a reload mid-way would break.
      await moveTo(ctx, fin);
      await fin.click();
      await reloaded;
      await L.settle(page);
      break;
    }
    const nx = d.getByRole('button', { name: 'Next', exact: true });
    await click(ctx, (await nx.count()) ? nx : d.getByRole('button', { name: 'Skip', exact: true }), 'Next/Skip');
  }
  await page.getByRole('button', { name: 'Explore the demo', exact: true }).waitFor({ timeout: 60000 });
  const mode = await page.evaluate(() => localStorage.getItem('aipm-cockpit:portfolio-mode'));
  if (mode !== 'turso') throw new Error('the portfolio did not switch to Turso');
  if (onCamera) await caption(ctx, '');
}

/** The model every take uses. The picker lists Anthropic's live models once the key is in, so the take
 *  waits for this one to appear, then chooses it (the default stays the registry's first entry). */
export const DEMO_MODEL = /Sonnet 5\.5/;

async function pickModel(ctx, d, onCamera) {
  const select = d.getByRole('combobox', { name: /^Model/ });
  const option = select.locator('option', { hasText: DEMO_MODEL }).first();
  await option.waitFor({ state: 'attached', timeout: 30000 }).catch(() => {
    throw new Error('the model list has no Sonnet 5.5 after the key was entered');
  });
  if (onCamera) await caption(ctx, 'With the key in, the model list loads: pick Sonnet 5.5.');
  await moveTo(ctx, select);
  await select.selectOption(await option.getAttribute('value'));
  await L.settle(ctx.page);
  await pace(ctx, 1500);
}

async function acknowledge(ctx) {
  const ack = ctx.page.getByRole('button', { name: 'I understand', exact: true });
  if (await ack.isVisible().catch(() => false)) await click(ctx, ack, 'I understand');
}

/** The empty state's "Explore the demo": the app creates the demo on Turso and starts the tour. */
export async function exploreDemo(ctx) {
  const page = ctx.page;
  await click(ctx, page.getByRole('button', { name: 'Explore the demo', exact: true }), 'Explore the demo', 3000);
  await skipTour(ctx, 60000);
  // §740: the banner once appeared here; it is an app bug if it ever does again.
  if (await page.getByText('changed in another tab').count()) throw new Error('"changed in another tab" banner after Explore the demo');
}

export async function currentProjectId(ctx) {
  const id = await ctx.page.evaluate(() => localStorage.getItem('aipm-cockpit:turso-current-project'));
  if (!id) throw new Error('no current Turso project after Explore the demo');
  return id;
}

/** Friday's "since you last looked" record and the digest's prior run, for the new project id. The
 *  Dashboard saves its own record about 4 s after it mounts (ADVANCE_DELAY_MS); the seed is written
 *  after that save and the page reloaded, so the strip reads Friday, not this morning. */
export async function seedDeviceState(ctx, id) {
  const page = ctx.page;
  await page.waitForFunction((pid) => {
    try { return pid in JSON.parse(localStorage.getItem('aipm-cockpit:landing-state') ?? '{}'); } catch { return false; }
  }, id, { timeout: 30000 });
  await page.evaluate(({ pid, state }) => {
    const put = (key, value) => {
      let map = {};
      try { map = JSON.parse(localStorage.getItem(key) ?? '{}') ?? {}; } catch { map = {}; }
      map[pid] = value;
      localStorage.setItem(key, JSON.stringify(map));
    };
    put('aipm-cockpit:landing-state', state.landing);
    put('aipm-cockpit:digest-state', state.digest);
  }, { pid: id, state: DEVICE_STATE });
  await page.reload();
  await L.settle(page);
  // The reload lands on the Dashboard: its strip must now read Friday's visit, not a first visit.
  const since = page.getByText('Since you last looked').first();
  await since.waitFor({ timeout: 30000 }).catch(() => {});
  if (!(await since.isVisible().catch(() => false))) throw new Error('the Dashboard strip does not show the seeded Friday visit');
}

/** Settings → "Weekly status digest" on (off by default). Off camera; the seeded digest state is not due
 *  before the week ends, so it never generates by itself — the takes press Generate now. */
export async function enableDigest(ctx) {
  const page = ctx.page;
  await nav(ctx, 'Settings');
  const box = page.getByRole('checkbox', { name: 'Weekly status digest', exact: true });
  if (!(await box.isVisible().catch(() => false))) {
    const tab = page.getByRole('tab', { name: /Integrations/ }).or(page.getByRole('button', { name: /^Integrations/ }));
    if (await tab.count()) await click(ctx, tab.first(), 'Integrations');
  }
  if (!(await box.isChecked())) await click(ctx, box, 'Weekly status digest', 500);
  await nav(ctx, 'Dashboard');
}

/** The AI Assistant's one-time consent (per device), given off camera so a chat step opens on the chat. */
export async function enableChat(ctx) {
  const page = ctx.page;
  await nav(ctx, 'AI Assistant');
  const consent = page.locator('main').getByRole('button', { name: /enable chat/i });
  if (await consent.isVisible().catch(() => false)) {
    const boxes = page.locator('main').getByRole('checkbox');
    for (let i = 0; i < (await boxes.count()); i++) if (!(await boxes.nth(i).isChecked())) await click(ctx, boxes.nth(i), 'consent box', 300);
    await click(ctx, consent, 'enable chat');
  }
  await nav(ctx, 'Dashboard');
}

/** 08:30 in Berlin on `day`, then a reload so every "today" in the app moves with it. */
export async function goToDay(ctx, day) {
  await ctx.page.clock.setSystemTime(L.atDay(day));
  await ctx.page.reload();
  await L.settle(ctx.page);
  await skipTour(ctx);
}
