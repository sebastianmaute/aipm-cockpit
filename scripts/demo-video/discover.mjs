// §715 demo recorder: lists the controls a view shows on the fresh demo, for writing or fixing a step's
// selectors after the UI changed. Off camera, on the throwaway database, like a take's setup.
//   node scripts/demo-video/discover.mjs "<path>" ["<path>" …]
// A path is views and actions joined by ">", run in order from the demo's Dashboard:
//   Resources>Planning          nav items (a sub-view after its parent)
//   Settings>@Next actions      @name  clicks a button in main
//   Open Points>~Board          ~name  clicks a radio (a segmented control) in main
//   Settings>!Expert mode       !name  ticks a checkbox
//   RAID>#GDPR erasure          #text  opens the table row holding the text
// Each path prints the nav items, then every visible control (tag, type, state, accessible name). Values
// are masked against the throwaway pair and the key. See README.md.
import { chromium } from '@playwright/test';
import * as L from './lib.mjs';
import { cleanup } from './cleanup.mjs';
import * as setup from './setup.mjs';
import * as ui from './ui.mjs';

const T = L.throwaway();
const KEY = L.readEnv('ANTHROPIC_API_KEY');
const SECRETS = [T.url, T.host, T.token, KEY].filter(Boolean);
const mask = (s) => SECRETS.reduce((a, v) => a.split(v).join('<secret>'), String(s));
const out = (...a) => console.log(mask(a.join(' ')));

const CONTROLS = [
  'main button', 'main [role=tab]', 'main [role=radio]', 'main [role=slider]', 'main a[href]', 'main input',
  'main [role=switch]', 'main select', 'main [role=spinbutton]', 'main [role=searchbox]',
  '[role=dialog] button', '[role=dialog] input', '[role=dialog] select',
  '[role=menuitem]', '[role=menuitemcheckbox]', '[role=menuitemradio]',
].join(', ');

async function dump(page, label) {
  const names = await page.evaluate((sel) => {
    const visible = (el) => !!(el.offsetParent || el.getClientRects().length);
    const rows = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      const name = el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.innerText || el.title || '';
      const role = el.getAttribute('role');
      const kind = `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ''}${el.type ? ':' + el.type : ''}${el.checked ? '[x]' : ''}`;
      const value = el.value && el.tagName !== 'BUTTON' ? '=' + el.value : '';
      rows.push(`${kind}${value} ${name.trim().replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    return [...new Set(rows)];
  }, CONTROLS);
  out(`== ${label} (${names.length})`);
  for (const n of names) out('  ', n);
}

async function act(page, ctx, part) {
  const main = page.locator('main');
  if (part.startsWith('#')) return main.locator('tbody tr', { hasText: part.slice(1) }).first().click();
  if (part.startsWith('~')) return main.getByRole('radio', { name: part.slice(1), exact: true }).first().click();
  if (part.startsWith('!')) return page.getByRole('checkbox', { name: part.slice(1), exact: true }).first().check();
  if (part.startsWith('@')) return main.getByRole('button', { name: part.slice(1), exact: true }).first().click();
  return ui.nav(ctx, part);
}

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('usage: node scripts/demo-video/discover.mjs "<view>[>@button|~radio|!checkbox|#row …]" …');
  process.exit(2);
}
await cleanup();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, locale: 'en-US', timezoneId: 'Europe/Berlin' });
await L.guardTurso(context, T.host);
const page = await context.newPage();
const ctx = { page, clipId: 'discover', rehearse: true, withAi: false, log: (l) => out('[log]', l), lines: [], secrets: { url: T.url, token: T.token, key: KEY } };
let failed = false;
try {
  await page.clock.install({ time: L.T0 });
  await page.addInitScript(() => {
    if (!localStorage.getItem('aipm-cockpit:settings')) localStorage.setItem('aipm-cockpit:settings', JSON.stringify({ tourSeen: true }));
  });
  await page.goto(L.BASE + '/');
  await setup.connect(ctx, { onCamera: false });
  await setup.exploreDemo(ctx);
  await setup.seedDeviceState(ctx, await setup.currentProjectId(ctx));
  await setup.enableDigest(ctx);
  await setup.enableChat(ctx);
  for (const p of paths) {
    for (const part of p.split('>')) await act(page, ctx, part);
    await L.settle(page);
    out('NAV', JSON.stringify([...new Set(await L.navItems(page))]));
    await dump(page, p);
  }
} catch (e) {
  failed = true;
  out('DISCOVER ERROR', String(e?.message ?? e).split('\n').slice(0, 4).join(' | '));
} finally {
  await context.close();
  await browser.close();
  await cleanup();
}
process.exitCode = failed ? 1 : 0;
