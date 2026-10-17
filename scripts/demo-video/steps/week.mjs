// §715 demo recorder: the demo week — the prologue and Monday to Friday, one array of steps per day, in
// the order of docs/superpowers/specs/2026-10-16-demo-week-story-design.md, "The week". The big video
// joins them; each chapter records one day after replaying the days before it. See ../README.md.
import { step } from './step.mjs';
import { waitForAi } from '../ai-wait.mjs';
import * as L from '../lib.mjs';
import { caption, click, moveTo, nav, pace, type } from '../ui.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DAY_FACTS, DEMO_CRM_TASK, DEMO_DUPLICATE_PAIRS } from '../week-story.mjs';

const DLG = '[role="dialog"]';
const main = (ctx) => ctx.page.locator('main');
const noop = async () => {};

// ---- helpers shared by the days ----

/** Opens a task's editor from the Open Points table by its name. */
async function openTask(ctx, name) {
  await nav(ctx, 'Open Points');
  const row = main(ctx).locator('tbody tr', { hasText: name }).first();
  await click(ctx, row.getByRole('button', { name, exact: true }).first(), `open ${name}`);
  return ctx.page.locator(DLG).last();
}

/** Saves an open task editor. */
async function saveTask(ctx) {
  const up = ctx.page.locator(DLG).last().getByRole('button', { name: 'Update task – Edit task' });
  await click(ctx, up, 'Update task');
}

/** Next actions, with every tier expanded so a row further down can be reached. */
async function nextActions(ctx) {
  // Next actions is a child of Dashboard in the sidebar, shown only while that group is open.
  await nav(ctx, 'Dashboard');
  await nav(ctx, 'Next actions');
  const more = main(ctx).getByRole('button', { name: /– Show \d+ more$/ });
  for (let i = 0; i < 3 && (await more.count()); i++) await click(ctx, more.first(), 'show more', 400);
}

/** "Draft message" on a stakeholder-update row: the app fills the update template and hands it to the
 *  mail client as a mailto: link. The page must stay where it is. */
async function draftMessage(ctx, who) {
  await nextActions(ctx);
  const before = ctx.page.url();
  await click(ctx, main(ctx).getByRole('button', { name: `Draft message – Update stakeholder: ${who}`, exact: true }), `Draft message ${who}`, 1500);
  if (ctx.page.url() !== before) throw new Error('Draft message navigated the page away');
}

/** The AI Assistant: a starter chip or a typed prompt, then the reply, waited for by the send control. */
async function chat(ctx, { chip, prompt }) {
  await nav(ctx, 'AI Assistant');
  // The thread is a role=log list, one item per message: the reply is the item after the prompt's.
  const items = main(ctx).getByRole('log').locator(':scope > li');
  const before = await items.count();
  if (chip) await click(ctx, main(ctx).getByRole('button', { name: chip, exact: true }).first(), chip, 300);
  else {
    const box = main(ctx).locator('textarea').last();
    await type(ctx, box, prompt, 'prompt');
    await ctx.page.keyboard.press('Enter');
  }
  await waitForAi(ctx, {
    busy: main(ctx).getByRole('button', { name: /^Stop( generating)?$/ }).first(),
    done: items.nth(before + 1),
    label: chip ?? 'chat',
  });
  await pace(ctx, 3000);
}

// ---- prologue (end of chapter 2): the wizard to its last step with Claude's proposal, then cancel ----
const BRIEF = 'A customer identity platform for an online retailer: registration, MFA and GDPR erasure, synced to the CRM. Five people, March to February.';

/** The new-project wizard: a one-line brief, Claude's proposal filling the details, a walk to the last
 *  step — and Cancel, because the week runs on the demo project instead. */
export const wizardProposal = step('wizard-proposal', {
  ai: true,
  trigger: async (ctx) => ctx.page.getByRole('button', { name: 'Create a new project' }),
  run: async (ctx) => {
    const page = ctx.page;
    if (await page.locator(DLG).count()) await page.keyboard.press('Escape');
    await caption(ctx, 'A new project: describe it in a sentence, and Claude proposes the setup.');
    await click(ctx, page.getByRole('button', { name: 'Create a new project' }), 'Create a new project', 1000);
    const d = page.locator(DLG).last();
    await type(ctx, d.getByRole('textbox', { name: 'Describe your project' }), BRIEF, 'brief');
    await click(ctx, d.getByRole('button', { name: 'Generate with AI' }), 'Generate with AI', 300);
    await waitForAi(ctx, {
      busy: d.getByRole('button', { name: 'Generate with AI' }),
      done: d.getByRole('button', { name: 'Next', exact: true }),
      label: 'project proposal',
    });
    await pace(ctx, 3000);
  },
  check: async (ctx) => ((await ctx.page.locator(DLG).last().getByRole('textbox', { name: /Project name/ }).inputValue().catch(() => '')) ? null : 'no proposal'),
  after: async (ctx) => {
    const d = ctx.page.locator(DLG).last();
    for (const what of ['template', 'functions']) await click(ctx, d.getByRole('button', { name: 'Next', exact: true }), `Next (${what})`, 2000);
    await caption(ctx, 'The last step creates it. Here we open the demo project instead.');
    await click(ctx, d.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel', 1000);
  },
  replay: noop,
});
export const PROLOGUE = [wizardProposal];

// ---- shared across days and clips ----

/** Dashboard → digest → Generate now; the narrative is in when the button reads "Generate now" again. */
export const digestGenerate = step('digest-generate', {
  ai: true,
  trigger: async (ctx) => { await nav(ctx, 'Dashboard'); return main(ctx).getByRole('button', { name: 'Generate now', exact: true }).first(); },
  run: async (ctx) => {
    await nav(ctx, 'Dashboard');
    await caption(ctx, 'The digest: Claude sums up where the project stands.');
    await click(ctx, main(ctx).getByRole('button', { name: 'Generate now', exact: true }).first(), 'Generate now', 300);
    await waitForAi(ctx, {
      busy: main(ctx).getByRole('button', { name: /^Stop/ }).first(),
      done: main(ctx).getByRole('button', { name: 'Generate now', exact: true }).first(),
      label: 'digest',
    });
    await pace(ctx, 4000);
  },
  // The innermost element holding both the card title and its button is the card; with a narrative
  // its text runs to several hundred characters, without one to the one-line summary.
  check: async (ctx) => {
    const card = main(ctx).locator('div, section').filter({ hasText: 'Weekly status digest' })
      .filter({ has: ctx.page.getByRole('button', { name: 'Generate now', exact: true }) }).last();
    return (await card.innerText().catch(() => '')).length > 250 ? null : 'no narrative';
  },
  replay: noop,
});


// ---- Monday — a milestone slipped ----
export const MONDAY = [
  step('mon-dashboard', {
    run: async (ctx) => {
      await nav(ctx, 'Dashboard');
      await caption(ctx, 'Do this first: the MVP target is overdue.');
      await moveTo(ctx, main(ctx).getByRole('button', { name: /^Open – Do this first – / }).first());
      await pace(ctx, 2500);
      await caption(ctx, 'Since Friday: one RAID item added, one task newly overdue.');
      await moveTo(ctx, main(ctx).getByText('Since you last looked').first());
      await pace(ctx, 3000);
    },
  }),
  digestGenerate,
  step('mon-next-actions', {
    run: async (ctx) => {
      await caption(ctx, 'Next actions: now, soon, and what to keep an eye on.');
      await nextActions(ctx);
      await pace(ctx, 3500);
    },
  }),
  step('analyze-next-actions', {
    ai: true,
    trigger: async (ctx) => { await nextActions(ctx); return main(ctx).getByRole('button', { name: 'Analyze with AI', exact: true }); },
    run: async (ctx) => {
      await nextActions(ctx);
      await caption(ctx, 'Analyze with AI: what needs you first, and why.');
      await click(ctx, main(ctx).getByRole('button', { name: 'Analyze with AI', exact: true }), 'Analyze with AI', 300);
      await waitForAi(ctx, {
        busy: ctx.page.getByRole('status').filter({ hasText: 'Analyzing' }),
        // The app's own error line also ends the wait: the step's check then sees no summary and retries.
        done: main(ctx).getByText('AI suggestions').or(main(ctx).getByText("Couldn't analyze")).first(),
        label: 'analyze',
      });
      await pace(ctx, 4000);
    },
    check: async (ctx) => ((await main(ctx).getByText('Focus now').count()) ? null : 'no focus summary'),
    // Read, then put away, so the list below is back in view for the next step.
    after: async (ctx) => {
      const close = main(ctx).getByRole('button', { name: 'Dismiss AI suggestions', exact: true });
      if (await close.isVisible().catch(() => false)) await click(ctx, close, 'Dismiss AI suggestions', 500);
    },
    replay: noop,
  }),
  step('crm-blocker', {
    run: async (ctx) => {
      await caption(ctx, 'The CRM task: record what blocks it and move it to Thursday.');
      const d = await openTask(ctx, DEMO_CRM_TASK);
      await click(ctx, d.getByRole('button', { name: 'Blockers' }), 'Blockers');
      await type(ctx, ctx.page.getByPlaceholder('What is blocking this task?'), 'CRM API rejects erasure calls', 'blocker');
      await click(ctx, ctx.page.getByRole('button', { name: 'Add blocker' }), 'Add blocker');
      await ctx.page.keyboard.press('Escape');
      await L.settle(ctx.page);
      await ctx.page.locator(DLG).last().locator('input[type=date]').nth(1).fill('2026-09-24');
      await saveTask(ctx);
    },
  }),
  step('knowledge-crm', {
    run: async (ctx) => {
      await nav(ctx, 'Knowledge');
      await caption(ctx, 'Knowledge: the CRM interface decision from design sign-off.');
      await type(ctx, main(ctx).getByPlaceholder('Search knowledge'), 'CRM', 'search knowledge');
      await moveTo(ctx, main(ctx).getByText('CRM interface decision (design sign-off)').first());
      await pace(ctx, 3000);
    },
  }),
  step('draft-elena', {
    run: async (ctx) => {
      await caption(ctx, 'The sponsor must hear about the slip: Draft message fills the update template.');
      await draftMessage(ctx, 'Elena Fischer');
    },
  }),
  step('chat-update-elena', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'AI Assistant'); return main(ctx).getByRole('button', { name: 'Stakeholder update', exact: true }).first(); },
    run: async (ctx) => {
      await caption(ctx, 'Or let the assistant write the update from the project as it stands.');
      await chat(ctx, { chip: 'Stakeholder update' });
    },
    replay: noop,
  }),
];

// ---- Tuesday — re-plan ----
const REPLAN_CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'replan-forecast.csv');
const BUCKET = 'Identity Platform – T&M';
const CONNECTOR = 'Add a CRM provisioning connector';
const DEMO_TASK = 'MVP demo to the customer';

/** Deletes a task through its editor; the app asks with a native confirm, which is accepted. */
async function deleteTask(ctx, name) {
  const d = await openTask(ctx, name);
  ctx.page.once('dialog', (dlg) => dlg.accept());
  await click(ctx, d.locator('button', { hasText: /^Delete$/ }).first(), `delete ${name}`, 1200);
}

/** The per-item "Ask Claude" popover on a register row: the instruction, then Claude's preview. The
 *  step's check reads the preview; its `after` applies it. */
async function askClaude(ctx, view, item, instruction) {
  // A retry finds the previous popover still open: close it first.
  if (await ctx.page.getByPlaceholder(/^e\.g\./).count()) await ctx.page.keyboard.press('Escape');
  await nav(ctx, view);
  await click(ctx, main(ctx).getByRole('button', { name: `Ask Claude – ${item}`, exact: true }).first(), `Ask Claude ${item}`, 500);
  const box = ctx.page.getByPlaceholder(/^e\.g\./).last();
  await type(ctx, box, instruction, 'instruction');
  await ctx.page.keyboard.press('Enter');
  await waitForAi(ctx, {
    busy: ctx.page.getByText('Claude is working out the changes…').first(),
    // "No changes to apply" may come prefixed ("Claude needs more detail: …"); either ends the call.
    done: ctx.page.getByText(/Claude will make these changes:|No changes to apply/).first(),
    label: `ask-claude ${item}`,
  });
  await pace(ctx, 2500);
}
const askClaudeCheck = async (ctx) => ((await ctx.page.getByRole('button', { name: 'Apply', exact: true }).count()) ? null : 'no changes');
const askClaudeApply = async (ctx) => click(ctx, ctx.page.getByRole('button', { name: 'Apply', exact: true }).last(), 'Apply', 1500);

/** Deduplicate & unify on Open Points: Claude proposes merges; the check counts them, `after` merges. */
export const dedup = step('dedup', {
  ai: true,
  trigger: async (ctx) => { await nav(ctx, 'Open Points'); return main(ctx).getByRole('button', { name: 'Deduplicate & unify', exact: true }).first(); },
  run: async (ctx) => {
    await nav(ctx, 'Open Points');
    await caption(ctx, 'Deduplicate & unify: Claude finds the follow-ups logged twice.');
    if (await ctx.page.locator(DLG).count()) await ctx.page.keyboard.press('Escape');
    await click(ctx, main(ctx).getByRole('button', { name: 'Deduplicate & unify', exact: true }).first(), 'Deduplicate & unify', 300);
    await waitForAi(ctx, {
      busy: ctx.page.locator(`${DLG} [aria-busy="true"]`).first(),
      done: ctx.page.locator(DLG).getByRole('button', { name: /^(Merge selected|Close)$/ }).first(),
      label: 'dedup',
    });
    await pace(ctx, 3000);
  },
  check: async (ctx) => ((await ctx.page.getByRole('checkbox', { name: /^Include this merge – / }).count()) ? null : 'no pairs'),
  after: async (ctx) => click(ctx, ctx.page.getByRole('button', { name: 'Merge selected', exact: true }), 'Merge selected', 2000),
  // The fixed outcome: the second task of each remaining pair goes, as in E's applyDemoWeek.
  replay: async (ctx) => { for (const [, second] of DEMO_DUPLICATE_PAIRS.slice(1)) await deleteTask(ctx, second); },
});

// ---- Tuesday — re-plan ----
export const TUESDAY = [
  step('board-crm-in-progress', {
    run: async (ctx) => {
      await nav(ctx, 'Open Points');
      await caption(ctx, 'Work restarts with the blocker known: drag the CRM task to In Progress.');
      await click(ctx, main(ctx).getByRole('radio', { name: 'Board', exact: true }), 'Board', 1200);
      const card = main(ctx).getByRole('button', { name: DEMO_CRM_TASK, exact: true }).first();
      await moveTo(ctx, card);
      await card.dragTo(main(ctx).locator('[aria-label="In Progress"]').first());
      await L.settle(ctx.page);
      await pace(ctx, 1500);
      await click(ctx, main(ctx).getByRole('radio', { name: 'Table', exact: true }), 'Table', 800);
    },
  }),
  step('delete-duplicate', {
    run: async (ctx) => {
      await caption(ctx, 'Two people logged the same follow-up on Friday: delete one by hand.');
      await deleteTask(ctx, DEMO_DUPLICATE_PAIRS[0][0]);
    },
  }),
  dedup,
  step('change-connector', {
    run: async (ctx) => {
      await nav(ctx, 'Changes');
      await caption(ctx, 'A change request: replace the custom CRM push with a connector.');
      await click(ctx, main(ctx).getByRole('button', { name: '+ Add change', exact: true }), 'Add change', 1000);
      const d = ctx.page.locator(DLG).last();
      await type(ctx, d.getByRole('textbox', { name: /^Title/ }), CONNECTOR, 'change title');
      await d.getByRole('combobox', { name: 'Type', exact: true }).selectOption('Scope');
      await d.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Under Review');
      await d.getByRole('combobox', { name: 'Impact', exact: true }).selectOption('Medium');
      await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save change');
    },
  }),
  step('impact-ask-claude', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'Changes'); return main(ctx).getByRole('button', { name: `Ask Claude – ${CONNECTOR}`, exact: true }).first(); },
    run: async (ctx) => {
      await caption(ctx, 'Ask Claude to write the impact.');
      await askClaude(ctx, 'Changes', CONNECTOR, 'Set the impact description to: Licence cost and about one week of integration work; removes the failing custom CRM sync.');
    },
    check: askClaudeCheck,
    after: askClaudeApply,
    replay: noop,
  }),
  step('draft-maya', {
    run: async (ctx) => {
      await caption(ctx, 'Maya waits on the MFA change: Draft message.');
      await draftMessage(ctx, 'Maya Patel');
    },
  }),
  step('chat-update-maya', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'AI Assistant'); return main(ctx).locator('textarea').last(); },
    run: async (ctx) => {
      await caption(ctx, 'Or the assistant writes Maya an update on the MFA change and the re-plan.');
      await chat(ctx, { prompt: 'Draft a stakeholder update for Maya Patel: where the MFA change request stands, and how the MVP is being re-planned.' });
    },
    replay: noop,
  }),
  step('milestone-redemo', {
    run: async (ctx) => {
      await nav(ctx, 'Milestones');
      await caption(ctx, 'A new milestone for the customer demo: MVP re-demo, Friday 2 October.');
      await click(ctx, ctx.page.getByRole('button', { name: '+ New milestone', exact: true }), 'New milestone', 1000);
      const d = ctx.page.locator(DLG).last();
      await type(ctx, d.getByRole('textbox', { name: /^Name/ }), 'MVP re-demo', 'milestone name');
      await d.locator('input[type=date]').first().fill('2026-10-02');
      await click(ctx, d.getByLabel(`#25 ${DEMO_TASK}`), 'link the demo task', 300);
      await click(ctx, d.getByRole('button', { name: 'Save milestone', exact: true }), 'Save milestone');
      // The demo task leaves the MVP target, so the moved target has no task ending after it.
      await click(ctx, main(ctx).getByRole('button', { name: 'MVP target', exact: true }).first(), 'open MVP target', 800);
      const m = ctx.page.locator(DLG).last();
      await click(ctx, m.getByLabel(`#25 ${DEMO_TASK}`), 'unlink the demo task', 300);
      await click(ctx, m.getByRole('button', { name: /^Save/ }).last(), 'Save milestone');
      await caption(ctx, 'The demo task moves to the new date.');
      const t = await openTask(ctx, DEMO_TASK);
      await t.locator('input[type=date]').nth(1).fill('2026-10-02');
      await saveTask(ctx);
    },
  }),
  // ★ On the demo task, not the milestone: a milestone's Ask Claude answers "needs more detail" to every
  // description edit (an app defect reported with §715 A, 2026-10-17); the task carries the same story.
  step('redemo-ask-claude', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'Open Points'); return main(ctx).getByRole('button', { name: `Ask Claude – ${DEMO_TASK}`, exact: true }).first(); },
    run: async (ctx) => {
      await caption(ctx, 'Ask Claude to describe the re-run of the demo.');
      await askClaude(ctx, 'Open Points', DEMO_TASK, 'Set the description to: The MVP demo to the customer, re-run on 2 October once provisioning to the CRM works end to end.');
    },
    check: askClaudeCheck,
    after: askClaudeApply,
    replay: noop,
  }),
  step('bucket-planned-hours', {
    run: async (ctx) => {
      await nav(ctx, 'Budget');
      await caption(ctx, `The bucket ${BUCKET}: planned hours per person.`);
      await moveTo(ctx, main(ctx).getByRole('button', { name: `Edit bucket – ${BUCKET}`, exact: true }));
      await pace(ctx, 3000);
    },
  }),
  step('budget-follow-plan-off', {
    run: async (ctx) => {
      await nav(ctx, 'Budget');
      await caption(ctx, 'Budget hours follow the plan; an imported re-plan needs them free: switch it off.');
      const toggle = main(ctx).getByRole('button', { name: 'Budget hours follow plan', exact: true });
      if ((await toggle.getAttribute('aria-pressed')) !== 'false') await click(ctx, toggle, 'Budget hours follow plan', 1500);
      if ((await toggle.getAttribute('aria-pressed')) !== 'false') throw new Error('Budget hours follow plan is still on');
    },
  }),
  step('forecast-import', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'Budget'); return main(ctx).getByRole('button', { name: `Import forecast… – ${BUCKET}`, exact: true }); },
    run: async (ctx) => {
      await caption(ctx, "The team's re-plan arrives as a spreadsheet: Import forecast, and Claude maps the columns.");
      if (await ctx.page.locator(DLG).count()) await ctx.page.keyboard.press('Escape');
      await click(ctx, main(ctx).getByRole('button', { name: `Import forecast… – ${BUCKET}`, exact: true }), 'Import forecast', 800);
      const d = ctx.page.locator(DLG).last();
      await d.locator('input[type=file]').setInputFiles(REPLAN_CSV);
      await pace(ctx, 1500);
      await click(ctx, d.getByRole('button', { name: 'Ask Claude', exact: true }), 'Ask Claude', 300);
      await waitForAi(ctx, {
        busy: d.locator('[aria-busy="true"]').first(),
        done: d.getByText(/^Claude proposed these columns/).or(d.getByText(/^Claude (could not|'s column mapping)/)).first(),
        label: 'forecast import',
      });
      await pace(ctx, 2500);
    },
    check: async (ctx) => ((await ctx.page.locator(DLG).last().getByText(/^Claude proposed these columns/).count()) ? null : 'no mapping'),
    after: async (ctx) => {
      const d = ctx.page.locator(DLG).last();
      // Claude's mapping fills the columns in; a confirm button shows only when the app asks for one.
      const confirm = d.getByRole('button', { name: /^These columns are right/ });
      if (await confirm.isVisible().catch(() => false)) await click(ctx, confirm, 'confirm columns', 1500);
      // Apply stays disabled until the preview of what will be written has been shown.
      const preview = d.getByRole('button', { name: 'Show preview', exact: true });
      if (await preview.isVisible().catch(() => false)) await click(ctx, preview, 'Show preview', 2500);
      await click(ctx, d.getByRole('button', { name: /^Apply/ }).last(), 'Apply import', 2000);
    },
    // E's applyDemoWeek leaves the bucket's hours as they are, so the replay does too.
    replay: noop,
  }),
];

// ---- Wednesday — people ----
export const WEDNESDAY = [
  step('discipline-role'),
  step('new-member'),
  step('noah-vacation'),
  step('maya-util'),
  step('planning-lukas'),
  step('plan-with-ai', { ai: true }),
  step('swimlane-lukas'),
];

// ---- Thursday — risks, stakeholders, money ----
export const THURSDAY = [
  step('gdpr-owner'),
  step('mitigation-ask-claude', { ai: true }),
  step('licence-risk'),
  step('dpo-stakeholder'),
  step('raci-dpo'),
  step('suggest-raci', { ai: true }),
  step('map-dpo'),
  step('steering-approve'),
  step('steering-draft', { ai: true }),
  step('connector-bucket'),
  step('licence-task'),
  step('chat-licence-task', { ai: true }),
  step('gantt-mvp-target'),
];

// ---- Friday — close the week ----
export const FRIDAY = [
  step('crm-done'),
  step('friday-hero'),
  step('draft-dpo'),
  step('chat-update-dpo', { ai: true }),
  step('insights'),
  step('insight-recommendation', { ai: true }),
  step('split-pilot-task'),
  step('optimize-wbs', { ai: true }),
  step('trends-activity-history'),
  digestGenerate,
  step('help'),
];

export const DAYS = Object.freeze({ mon: MONDAY, tue: TUESDAY, wed: WEDNESDAY, thu: THURSDAY, fri: FRIDAY });

const PREVIOUS = { tue: 'mon', wed: 'tue', thu: 'wed', fri: 'thu' };

/** Moves the page clock to 08:30 on `day` (in the big video, between two days); a rehearsal first
 *  checks the day that ends against DAY_FACTS. */
export const goTo = Object.freeze(Object.fromEntries(
  ['tue', 'wed', 'thu', 'fri'].map((d) => [d, step(`day-${d}`, {
    run: async (ctx) => {
      if (ctx.checkDay) await ctx.checkDay(PREVIOUS[d]);
      await ctx.goToDay(d);
    },
  })]),
));

// DAY_FACTS speaks workspace collections; the Turso tables are named after them, except budgets.
const TABLE = { tasks: 'tasks', milestones: 'milestones', raid: 'raid', changes: 'changes', stakeholders: 'stakeholders', resources: 'resources', budgets: 'budget_buckets' };

/** What the database says against DAY_FACTS[day] for the project: one line per mismatch. */
export async function checkDayFacts(projectId, day) {
  const wrong = [];
  for (const f of DAY_FACTS[day]) {
    const q = (c) => '"' + c.replace(/"/g, '""') + '"';
    const rows = await L.query(
      `SELECT ${q(f.field)} FROM ${q(TABLE[f.collection])} WHERE project_id = ? AND ${q(f.key)} = ?`,
      [{ type: 'text', value: projectId }, { type: 'text', value: String(f.value) }],
    );
    const got = rows[0]?.[0]?.value ?? (rows.length ? null : '<no row>');
    const want = f.expected === null ? null : String(f.expected);
    if (got !== want) wrong.push(`${day} ${f.collection} ${f.value}.${f.field}: ${got} ≠ ${want}`);
  }
  return wrong;
}

/** The demo opens: a short look at the Dashboard, the closing step of chapter 2. */
export const demoOpens = step('demo-opens', {
  run: async (ctx) => {
    await nav(ctx, 'Dashboard');
    await caption(ctx, 'The demo: Northwind\'s customer identity platform. Its MVP was due last Friday.');
    await pace(ctx, 4000);
  },
});
