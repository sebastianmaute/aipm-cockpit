// §715 recording: the Playwright-driven chapters (2.2, 2.4, 2.5, 3–8) as one continuous video on the
// throwaway Turso database. `--rehearse` runs the same flow fast and without video; `--probe` stops
// after 3.1 and prints the nav items. See README.md.
// Never prints credentials; the Turso address is blurred on screen, token and key are password fields.
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const REHEARSE = process.argv.includes('--rehearse');
const OUT = L.OUT;
const DLG = '[role="dialog"]';
const T = L.throwaway();
const KEY = L.readEnv('ANTHROPIC_API_KEY');
if (!KEY) throw new Error('ANTHROPIC_API_KEY not set in .env.local');
fs.mkdirSync(OUT, { recursive: true });
const mask = (s) => String(s).split(T.url).join('<URL>').split(T.host).join('<HOST>').split(T.token).join('<TOKEN>').split(KEY).join('<KEY>');
const day = L.day;
const P = (ms) => (REHEARSE ? Math.min(ms, 150) : ms);
let warnings = 0;

// ---------- overlays ----------
const OVERLAY = (host) => {
  const install = () => {
    if (!document.body || document.getElementById('demo-cursor')) return;
    const c = document.createElement('div');
    c.id = 'demo-cursor';
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M5 3L19 12L12 13L9 20L5 3Z" fill="white" stroke="black" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    c.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;width:24px;height:24px;left:-40px;top:-40px;transition:left .1s,top .1s;filter:drop-shadow(1px 1px 2px rgba(0,0,0,.3))';
    document.body.appendChild(c);
    document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    const b = document.createElement('div');
    b.id = 'demo-subtitle';
    b.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483646;text-align:center;padding:12px 24px;background:rgba(0,0,0,.75);color:#fff;font:500 16px -apple-system,"Segoe UI",sans-serif;pointer-events:none;opacity:0;transition:opacity .3s';
    document.body.appendChild(b);
    const s = document.createElement('style');
    s.textContent = 'input[placeholder^="libsql://"]{filter:blur(6px)}';
    document.head.appendChild(s);
    // Blur any element that shows the database host (sidebar storage line, toasts).
    const blur = () => {
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (n.nodeValue && n.nodeValue.includes(host) && n.parentElement && n.parentElement.id !== 'demo-subtitle') n.parentElement.style.filter = 'blur(5px)';
      }
    };
    blur();
    new MutationObserver(blur).observe(document.body, { subtree: true, childList: true, characterData: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
};

async function caption(page, text) {
  await page.evaluate((t) => { const b = document.getElementById('demo-subtitle'); if (!b) return; b.textContent = t || ''; b.style.opacity = t ? '1' : '0'; }, text);
  console.log('CAPTION', text || '(clear)');
  if (text) await page.waitForTimeout(P(1200));
}

async function moveTo(page, loc) {
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox().catch(() => null);
  if (box) { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: REHEARSE ? 2 : 12 }); await page.waitForTimeout(P(350)); }
}
async function click(page, loc, label, after = 900) {
  await loc.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  if (!(await loc.isVisible().catch(() => false))) throw new Error(`not visible: ${label}`);
  await moveTo(page, loc);
  await loc.click();
  await L.settle(page);
  await page.waitForTimeout(P(after));
}
async function type(page, loc, text, label, { slow = true } = {}) {
  await click(page, loc, label, 200);
  await loc.fill('');
  if (slow && !REHEARSE) await loc.pressSequentially(text, { delay: 35 }); else await loc.fill(text);
  await page.waitForTimeout(P(300));
}
async function nav(page, name) {
  const loc = page.locator(L.NAV).filter({ hasText: new RegExp('^\\s*' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$') }).first();
  if (await loc.isVisible().catch(() => false)) await moveTo(page, loc);
  const title = async () => (await page.locator('header').first().innerText().catch(() => '')).split('\n')[0].trim();
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.waitForFunction(({ sel, name }) => [...document.querySelectorAll(sel)].some((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ') === name), { sel: L.NAV, name }, { timeout: 60000 });
    const before = await title();
    await L.openView(page, name);
    await page.waitForTimeout(P(1500));
    const after = await title();
    // A reload landing just after the click resets the view: retry until the title moves.
    if (after !== before || before === name) return;
    console.log('nav retry', name, 'title still', before);
    await page.waitForLoadState('load'); await page.waitForTimeout(2000);
  }
  throw new Error('nav did not reach ' + name);
}
let PAGE;
async function scene(label, fn) {
  try { await fn(); console.log('OK   ', label); }
  catch (e) {
    warnings++; console.error('WARN ', label, '-', mask(e.message.split('\n')[0]));
    if (PAGE) await PAGE.screenshot({ path: path.join(OUT, 'warn-' + label.split(' ')[0] + '.png') }).catch(() => {});
  }
}

// ---------- chapter steps ----------
async function addTask(page, t) {
  await click(page, page.locator('main').getByRole('button', { name: 'Add task' }).first(), 'Add task');
  const d = page.locator(DLG).last();
  await type(page, d.getByPlaceholder('What needs to happen?'), t.name, 'task name');
  await type(page, d.getByPlaceholder('Assignee'), t.assignee, 'assignee');
  await page.keyboard.press('Escape').catch(() => {});
  await d.locator('input[type=date]').nth(1).fill(t.due);
  if (t.status) await d.locator('select').first().selectOption({ label: t.status });
  await click(page, d.getByRole('button', { name: 'Add task – New task' }), 'save task', 600);
  if (t.blocker) {
    const row = page.locator('main tbody tr', { hasText: t.name }).first();
    await click(page, row.getByText(t.name, { exact: true }).first(), 'open task');
    if ((await page.locator(DLG).count()) === 0) await row.getByText(t.name, { exact: true }).first().dblclick();
    const e = page.locator(DLG).last();
    await click(page, e.getByRole('button', { name: 'Blockers' }), 'Blockers');
    await type(page, page.getByPlaceholder('What is blocking this task?'), t.blocker, 'blocker');
    await click(page, page.getByRole('button', { name: 'Add blocker' }), 'Add blocker');
    await page.keyboard.press('Escape'); await L.settle(page);
    const up = page.locator(DLG).last().getByRole('button', { name: 'Update task – Edit task' });
    if (await up.isVisible().catch(() => false)) await click(page, up, 'Update task');
  }
}
async function addResource(page, first, last, email) {
  await click(page, page.locator('main').getByRole('button', { name: '+ Add resource', exact: true }), 'Add resource');
  const d = page.locator(DLG).last();
  await type(page, d.getByRole('textbox', { name: /^First name/ }), first, 'first name');
  await type(page, d.getByRole('textbox', { name: /^Last name/ }), last, 'last name');
  await type(page, d.locator('input[type=email]').first(), email, 'email');
  await click(page, d.getByRole('button', { name: 'Save resource' }), 'Save resource');
}
async function addMilestone(page, name, date) {
  await click(page, page.getByRole('button', { name: '+ New milestone', exact: true }), 'New milestone');
  const d = page.locator(DLG).last();
  await type(page, d.getByRole('textbox', { name: /^Name/ }), name, 'milestone name');
  await d.locator('input[type=date]').first().fill(date);
  await click(page, d.getByRole('button', { name: 'Save milestone' }), 'Save milestone');
}
async function addRaid(page, kind, title, owner, linkTask) {
  await click(page, page.locator('main').getByRole('button', { name: '+ Add RAID item', exact: true }), 'Add RAID item');
  const d = page.locator(DLG).last();
  await click(page, d.getByText(kind, { exact: true }).first(), kind, 300);
  await type(page, d.getByPlaceholder("What's the risk / assumption / issue / dependency?"), title, 'RAID title');
  if (owner) { await type(page, d.getByRole('combobox', { name: 'Owner' }), owner, 'owner'); await page.keyboard.press('Tab'); }
  if (linkTask) {
    await type(page, d.getByRole('combobox', { name: 'Linked tasks' }), linkTask, 'link'); await page.waitForTimeout(P(700));
    await click(page, page.getByRole('option', { name: new RegExp(linkTask) }).first(), 'link option', 400);
  }
  await click(page, d.getByRole('button', { name: 'Save', exact: true }), 'Save RAID');
  if (await page.locator(DLG).count()) throw new Error('RAID dialog did not close');
}
async function addAbsence(page, who, kind, from, to) {
  await click(page, page.locator('main').getByRole('button', { name: '+ Add absence', exact: true }), 'Add absence');
  const d = page.locator(DLG).last();
  await type(page, d.getByPlaceholder('Name (matches existing Task assignees)'), who, 'absence who'); await page.keyboard.press('Tab');
  await click(page, page.locator(DLG).last().getByText(kind, { exact: true }), kind, 300);
  await d.locator('input[type=date]').nth(0).fill(from);
  await d.locator('input[type=date]').nth(1).fill(to);
  await click(page, d.getByRole('button', { name: 'Save', exact: true }), 'Save absence');
}
async function skipTour(page, waitMs = 0) {
  const sk = page.getByRole('button', { name: 'Skip', exact: true });
  if (waitMs) await sk.first().waitFor({ state: 'visible', timeout: waitMs }).catch(() => {});
  if (await sk.first().isVisible().catch(() => false)) await click(page, sk.first(), 'Skip tour');
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }, locale: 'en-US', timezoneId: 'Europe/Berlin',
    ...(REHEARSE ? {} : { recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } }),
  });
  const page = await context.newPage();
  PAGE = page;
  await page.clock.install({ time: L.T0 });
  await page.addInitScript(() => { if (!localStorage.getItem('aipm-cockpit:settings')) localStorage.setItem('aipm-cockpit:settings', JSON.stringify({ tourSeen: true })); });
  await page.addInitScript(OVERLAY, T.host);
  await L.guardTurso(page, T.host);
  page.on('pageerror', (e) => console.log('PAGEERROR', mask(e.message.slice(0, 200))));
  try {
    await page.goto(L.BASE + '/');
    await page.getByText(/No projects yet/).first().waitFor({ timeout: 180000 }); await L.settle(page);
    await page.waitForTimeout(P(2500));

    // ---- Ch 2: connect ----
    await scene('2.2 Turso', async () => {
      await caption(page, 'Chapter 2 — Connect storage and Claude');
      await click(page, page.getByRole('button', { name: 'Set up Turso first' }), 'Set up Turso first');
      const d = page.locator(DLG).last();
      await click(page, d.getByRole('checkbox').nth(1), 'Turso checkbox');
      const ack = page.getByRole('button', { name: 'I understand', exact: true });
      if (await ack.isVisible().catch(() => false)) await click(page, ack, 'I understand');
      await caption(page, 'Paste URL and token, test, done.');
      await type(page, d.getByPlaceholder('libsql://your-db.turso.io'), T.url, 'url', { slow: false });
      await type(page, d.locator('input[type=password]').first(), T.token, 'token', { slow: false });
      await click(page, d.getByRole('button', { name: 'Test connection – Turso' }), 'Test connection', 5000);
      await d.getByLabel('Portfolio storage').selectOption({ index: 1 }); await page.waitForTimeout(P(1000));
      await click(page, d.getByRole('button', { name: 'Next', exact: true }), 'Next');
    });
    await scene('2.4 AI key', async () => {
      const d = page.locator(DLG).last();
      await caption(page, 'Paste once. Stored encrypted on this device.');
      await click(page, d.getByRole('checkbox').first(), 'AI switch');
      const ack = page.getByRole('button', { name: 'I understand', exact: true });
      if (await ack.isVisible().catch(() => false)) await click(page, ack, 'I understand');
      await type(page, d.getByPlaceholder('sk-ant-...'), KEY, 'key', { slow: false });
      await page.waitForTimeout(P(4000));
      for (let i = 0; i < 4; i++) {
        const fin = d.getByRole('button', { name: 'Finish', exact: true });
        if (await fin.count()) { await click(page, fin, 'Finish', 3000); break; }
        const nx = d.getByRole('button', { name: 'Next', exact: true });
        await click(page, (await nx.count()) ? nx : d.getByRole('button', { name: 'Skip', exact: true }), 'Next/Skip');
      }
      await caption(page, '');
    });

    // ---- Ch 3.1: create the project ----
    await scene('3.1 create project', async () => {
      await caption(page, 'Chapter 3 — Plan: one project per engagement.');
      await click(page, page.getByRole('button', { name: 'Create a new project' }), 'Create a new project');
      let d = page.locator(DLG).last();
      const skipAi = d.getByRole('button', { name: /Skip — set up manually/ });
      if (await skipAi.isVisible().catch(() => false)) { await click(page, skipAi, 'Skip AI setup'); d = page.locator(DLG).last(); }
      const storageSel = d.locator('select').filter({ has: page.locator('option[value="turso"]') });
      if (await storageSel.count()) {
        await storageSel.first().selectOption('turso'); await page.waitForTimeout(P(1000));
        if ((await page.locator(DLG).count()) > 1) await click(page, page.locator(DLG).last().getByRole('button', { name: 'Close', exact: true }).last(), 'Close config');
        d = page.locator(DLG).last();
      }
      await type(page, d.getByRole('textbox', { name: /^Project name/ }), 'Acme Website Relaunch', 'project name');
      await click(page, d.getByRole('button', { name: 'Next', exact: true }), 'Next');
      await click(page, d.getByRole('button', { name: /^Standard PM/ }), 'Standard PM');
      await click(page, d.getByRole('button', { name: 'Next', exact: true }), 'Next');
      console.log('FUNCTIONS', JSON.stringify(await d.getByRole('checkbox').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.closest('label')?.textContent || '').trim().slice(0, 30) + '=' + e.checked))));
      for (const f of ['Resources', 'Budget']) { const c = d.getByRole('checkbox', { name: f, exact: true }); if (!(await c.isChecked())) await click(page, c, f, 300); }
      const sc = d.getByRole('checkbox', { name: 'Include starter content' });
      if (await sc.isChecked()) await click(page, sc, 'starter content off', 300);
      await click(page, d.getByRole('button', { name: 'Create project' }), 'Create project', 6000);
      await skipTour(page);
    });

    if (process.argv.includes('--probe')) {
      console.log('NAV', JSON.stringify([...new Set(await L.navItems(page))]));
      console.log('DIALOGS', await page.locator(DLG).count(), mask((await page.locator(DLG).last().innerText().catch(() => '')).slice(0, 200)).replace(/\n+/g, ' | '));
      await page.screenshot({ path: path.join(OUT, 'probe-after-create.png') });
      throw new Error('probe stop');
    }
    // ---- Ch 2.5: first prompt ----
    await scene('2.5 chat', async () => {
      await caption(page, 'The assistant works on every page.');
      await nav(page, 'AI Assistant');
      const consent = page.locator('main').getByRole('button', { name: /enable chat/i });
      if (await consent.isVisible().catch(() => false)) {
        const cb = page.locator('main').getByRole('checkbox');
        for (let i = 0; i < await cb.count(); i++) if (!(await cb.nth(i).isChecked())) await click(page, cb.nth(i), 'consent box', 300);
        await click(page, consent, 'enable chat');
      }
      const box = page.locator('main textarea, main [contenteditable="true"]').last();
      await type(page, box, 'What can you help me with in this app? Three short bullet points.', 'prompt');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(REHEARSE ? 20000 : 25000); await L.settle(page);
      await caption(page, '');
    });

    // ---- Ch 3.2–3.6 ----
    await scene('3.2 tasks', async () => {
      await caption(page, 'Tasks in a table: fast entry, sort, filter.');
      await nav(page, 'Open Points');
      await addTask(page, { name: 'Kick-off workshop', assignee: 'Jane Doe', due: day(2), status: 'Done' });
      await addTask(page, { name: 'Wireframes', assignee: 'Jane Doe', due: day(10) });
      await addTask(page, { name: 'Content audit', assignee: 'Tom Berg', due: day(5), status: 'In Progress' });
      await addTask(page, { name: 'API integration', assignee: 'Tom Berg', due: day(14) });
      await addTask(page, { name: 'Launch checklist', assignee: 'Raj Patel', due: day(30), blocker: 'Waiting for the hosting contract' });
      await page.waitForTimeout(P(1500));
    });
    await scene('3.3 board', async () => {
      await caption(page, 'Same tasks as a board…');
      await click(page, page.getByText('Board', { exact: true }).first(), 'Board', 1200);
      const card = page.locator('main').getByRole('button', { name: 'Wireframes', exact: true }).first();
      const col = page.locator('main [aria-label="In Progress"]').first();
      await moveTo(page, card);
      await card.dragTo(col); await L.settle(page); await page.waitForTimeout(P(1500));
      await caption(page, '…or as swimlanes.');
      await click(page, page.getByText('Swimlanes', { exact: true }).first(), 'Swimlanes', 2000);
      await click(page, page.getByText('Table', { exact: true }).first(), 'Table', 500);
    });
    await scene('3.5 milestones', async () => {
      await caption(page, 'Milestones mark the dates that matter.');
      await nav(page, 'Milestones');
      await addMilestone(page, 'Design sign-off', day(12));
      await addMilestone(page, 'Go-live', day(45));
    });
    await scene('3.4 gantt', async () => {
      await caption(page, '…and everything on a timeline.');
      await nav(page, 'Gantt'); await page.waitForTimeout(P(2500));
    });
    await scene('3.6 change', async () => {
      await caption(page, 'Track scope changes and their impact.');
      await nav(page, 'Changes');
      await click(page, page.locator('main').getByRole('button', { name: '+ Add change', exact: true }), 'Add change');
      const d = page.locator(DLG).last();
      await type(page, d.getByRole('textbox', { name: /^Title/ }), 'Add multilingual support', 'change title');
      await d.locator('select').first().selectOption({ label: 'Scope' });
      await d.locator('input[type=number]').first().fill('10');
      await click(page, d.getByRole('button', { name: 'Save', exact: true }), 'Save change');
    });

    // ---- Ch 4 ----
    await scene('4.1 directory', async () => {
      await caption(page, 'Chapter 4 — Everyone on the project, in one directory.');
      await nav(page, 'Resources'); await nav(page, 'Directory');
      await addResource(page, 'Jane', 'Doe', 'jane.doe@acme.example');
      await addResource(page, 'Tom', 'Berg', 'tom.berg@acme.example');
      await addResource(page, 'Raj', 'Patel', 'raj.patel@acme.example');
      await page.waitForTimeout(P(1500));
    });
    await scene('4.2 absences', async () => {
      await caption(page, 'Absences: vacation, training, and more.');
      await addAbsence(page, 'Jane Doe', 'Vacation', day(14), day(25));
      await addAbsence(page, 'Raj Patel', 'Training', day(7), day(9));
      await nav(page, 'Calendar'); await page.waitForTimeout(P(2000));
    });
    await scene('4.3 planning', async () => {
      await caption(page, 'Plan who works how much, when.');
      await nav(page, 'Planning');
      const u = page.getByRole('spinbutton', { name: /Utilization for Tom Berg in 2026-11/ });
      await type(page, u, '130', 'Tom 130%'); await u.press('Tab'); await L.settle(page); await page.waitForTimeout(P(1500));
    });
    await scene('4.4 workload', async () => {
      await caption(page, 'See overload before it happens.');
      await nav(page, 'Workload'); await page.waitForTimeout(P(3000));
    });

    // ---- Ch 5 ----
    await scene('5 RAID', async () => {
      await caption(page, 'Chapter 5 — Risks, assumptions, issues, dependencies.');
      await nav(page, 'RAID');
      await addRaid(page, 'Risk', 'Vendor API delayed', 'Raj Patel', 'API integration');
      await caption(page, 'Issues that need action now.');
      await addRaid(page, 'Issue', 'Staging server down', '', '');
      await caption(page, 'Assumptions and dependencies too.');
      await addRaid(page, 'Assumption', 'Content is delivered by the client', 'Jane Doe', '');
      await addRaid(page, 'Dependency', 'Hosting contract signed', 'Raj Patel', '');
      await caption(page, 'Linked RAID items show on the task.');
      await nav(page, 'Open Points'); await page.waitForTimeout(P(2500));
    });

    // ---- Ch 6 ----
    await scene('6.1 functions', async () => {
      await caption(page, 'Chapter 6 — Turn on what you need.');
      await nav(page, 'Projects');
      await click(page, page.locator('main').getByRole('button', { name: 'Edit project', exact: true }), 'Edit project', 1500);
      const fn = page.getByRole('tab', { name: /Functions/ }).or(page.getByRole('button', { name: /^Functions/ })).or(page.getByText(/^\d*\.?\s*Functions$/));
      if (await fn.count()) await click(page, fn.first(), 'Functions');
      await click(page, page.getByRole('checkbox', { name: 'Time bookings', exact: true }), 'Time bookings', 1500);
      const on = page.getByRole('button', { name: /^Turn on/ }).first();
      if (await on.isVisible().catch(() => false)) await click(page, on, 'Turn on', 1500);
      const save = page.locator(DLG).last().getByRole('button', { name: /^(Save|Save changes|Done)$/ }).last();
      if (await save.isVisible().catch(() => false)) await click(page, save, 'Save project'); else await page.keyboard.press('Escape');
    });
    await scene('6.3 budget', async () => {
      await caption(page, 'Budget: four steps, each ticks itself off.');
      await nav(page, 'Budget'); await page.waitForTimeout(P(2500));
      await click(page, page.locator('main').getByRole('button', { name: 'Manage roles' }), 'Manage roles', 2500);
      await nav(page, 'Budget');
      await click(page, page.locator('main').getByRole('button', { name: '+ Add bucket', exact: true }), 'Add bucket', 1500);
      const d = page.locator(DLG).last();
      const nm = d.getByRole('textbox').first();
      if (await nm.isVisible().catch(() => false)) await type(page, nm, 'Phase 1 – Design', 'bucket name');
      const sv = d.getByRole('button', { name: /^Save/ }).last();
      if (await sv.isVisible().catch(() => false)) await click(page, sv, 'Save bucket', 1500); else await page.keyboard.press('Escape');
    });

    // ---- Ch 7: three weeks later ----
    await scene('7 dashboard', async () => {
      await caption(page, 'Chapter 7 — Three weeks later…');
      await page.clock.setSystemTime(new Date(L.T0.getTime() + 21 * 86400000));
      await page.reload(); await page.waitForTimeout(P(5000)); await L.settle(page);
      await nav(page, 'Dashboard');
      await caption(page, 'Next actions: what needs you first.');
      await page.waitForTimeout(P(3000));
      await page.evaluate(() => { location.hash = '#actions'; }); await page.waitForTimeout(P(1500)); await L.settle(page);
      await page.waitForTimeout(P(3000));
      await caption(page, 'Insights spot patterns you would miss.');
      await page.evaluate(() => { location.hash = '#insights'; }); await page.waitForTimeout(P(1500)); await L.settle(page);
      await page.waitForTimeout(P(3500));
    });
    await scene('7.4 demo trends', async () => {
      await caption(page, 'Trends over weeks — shown on the demo project.');
      await nav(page, 'Projects');
      await click(page, page.locator('main').getByRole('button', { name: /Explore a demo project/ }), 'Explore a demo project', 15000);
      await skipTour(page, 30000);
      if (await page.getByText('changed in another tab').count()) throw new Error('"changed in another tab" banner showed');
      await page.evaluate(() => { location.hash = '#trends'; }); await page.waitForTimeout(P(2000)); await L.settle(page);
      await page.waitForTimeout(P(4000));
    });

    // ---- Ch 8 ----
    await scene('8 help', async () => {
      await skipTour(page);
      await caption(page, 'Help has the walkthrough, a demo and this guide.');
      await click(page, page.getByRole('button', { name: /^Help/ }).first(), 'Help', 3500);
      await page.keyboard.press('Escape');
      await caption(page, '');
      await page.waitForTimeout(P(2000));
    });
  } catch (e) {
    warnings++; console.error('DEMO ERROR', mask(e.message.split('\n')[0]));
  } finally {
    const video = page.video();
    await context.close();
    if (video) {
      const dest = path.join(OUT, 'aipm-cockpit-getting-started.webm');
      fs.copyFileSync(await video.path(), dest);
      console.log('VIDEO', dest);
    }
    await browser.close();
    console.log('WARNINGS', warnings);
  }
})();
