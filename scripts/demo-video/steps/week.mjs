// §715 demo recorder: the demo week — the prologue and Monday to Friday, one array of steps per day, in
// the order of docs/superpowers/specs/2026-10-16-demo-week-story-design.md, "The week". The big video
// joins them; each chapter records one day after replaying the days before it. See ../README.md.
import { step } from './step.mjs';
import { waitForAi } from '../ai-wait.mjs';
import * as L from '../lib.mjs';
import { caption, choose, click, holdVoice, moveTo, nav, pace, type } from '../ui.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DAY_FACTS, DEMO_CRM_TASK, DEMO_DPO, DEMO_DUPLICATE_PAIRS, DEMO_GDPR_ISSUE, DEMO_LICENCE_RISK, DEMO_MAYA_RELIEVED_HOURS, DEMO_NEW_MEMBER,
} from '../week-story.mjs';

// Visible dialogs only: a closed modal can stay in the DOM after the one on screen.
export const DLG = '[role="dialog"]:visible';
export const main = (ctx) => ctx.page.locator('main');
export const noop = async () => {};
/** The app's page-level toast (role=status) for an AI call that failed or proposed nothing. It sits outside
 *  any dialog, so a wait that should end on it must look at the page. */
export const failToast = (ctx) => ctx.page.getByRole('status')
  .filter({ hasText: /Could not|couldn't|No [a-z-]+ changes were proposed|limit reached|API key/i }).first();

// ---- helpers shared by the days ----

/** Opens a task's editor from the Open Points table by its name. */
export async function openTask(ctx, name) {
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
export async function nextActions(ctx) {
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

/** The Apply button of the chat's latest "Proposed changes" card (several writes in one model response are
 *  staged). It reads "Apply (N selected)". */
export const chatProposalApply = (ctx) =>
  main(ctx).getByRole('region', { name: 'Proposed changes' }).last().getByRole('button', { name: /^Apply \(/ });

/** The AI Assistant: a starter chip or a typed prompt, then the reply, waited for by the send control. */
export async function chat(ctx, { chip, prompt }) {
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
  // Long enough to see the reply arrive; the next beat reads it out or moves on (no silence over 8 s).
  await pace(ctx, 2000);
}

// ---- prologue (end of chapter 2): the wizard to its last step with Claude's proposal, then cancel ----
const BRIEF = 'A customer identity platform for an online retailer: registration, MFA and GDPR erasure, synced to the CRM. Five people, March to February.';

/** The new-project wizard: a one-line brief, Claude's proposal filling the details, a walk to the last
 *  step — and Cancel, because the week runs on the demo project instead. */
/** The new-project wizard's entry: the empty start screen's button before any project exists (the
 *  prologue), else Projects → "+ New project" (the ai-proposal clip, on the demo). */
async function newProjectButton(ctx) {
  const empty = ctx.page.getByRole('button', { name: 'Create a new project' });
  ctx.newFromEmpty = (await empty.count()) > 0;
  if (ctx.newFromEmpty) return empty;
  await nav(ctx, 'Projects');
  return main(ctx).getByRole('button', { name: '+ New project', exact: true });
}

/** The proposal form's GDPR checkbox (the regulatory requirements group). */
export const gdprBox = (d) => d.getByRole('checkbox', { name: 'GDPR / data protection regulation', exact: true });

/** Claude's proposal from the brief: the part the short prologue (below) and the first-run chapter
 *  (first-run.mjs) share. Each adds its own `after`: cancel here, create there. */
export const PROPOSAL = {
  ai: true,
  trigger: newProjectButton,
  run: async (ctx) => {
    const page = ctx.page;
    if (await page.locator(DLG).count()) await page.keyboard.press('Escape');
    await caption(ctx, 'A new project: describe it in a sentence, and Claude proposes the setup.', 'prologue-describe');
    await click(ctx, await newProjectButton(ctx), 'New project', 1000);
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
  // The brief names GDPR erasure: a proposal that leaves GDPR unticked is the wrong take (§715); and the proposal
  // fills the industry (NACE section, a section code since #853): one left empty gets the AI step's retry.
  check: async (ctx) => {
    const d = ctx.page.locator(DLG).last();
    const got = {
      name: await d.getByRole('textbox', { name: /Project name/ }).inputValue().catch(() => ''),
      gdpr: await gdprBox(d).isChecked().catch(() => false),
      nace: await d.getByLabel(/^NACE section/).inputValue().catch(() => ''),
    };
    ctx.log(`PROPOSAL name "${got.name}", GDPR ${got.gdpr ? 'ticked' : 'not ticked'}, NACE "${got.nace}"`);
    return proposalMissing(got);
  },
};

/** What Claude's project proposal left out, or null: a name, GDPR ticked, a NACE section. */
export function proposalMissing({ name, gdpr, nace }) {
  if (!name) return 'no proposal';
  if (!gdpr) return 'GDPR not ticked';
  return nace ? null : 'NACE section not filled';
}

export const wizardProposal = step('wizard-proposal', {
  ...PROPOSAL,
  after: async (ctx) => {
    const d = ctx.page.locator(DLG).last();
    await caption(ctx, 'From the brief, Claude ticks GDPR and fills the other key facts.', 'prologue-gdpr');
    await moveTo(ctx, gdprBox(d), 'GDPR');
    await pace(ctx, 2500);
    for (const what of ['template', 'functions']) await click(ctx, d.getByRole('button', { name: 'Next', exact: true }), `Next (${what})`, 2000);
    await caption(ctx, ctx.newFromEmpty ? 'The last step creates it. Here we open the demo project instead.' : 'The last step creates it. Here we cancel and stay in the demo.', 'prologue-cancel');
    await click(ctx, d.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel', 1000);
  },
  replay: noop,
});
export const PROLOGUE = [wizardProposal];

// ---- shared across days and clips ----

/** Dashboard → digest → Generate now; the narrative is in when the button reads "Generate now" again. */
const digestStep = (beatId) => step('digest-generate', {
  ai: true,
  beats: [beatId], // the id is a parameter here, so take.mjs cannot find it in the source
  trigger: async (ctx) => { await nav(ctx, 'Dashboard'); return main(ctx).getByRole('button', { name: 'Generate now', exact: true }).first(); },
  run: async (ctx) => {
    await nav(ctx, 'Dashboard');
    await caption(ctx, 'The digest: Claude sums up where the project stands.', beatId);
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

/** Monday's digest, and the ai-digest clip's: beat `week-digest`. Friday's is its own beat, `fri-digest`. */
export const digestGenerate = digestStep('week-digest');
export const fridayDigest = digestStep('fri-digest');


// ---- Monday — a milestone slipped ----
export const MONDAY = [
  step('mon-dashboard', {
    run: async (ctx) => {
      await nav(ctx, 'Dashboard');
      await caption(ctx, 'Do this first: the MVP target is overdue.', 'mon-do-first');
      await moveTo(ctx, main(ctx).getByRole('button', { name: /^Open – Do this first – / }), 'Do this first');
      await pace(ctx, 2500);
      await caption(ctx, 'Since Friday: one RAID item added, one task newly overdue.', 'mon-since-friday');
      await moveTo(ctx, main(ctx).getByText('Since you last looked'), 'Since you last looked');
      await pace(ctx, 3000);
    },
  }),
  digestGenerate,
  step('mon-next-actions', {
    run: async (ctx) => {
      await caption(ctx, 'Next actions: now, soon, and what to keep an eye on.', 'mon-next-actions');
      await nextActions(ctx);
      await pace(ctx, 3500);
    },
  }),
  step('analyze-next-actions', {
    ai: true,
    trigger: async (ctx) => { await nextActions(ctx); return main(ctx).getByRole('button', { name: 'Analyze with AI', exact: true }); },
    run: async (ctx) => {
      await nextActions(ctx);
      await caption(ctx, 'Analyze with AI: what needs you first, and why.', 'mon-analyze');
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
      await caption(ctx, 'The CRM task: record what blocks it and move it to Thursday.', 'mon-crm-blocker');
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
      await caption(ctx, 'Knowledge: the CRM interface decision from design sign-off.', 'mon-knowledge-crm');
      await type(ctx, main(ctx).getByPlaceholder('Search knowledge'), 'CRM', 'search knowledge');
      await moveTo(ctx, main(ctx).getByText('CRM interface decision (design sign-off)'), 'CRM interface decision');
      await pace(ctx, 3000);
    },
  }),
  step('draft-elena', {
    run: async (ctx) => {
      await caption(ctx, 'The sponsor must hear about the slip: Draft message fills the update template.', 'mon-draft-elena');
      await draftMessage(ctx, 'Elena Fischer');
    },
  }),
  step('chat-update-elena', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'AI Assistant'); return main(ctx).getByRole('button', { name: 'Stakeholder update', exact: true }).first(); },
    run: async (ctx) => {
      await caption(ctx, 'Or let the assistant write the update from the project as it stands.', 'mon-chat-elena');
      await chat(ctx, { chip: 'Stakeholder update' });
    },
    replay: noop,
  }),
  // Friday's History compares against this version. Versions are otherwise captured a few minutes after
  // edits settle, which the take's clock never reaches before the next morning's reload.
  step('monday-version', {
    run: async (ctx) => {
      await caption(ctx, "Save version now keeps Monday's plan, to compare on Friday.", 'mon-save-version');
      await saveVersion(ctx, 'Monday');
    },
  }),
];

/** Whether the connector change already carries linked tasks or RAID items, read from the database. */
async function connectorLinked(ctx) {
  const projectId = await ctx.page.evaluate(() => localStorage.getItem('aipm-cockpit:turso-current-project'));
  if (!projectId) return false;
  const rows = await L.query(
    'SELECT "linkedTaskIds", "linkedRaidIds" FROM "changes" WHERE project_id = ? AND "title" = ?',
    [{ type: 'text', value: projectId }, { type: 'text', value: CONNECTOR }],
  );
  return (rows[0] ?? []).some((cell) => (cell?.value ?? '') !== '');
}

/** History → Save version now, named. */
export async function saveVersion(ctx, name) {
  await nav(ctx, 'History');
  await click(ctx, main(ctx).getByRole('button', { name: 'Save version now', exact: true }), 'Save version now', 500);
  await type(ctx, main(ctx).getByRole('textbox', { name: 'Name this version', exact: true }), name, 'version name', { slow: false });
  await click(ctx, main(ctx).getByRole('button', { name: 'Add', exact: true }), 'Add version', 1200);
}

// ---- Tuesday — re-plan ----
const REPLAN_CSV = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'replan-forecast.csv');
const BUCKET = 'Identity Platform – T&M';
const CONNECTOR = 'Add a CRM provisioning connector';
const DEMO_TASK = 'MVP demo to the customer';

/** Deletes a task through its editor; the app asks in its own dialog, answered with its Delete. */
async function deleteTask(ctx, name) {
  const d = await openTask(ctx, name);
  await click(ctx, d.locator('button', { hasText: /^Delete$/ }).first(), `delete ${name}`, 800);
  const ask = ctx.page.locator(DLG).last();
  await click(ctx, ask.getByRole('button', { name: 'Delete', exact: true }), `confirm delete ${name}`, 1200);
  await main(ctx).locator('tbody tr', { hasText: name }).first().waitFor({ state: 'detached', timeout: 15000 });
}

/** The per-item "Ask Claude" popover on a register row: the instruction, then Claude's preview. The
 *  step's check reads the preview; its `after` applies it. */
export async function askClaude(ctx, view, item, instruction) {
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
export const askClaudeCheck = async (ctx) => ((await ctx.page.getByRole('button', { name: 'Apply', exact: true }).count()) ? null : 'no changes');
export const askClaudeApply = async (ctx) => click(ctx, ctx.page.getByRole('button', { name: 'Apply', exact: true }).last(), 'Apply', 1500);

/** Deduplicate & unify on Open Points: Claude proposes merges; the check counts them, `after` merges. */
/** Deduplicate & unify from the view it is shown on: the Gantt's own button when the take is there
 *  (f-gantt), else Open Points'. */
async function dedupButton(ctx) {
  const gantt = main(ctx).getByRole('button', { name: 'Deduplicate & unify – Gantt', exact: true });
  if (await gantt.count()) return gantt;
  await nav(ctx, 'Open Points');
  return main(ctx).getByRole('button', { name: 'Deduplicate & unify', exact: true }).first();
}

export const dedup = step('dedup', {
  ai: true,
  trigger: dedupButton,
  run: async (ctx) => {
    if (await ctx.page.locator(DLG).count()) await ctx.page.keyboard.press('Escape');
    const button = await dedupButton(ctx);
    await caption(ctx, 'Deduplicate & unify: Claude finds the follow-ups logged twice.', 'tue-dedup');
    await click(ctx, button, 'Deduplicate & unify', 300);
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
      await caption(ctx, 'Work restarts with the blocker known: drag the CRM task to In Progress.', 'tue-board-crm');
      await click(ctx, main(ctx).getByRole('radio', { name: 'Board', exact: true }), 'Board', 1200);
      const card = main(ctx).getByRole('button', { name: DEMO_CRM_TASK, exact: true }).first();
      await moveTo(ctx, card, DEMO_CRM_TASK);
      await card.dragTo(main(ctx).locator('[aria-label="In Progress"]').first());
      await L.settle(ctx.page);
      await pace(ctx, 1500);
      await click(ctx, main(ctx).getByRole('radio', { name: 'Table', exact: true }), 'Table', 800);
    },
  }),
  step('delete-duplicate', {
    run: async (ctx) => {
      await caption(ctx, 'Two people logged the same follow-up on Friday: delete one by hand.', 'tue-delete-duplicate');
      await deleteTask(ctx, DEMO_DUPLICATE_PAIRS[0][0]);
    },
  }),
  dedup,
  step('change-connector', {
    run: async (ctx) => {
      await nav(ctx, 'Changes');
      await caption(ctx, 'A change request: replace the custom CRM push with a connector.', 'tue-change-connector');
      await click(ctx, main(ctx).getByRole('button', { name: '+ Add change', exact: true }), 'Add change', 1000);
      const d = ctx.page.locator(DLG).last();
      await type(ctx, d.getByRole('textbox', { name: /^Title/ }), CONNECTOR, 'change title');
      await choose(ctx, d.getByRole('combobox', { name: 'Type', exact: true }), 'Scope', 'change type');
      await choose(ctx, d.getByRole('combobox', { name: 'Status', exact: true }), 'Under Review', 'change status');
      await choose(ctx, d.getByRole('combobox', { name: 'Impact', exact: true }), 'Medium', 'change impact');
      await type(ctx, d.getByRole('textbox', { name: 'Impact description', exact: true }), 'Licence cost and about one week of integration work; removes the failing custom CRM sync.', 'impact description');
      await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save change');
    },
  }),
  // The assistant across items (owner 2026-10-19): the change is linked to what it touches, and those tasks
  // get a note — several writes, so the chat stages them as one "Proposed changes" card to review and apply.
  // Links and notes feed no day fact, so the chapters' replay leaves them out.
  // Staging is per model response: writes spread over several responses each apply at once and show no card.
  // The check therefore also accepts a change already linked, and `run` never sends the request again once
  // it is, so a retry cannot add the notes twice. Accepted risk: notes written in one response and the links
  // never, which leaves the change unlinked, so the retry asks again and a note can appear twice.
  step('chat-link-connector', {
    ai: true,
    // Already linked skips the request; a card to review and a link without a card are alternatives.
    mayNotShow: ['tue-chat-link', 'tue-chat-linked', 'tue-chat-review'],
    trigger: async (ctx) => { await nav(ctx, 'AI Assistant'); return main(ctx).locator('textarea').last(); },
    run: async (ctx) => {
      if (await connectorLinked(ctx)) return;
      await caption(ctx, 'The assistant works across items: it links the change to the tasks and the issue it touches.', 'tue-chat-link');
      await chat(ctx, {
        prompt: `The change request "${CONNECTOR}" would replace the failing custom CRM sync. In one response, as one set of changes: link it to the open CRM provisioning tasks and to the GDPR erasure issue, and on each linked task keep its description as it is and add one sentence at the end saying this change would replace the custom CRM sync. Do not change any dates, statuses, owners or blockers.`,
      });
    },
    // isVisible first: isEnabled on a card that is not there waits out its timeout.
    check: async (ctx) => {
      const apply = chatProposalApply(ctx);
      if ((await apply.isVisible().catch(() => false)) && (await apply.isEnabled().catch(() => false))) return null;
      return (await connectorLinked(ctx)) ? null : 'no proposal';
    },
    after: async (ctx) => {
      const apply = chatProposalApply(ctx);
      if (!(await apply.isVisible().catch(() => false))) {
        // The links went in without a card (a single write applies at once).
        await caption(ctx, 'Done: the change now lists the tasks and the issue it touches.', 'tue-chat-linked');
        await pace(ctx, 2500);
        return;
      }
      await caption(ctx, 'Review what it will change, then Apply: several items in one step.', 'tue-chat-review');
      await moveTo(ctx, main(ctx).getByRole('region', { name: 'Proposed changes' }).last(), 'Proposed changes');
      await pace(ctx, 2500);
      await click(ctx, apply, 'Apply proposal', 2000);
    },
    // Links and notes feed no day fact and no next-actions signal, so the chapters' replay leaves them out.
    replay: noop,
  }),
  step('draft-maya', {
    run: async (ctx) => {
      await caption(ctx, 'Maya waits on the MFA change: Draft message.', 'tue-draft-maya');
      await draftMessage(ctx, 'Maya Patel');
    },
  }),
  step('chat-update-maya', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'AI Assistant'); return main(ctx).locator('textarea').last(); },
    run: async (ctx) => {
      await caption(ctx, 'Or the assistant writes Maya an update on the MFA change and the re-plan.', 'tue-chat-maya');
      await chat(ctx, { prompt: 'Draft a stakeholder update for Maya Patel: where the MFA change request stands, and how the MVP is being re-planned.' });
    },
    replay: noop,
  }),
  step('milestone-redemo', {
    run: async (ctx) => {
      await nav(ctx, 'Milestones');
      await caption(ctx, 'A new milestone for the customer demo: MVP re-demo, Friday 2 October.', 'tue-milestone-redemo');
      await click(ctx, ctx.page.getByRole('button', { name: '+ New milestone', exact: true }), 'New milestone', 1000);
      const d = ctx.page.locator(DLG).last();
      await type(ctx, d.getByRole('textbox', { name: /^Name/ }), 'MVP re-demo', 'milestone name');
      await d.locator('input[type=date]').first().fill('2026-10-02');
      await type(ctx, d.getByRole('textbox', { name: 'Description', exact: true }), 'The MVP demo to the customer, re-run on 2 October once provisioning to the CRM works end to end.', 'milestone description');
      await click(ctx, d.getByLabel(`#25 ${DEMO_TASK}`), 'link the demo task', 300);
      await click(ctx, d.getByRole('button', { name: 'Save milestone', exact: true }), 'Save milestone');
      // The demo task leaves the MVP target, so the moved target has no task ending after it.
      await click(ctx, main(ctx).getByRole('button', { name: 'MVP target', exact: true }).first(), 'open MVP target', 800);
      const m = ctx.page.locator(DLG).last();
      await click(ctx, m.getByLabel(`#25 ${DEMO_TASK}`), 'unlink the demo task', 300);
      await click(ctx, m.getByRole('button', { name: /^Save/ }).last(), 'Save milestone');
      await caption(ctx, 'The demo task moves to the new date.', 'tue-demo-task-moves');
      const t = await openTask(ctx, DEMO_TASK);
      await t.locator('input[type=date]').nth(1).fill('2026-10-02');
      await saveTask(ctx);
    },
  }),
  step('bucket-planned-hours', {
    run: async (ctx) => {
      await nav(ctx, 'Budget');
      await caption(ctx, `The bucket ${BUCKET}: planned hours per person.`, 'tue-bucket-hours');
      await moveTo(ctx, main(ctx).getByRole('button', { name: `Edit bucket – ${BUCKET}`, exact: true }), `Edit bucket – ${BUCKET}`);
      await pace(ctx, 3000);
    },
  }),
  step('budget-follow-plan-off', {
    run: async (ctx) => {
      await nav(ctx, 'Budget');
      await caption(ctx, 'Budget hours follow the plan; an imported re-plan needs them free: switch it off.', 'tue-follow-plan-off');
      const toggle = main(ctx).getByRole('button', { name: 'Budget hours follow plan', exact: true });
      if ((await toggle.getAttribute('aria-pressed')) !== 'false') await click(ctx, toggle, 'Budget hours follow plan', 1500);
      if ((await toggle.getAttribute('aria-pressed')) !== 'false') throw new Error('Budget hours follow plan is still on');
    },
  }),
  step('forecast-import', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'Budget'); return main(ctx).getByRole('button', { name: `Import forecast… – ${BUCKET}`, exact: true }); },
    run: async (ctx) => {
      await caption(ctx, "The team's re-plan arrives as a spreadsheet: Import forecast, and Claude maps the columns.", 'tue-forecast-import');
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
      if (await preview.isVisible().catch(() => false)) await click(ctx, preview, 'Show preview', 1500);
      await click(ctx, d.getByRole('button', { name: /^Apply/ }).last(), 'Apply import', 1000);
    },
    // E's applyDemoWeek leaves the bucket's hours as they are, so the replay does too.
    replay: noop,
  }),
];

// ---- Wednesday — people ----
const MEMBER = `${DEMO_NEW_MEMBER.firstName} ${DEMO_NEW_MEMBER.lastName}`;
const ROLE = 'Integration Engineer';

/** Resources → one of its sub-views (shown in the sidebar only while Resources is open). */
export async function resources(ctx, view) {
  await nav(ctx, 'Resources');
  await nav(ctx, view);
}

/** A person's utilization for one month in Planning, typed and committed. */
export async function setUtilization(ctx, who, month, value) {
  const cell = main(ctx).getByRole('spinbutton', { name: `Utilization for ${who} in ${month}`, exact: true });
  await type(ctx, cell, String(value), `${who} ${month}`);
  await cell.press('Tab');
  await L.settle(ctx.page);
}

/** A directory picker field (resource-picker.tsx) in dialog `d`: the name typed, then the person picked from
 *  its list, so the item is linked to the resource rather than left as free text. Throws unless the field
 *  then shows the name and reads as linked. */
export async function pickPerson(ctx, d, field, who, label, { typed = who } = {}) {
  // `typed`: the start of the name is enough to find the person, and every keystroke is screen time.
  await type(ctx, field, typed, label);
  // Picking closes the list itself; its option opens with the name, then the email.
  await click(ctx, d.getByRole('option', { name: new RegExp('^' + who) }).locator('button'), `pick ${who}`, 200);
  const shown = await field.inputValue();
  if (shown !== who) throw new Error(`${label} shows "${shown}", not ${who}`);
  // The field's clear button describes the link state in its title.
  const state = await field.locator('xpath=..').getByRole('button', { name: 'Clear', exact: true }).getAttribute('title');
  if (state !== 'Linked to a resource') throw new Error(`${label} is not linked to ${who} (${state})`);
}

/** The absence form's Assignee, the shared directory picker. */
export const absenceAssignee = (ctx, d, who) =>
  pickPerson(ctx, d, d.getByRole('combobox', { name: 'Assignee *', exact: true }), who, 'absence who');

export const WEDNESDAY = [
  step('discipline-role', {
    run: async (ctx) => {
      // Said on the way to Manage roles: in the big video the view before it is Tuesday's import (no silence over 8 s).
      await caption(ctx, 'The connector needs an integration engineer: a new discipline, then the role.', 'wed-discipline-role');
      await resources(ctx, 'Manage roles');
      await type(ctx, main(ctx).getByRole('textbox', { name: 'Add discipline', exact: true }), ROLE, 'discipline');
      await click(ctx, main(ctx).getByRole('button', { name: 'Add discipline', exact: true }), 'Add discipline');
      await choose(ctx, main(ctx).getByRole('combobox').filter({ has: ctx.page.locator('option', { hasText: /^Discipline$/ }) }).first(), { label: ROLE }, 'role discipline');
      await choose(ctx, main(ctx).getByRole('combobox').filter({ has: ctx.page.locator('option', { hasText: /^Grade$/ }) }).first(), { label: 'Senior' }, 'role grade');
      await click(ctx, main(ctx).getByRole('button', { name: 'Add role', exact: true }), 'Add role');
      // The new row re-renders once it is stored; its hourly rate fields are writable once settled.
      await L.settle(ctx.page);
      await pace(ctx, 1000);
      // A role takes its rates per hour or per day (its basis); the other pair is derived and read-only.
      // 100 and 160 per hour, or the same per day at 8 hours.
      // A new role is entered per hour (the default basis); ui.type never clears a field, since clearing a
      // rate flips the row to the day basis.
      const rate = (kind) => main(ctx).getByRole('spinbutton', { name: `${ROLE} / Senior — ${kind} /h`, exact: true });
      await type(ctx, rate('Internal'), '100', 'internal rate');
      await type(ctx, rate('External'), '160', 'external rate');
      await ctx.page.keyboard.press('Tab');
      await pace(ctx, 1500);
    },
  }),
  step('new-member', {
    run: async (ctx) => {
      await resources(ctx, 'Directory');
      await caption(ctx, "A team member from the vendor's integration partner joins.", 'wed-new-member');
      await click(ctx, main(ctx).getByRole('button', { name: '+ Add resource', exact: true }), 'Add resource');
      const d = ctx.page.locator(DLG).last();
      await type(ctx, d.getByRole('textbox', { name: /^First name/ }), DEMO_NEW_MEMBER.firstName, 'first name');
      await type(ctx, d.getByRole('textbox', { name: /^Last name/ }), DEMO_NEW_MEMBER.lastName, 'last name');
      await type(ctx, d.locator('input[type=email]').first(), 'lukas.brandt@example.com', 'email');
      await click(ctx, d.getByRole('button', { name: 'Save resource' }), 'Save resource');
      await choose(ctx, main(ctx).getByRole('combobox', { name: `Role for ${MEMBER}`, exact: true }), { label: `${ROLE} Senior` }, `Role for ${MEMBER}`);
      await pace(ctx, 1500);
    },
  }),
  step('noah-vacation', {
    run: async (ctx) => {
      await caption(ctx, 'Noah, who owns the CRM integration, is on vacation next week.', 'wed-noah-vacation');
      await click(ctx, main(ctx).getByRole('button', { name: '+ Add absence', exact: true }), 'Add absence');
      const d = ctx.page.locator(DLG).last();
      await absenceAssignee(ctx, d, 'Noah Bennett');
      await click(ctx, d.getByText('Vacation', { exact: true }), 'Vacation', 300);
      await d.locator('input[type=date]').nth(0).fill('2026-09-28');
      await d.locator('input[type=date]').nth(1).fill('2026-10-02');
      await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save absence');
    },
  }),
  step('maya-util', {
    run: async (ctx) => {
      await resources(ctx, 'Workload');
      await caption(ctx, "Maya is over-allocated this month: bring her hours down.", 'wed-maya-util');
      const cell = main(ctx).getByRole('spinbutton', { name: 'Near-term utilization for Maya Patel', exact: true });
      await moveTo(ctx, cell, 'Maya util');
      await pace(ctx, 1500);
      await type(ctx, cell, String(DEMO_MAYA_RELIEVED_HOURS), 'Maya util');
      await cell.press('Tab');
      await L.settle(ctx.page);
      await pace(ctx, 1500);
    },
  }),
  step('planning-lukas', {
    run: async (ctx) => {
      await resources(ctx, 'Planning');
      await caption(ctx, `Planning: ${DEMO_NEW_MEMBER.firstName}'s first month.`, 'wed-planning-member');
      await setUtilization(ctx, MEMBER, '2026-09', 40);
    },
  }),
  step('plan-with-ai', {
    ai: true,
    trigger: async (ctx) => { await resources(ctx, 'Planning'); return main(ctx).getByRole('button', { name: 'Plan with AI', exact: true }); },
    run: async (ctx) => {
      await resources(ctx, 'Planning');
      await caption(ctx, 'Plan with AI proposes the rest.', 'wed-plan-with-ai');
      if (await ctx.page.locator(DLG).count()) await ctx.page.keyboard.press('Escape');
      await click(ctx, main(ctx).getByRole('button', { name: 'Plan with AI', exact: true }), 'Plan with AI', 800);
      const d = ctx.page.locator(DLG).last();
      await type(ctx, d.getByPlaceholder(/^e\.g\./), `Plan ${MEMBER} on the CRM connector: 80 % in October.`, 'plan prompt');
      await click(ctx, d.getByRole('button', { name: 'Propose', exact: true }), 'Propose', 300);
      await waitForAi(ctx, {
        busy: d.getByRole('button', { name: 'Propose', exact: true }),
        done: d.getByRole('button', { name: /^Apply/ }).first(),
        label: 'plan with AI',
      });
      await pace(ctx, 3000);
    },
    check: async (ctx) => ((await ctx.page.locator(DLG).last().getByRole('button', { name: /^Apply/ }).isEnabled().catch(() => false)) ? null : 'no allocation'),
    after: async (ctx) => click(ctx, ctx.page.locator(DLG).last().getByRole('button', { name: /^Apply/ }).first(), 'Apply plan', 1500),
    // The fixed outcome, as in E's applyDemoWeek: 40 % in September (set by hand) and 80 % in October.
    replay: async (ctx) => { await resources(ctx, 'Planning'); await setUtilization(ctx, MEMBER, '2026-10', 80); },
  }),
  step('swimlane-lukas', {
    run: async (ctx) => {
      await nav(ctx, 'Open Points');
      await caption(ctx, `Swimlanes by person: give ${DEMO_NEW_MEMBER.firstName} a lane, then a CRM follow-up.`, 'wed-swimlane');
      await click(ctx, main(ctx).getByRole('radio', { name: 'Swimlanes', exact: true }), 'Swimlanes', 1200);
      // The select adds the lane and returns to its placeholder, so the lane itself is the check.
      const lane = main(ctx).locator(`[aria-label="${MEMBER} – To Do"]`);
      if (await lane.count()) throw new Error(`a lane for ${MEMBER} exists before Add person lane`);
      await choose(ctx, main(ctx).getByRole('combobox', { name: 'Add person lane', exact: true }), { label: MEMBER }, 'Add person lane', { resets: true });
      await lane.waitFor({ state: 'visible', timeout: 5000 })
        .catch(() => { throw new Error(`no lane for ${MEMBER} after Add person lane`); });
      await pace(ctx, 1000);
      // Filtered to the follow-up, its card sits right under the new lane: unfiltered they are thousands of
      // pixels apart, and a drag cannot scroll on the way.
      const search = main(ctx).getByRole('searchbox').first();
      await type(ctx, search, 'CRM provisioning fails', 'filter');
      await L.settle(ctx.page);
      const card = main(ctx).getByRole('button', { name: DEMO_DUPLICATE_PAIRS[0][1], exact: true }).first();
      await moveTo(ctx, card, DEMO_DUPLICATE_PAIRS[0][1]);
      await card.dragTo(main(ctx).locator(`[aria-label="${MEMBER} – To Do"]`).first());
      await L.settle(ctx.page);
      await pace(ctx, 1500);
      await search.fill('');
      await click(ctx, main(ctx).getByRole('radio', { name: 'Table', exact: true }), 'Table', 800);
    },
  }),
];

// ---- Thursday — risks, stakeholders, money ----
const MFA_CHANGE = 'Add MFA to SSO scope';
const LICENCE_TASK = 'Order the connector licence';
const LICENCE_CHECK = 'Confirm licence delivery';

/** Opens a register row's editor by a text it shows (RAID, changes). */
export async function openRow(ctx, view, text) {
  await nav(ctx, view);
  await click(ctx, main(ctx).locator('tbody tr', { hasText: text }).first(), `open ${text}`, 1000);
  return ctx.page.locator(DLG).last();
}

/** Open Points' Add task: opens the new-task form and returns it. */
export async function openNewTask(ctx) {
  await click(ctx, main(ctx).getByRole('button', { name: 'Add task', exact: true }).first(), 'Add task', 500);
  return ctx.page.locator(DLG).last();
}

/** Fills the open new-task form `d` with a name, an owner picked from the directory by first name, and a due
 *  date, then saves it. Kept short (no screen time a viewer gains nothing from): a long fill is silence. */
export async function fillNewTask(ctx, d, name, assignee, due) {
  // The name goes in at once: typed key by key at 1080p it took about 5 s and left f-open-points 10 s without a
  // voice (§715, the 8 s rule). The owner is still typed, so the picker is seen at work.
  await type(ctx, d.getByPlaceholder('What needs to happen?'), name, 'task name', { slow: false });
  await pickPerson(ctx, d, d.getByPlaceholder('Assignee', { exact: true }), assignee, 'assignee', { typed: assignee.split(' ')[0] });
  await d.locator('input[type=date]').nth(1).fill(due);
  await click(ctx, d.getByRole('button', { name: 'Add task – New task' }), 'save task', 300);
}

/** Open Points → Add task with a name, owner and due date. */
async function addTask(ctx, name, assignee, due) {
  await nav(ctx, 'Open Points');
  await fillNewTask(ctx, await openNewTask(ctx), name, assignee, due);
}

/** A RAID item's Owner, the shared directory picker (Tab alone does not pick). */
const pickOwner = (ctx, d, who) => pickPerson(ctx, d, d.getByRole('combobox', { name: 'Owner' }), who, 'owner');

async function approveChange(ctx, title) {
  const d = await openRow(ctx, 'Changes', title);
  await choose(ctx, d.getByRole('combobox', { name: 'Status', exact: true }), 'Approved', `status of ${title}`);
  await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), `approve ${title}`);
}

export const THURSDAY = [
  step('gdpr-owner', {
    run: async (ctx) => {
      await caption(ctx, 'The GDPR issue gets an owner, a mitigation, and work on it starts.', 'thu-gdpr-owner');
      const d = await openRow(ctx, 'RAID', DEMO_GDPR_ISSUE);
      await pickOwner(ctx, d, 'Noah Bennett');
      await type(ctx, d.getByRole('textbox', { name: 'Mitigation / resolution plan', exact: true }), 'Route erasure through the provisioning connector and verify it end to end before the re-demo.', 'mitigation');
      await click(ctx, d.getByRole('radio', { name: 'In Progress', exact: true }), 'In Progress', 300);
      await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save RAID');
    },
  }),
  step('licence-risk', {
    run: async (ctx) => {
      await nav(ctx, 'RAID');
      await caption(ctx, 'A new risk: the connector licence may take time to arrive.', 'thu-licence-risk');
      await click(ctx, main(ctx).getByRole('button', { name: '+ Add RAID item', exact: true }), 'Add RAID item');
      const d = ctx.page.locator(DLG).last();
      await click(ctx, d.getByRole('radio', { name: 'Risk', exact: true }), 'Risk', 300);
      await type(ctx, d.getByPlaceholder("What's the risk / assumption / issue / dependency?"), DEMO_LICENCE_RISK, 'risk title');
      // A Risk's severity comes from its probability × impact matrix (a Full-view field); a new risk is
      // Medium, which the day facts check.
      await pickOwner(ctx, d, 'Noah Bennett');
      await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save risk');
    },
  }),
  step('dpo-stakeholder', {
    run: async (ctx) => {
      await nav(ctx, 'Stakeholders');
      await caption(ctx, "Northwind's data protection officer joins the stakeholders.", 'thu-dpo-stakeholder');
      await click(ctx, main(ctx).getByRole('button', { name: 'Add stakeholder', exact: true }), 'Add stakeholder');
      const d = ctx.page.locator(DLG).last();
      await type(ctx, d.getByRole('combobox', { name: 'Name', exact: true }), DEMO_DPO, 'stakeholder name');
      await choose(ctx, d.getByRole('combobox', { name: 'Category', exact: true }), 'Customer', 'stakeholder category');
      // An address, so Friday's Draft message goes to the mail client instead of asking for one.
      await type(ctx, d.locator('input').nth(3), 'northwind.dpo@example.com', 'email');
      await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save stakeholder');
    },
  }),
  step('raci-dpo', {
    run: async (ctx) => {
      await nav(ctx, 'Stakeholders');
      await nav(ctx, 'RACI Matrix');
      await caption(ctx, 'RACI: the DPO is consulted on the re-demo.', 'thu-raci-dpo');
      await click(ctx, main(ctx).getByRole('button', { name: `MVP re-demo · ${DEMO_DPO} — Set RACI`, exact: true }), 'RACI cell', 600);
      await click(ctx, ctx.page.getByRole('menuitemradio', { name: 'C', exact: true }), 'Consulted', 1200);
    },
  }),
  step('suggest-raci', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'Stakeholders'); await nav(ctx, 'RACI Matrix'); return main(ctx).getByRole('button', { name: 'Suggest RACI', exact: true }); },
    run: async (ctx) => {
      await caption(ctx, 'Suggest RACI fills the rest of the matrix.', 'thu-suggest-raci');
      if (await ctx.page.locator(DLG).count()) await ctx.page.keyboard.press('Escape');
      await click(ctx, main(ctx).getByRole('button', { name: 'Suggest RACI', exact: true }), 'Suggest RACI', 300);
      const d = ctx.page.locator(DLG).last();
      await waitForAi(ctx, {
        busy: d.locator('[aria-busy="true"]').first(),
        done: d.getByRole('button', { name: /^Apply/ }).first(),
        label: 'suggest RACI',
      });
      await pace(ctx, 3000);
    },
    check: async (ctx) => ((await ctx.page.locator(DLG).last().getByRole('button', { name: /^Apply/ }).isEnabled().catch(() => false)) ? null : 'no suggestion'),
    // Only the DPO's suggestions are kept, so the matrix matches the story (and the chapters' replay): a
    // role Claude gives anyone else on the MVP milestones would raise their "milestone update due" and
    // outrank the DPO in Friday's hero. With none left to apply, the dialog is cancelled.
    after: async (ctx) => {
      const d = ctx.page.locator(DLG).last();
      await caption(ctx, 'Keep what fits: here, the DPO.', 'thu-raci-keep');
      const boxes = d.getByRole('checkbox', { name: /^Include – / });
      let kept = 0;
      for (let i = 0; i < (await boxes.count()); i++) {
        const box = boxes.nth(i);
        const isDpo = ((await box.getAttribute('aria-label')) ?? '').includes(DEMO_DPO);
        if (isDpo) kept++;
        if ((await box.isChecked()) !== isDpo) await click(ctx, box, isDpo ? 'keep' : 'untick', 150);
      }
      if (kept) await click(ctx, d.getByRole('button', { name: 'Apply selected', exact: true }), 'Apply RACI', 1500);
      else await click(ctx, d.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel', 800);
    },
    // E's applyDemoWeek sets only the DPO's cell, which the manual step above already set.
    replay: noop,
  }),
  step('map-dpo', {
    run: async (ctx) => {
      await nav(ctx, 'Stakeholders');
      await nav(ctx, 'Influence / Interest');
      await caption(ctx, 'High influence, high interest: the DPO is managed closely.', 'thu-map-dpo');
      const chip = main(ctx).getByRole('button', { name: `Edit – ${DEMO_DPO}`, exact: true });
      await moveTo(ctx, chip, DEMO_DPO);
      await chip.dragTo(main(ctx).locator('div:has(> p)', { hasText: 'Manage Closely' }).last());
      await L.settle(ctx.page);
      await pace(ctx, 2000);
    },
  }),
  step('steering-approve', {
    run: async (ctx) => {
      await nav(ctx, 'Steering committee');
      await caption(ctx, "Thursday's steering meeting approves the connector change and the MFA change.", 'thu-steering-approve');
      await moveTo(ctx, main(ctx).getByRole('button', { name: 'Status report – Steering — MVP slip', exact: true }), 'Status report');
      await pace(ctx, 2000);
      await approveChange(ctx, CONNECTOR);
      await approveChange(ctx, MFA_CHANGE);
    },
  }),
  step('steering-draft', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'Steering committee'); return main(ctx).getByRole('button', { name: 'Status report – Steering — MVP slip', exact: true }); },
    run: async (ctx) => {
      await nav(ctx, 'Steering committee');
      await caption(ctx, 'Draft with AI writes the steering report from the project as it stands.', 'thu-steering-draft');
      if (await ctx.page.locator(DLG).count()) await ctx.page.keyboard.press('Escape');
      await click(ctx, main(ctx).getByRole('button', { name: 'Status report – Steering — MVP slip', exact: true }), 'Status report', 800);
      const d = ctx.page.locator(DLG).last();
      await click(ctx, d.getByRole('button', { name: 'Draft with AI', exact: true }), 'Draft with AI', 300);
      await waitForAi(ctx, {
        busy: d.getByRole('button', { name: /^(Stop|Drafting)/ }).first(),
        done: d.getByRole('button', { name: 'Draft with AI', exact: true }),
        label: 'steering report',
      });
      await pace(ctx, 2500);
    },
    check: async (ctx) => ((await ctx.page.locator(DLG).last().locator('[contenteditable="true"]').first().innerText().catch(() => '')).length > 200 ? null : 'no report'),
    after: async (ctx) => click(ctx, ctx.page.locator(DLG).last().getByRole('button', { name: 'Save', exact: true }), 'Save report', 1200),
    replay: noop,
  }),
  step('connector-bucket', {
    run: async (ctx) => {
      // Said on the way to Budget, so the steering report's save and the nav are not silent (no silence over 8 s).
      await caption(ctx, 'The approved change gets its own budget bucket.', 'thu-connector-bucket');
      await nav(ctx, 'Budget');
      await click(ctx, main(ctx).getByRole('button', { name: '+ Add bucket', exact: true }), 'Add bucket', 1000);
      const d = ctx.page.locator(DLG).last();
      await type(ctx, d.locator('input:not([type]), input[type=text]').first(), 'CRM connector (CR)', 'bucket name');
      await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save bucket');
    },
  }),
  step('licence-task', {
    run: async (ctx) => {
      await caption(ctx, 'A task to order the licence.', 'thu-licence-task');
      await addTask(ctx, LICENCE_TASK, 'Noah Bennett', '2026-10-09');
    },
  }),
  step('chat-licence-task', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'AI Assistant'); return main(ctx).locator('textarea').last(); },
    run: async (ctx) => {
      await caption(ctx, 'And the assistant creates the follow-up.', 'thu-chat-licence');
      await chat(ctx, { prompt: `Create a task "${LICENCE_CHECK}" for Noah Bennett, due 2026-10-09.` });
    },
    // The fixed outcome: the same task, added by hand.
    replay: async (ctx) => addTask(ctx, LICENCE_CHECK, 'Noah Bennett', '2026-10-09'),
  }),
  step('gantt-mvp-target', {
    run: async (ctx) => {
      await nav(ctx, 'Gantt');
      await caption(ctx, 'The MVP target moves to Thursday 1 October; the customer re-demo stays on the 2nd.', 'thu-gantt-mvp');
      // Project D's milestone move, by keyboard: a week (Shift) plus six days from 18 September, then Enter.
      const marker = main(ctx).getByRole('slider', { name: /^Move milestone – MVP target/ }).first();
      await moveTo(ctx, marker, 'MVP target');
      await marker.focus();
      await ctx.page.keyboard.press('Shift+ArrowRight');
      for (let i = 0; i < 6; i++) await ctx.page.keyboard.press('ArrowRight');
      await ctx.page.keyboard.press('Enter');
      await L.settle(ctx.page);
      await pace(ctx, 2000);
    },
  }),
];

// ---- Friday — close the week ----
const BUDGET_INSIGHT = 'Budget off plan';
const APPLY_REC = 'Apply recommendation';
/** The budget insight's card on Insights. */
const insightCard = (ctx) => main(ctx).locator('li').filter({ has: ctx.page.getByRole('button', { name: `Dismiss – ${BUDGET_INSIGHT}`, exact: true }) });
/** The review Apply recommendation opens (insights/recommendation-review-modal.tsx). */
const reviewDialog = (ctx) => ctx.page.getByRole('dialog', { name: 'Review recommendation', exact: true });
/** The review's line for a plan with nothing left to apply (its confirm button is then disabled). */
export const EMPTY_PLAN = 'This recommendation has no remaining changes to apply.';
/** Every outcome line a recommendation shows after Apply, by its i18n key (insightRecommendation*): copies, since the
 *  recorder runs without the app's modules; content.test.mjs pins each to src/app/i18n.ts. */
export const REC_OUTCOMES = Object.freeze({
  insightRecommendationApplied: 'Recommendation applied.',
  insightRecommendationAppliedPartial: "Partly applied — some changes weren't made. Generate a new recommendation for the rest.",
  insightRecommendationApplyFailed: "Some changes in this recommendation couldn't be applied.",
  insightRecommendationAllRejected: 'Not applied — every change in this recommendation was rejected.',
  insightRecommendationStale: "This recommendation wasn't applied — the project data changed since it was generated. Generate a new one.",
  insightRecommendationCurrencyChanged: "This recommendation wasn't applied — the project's currency history changed since it was generated, so its amounts may be in a different currency. Generate a new one.",
  insightRecommendationStalePartial: "Some changes weren't applied — the project data changed since this recommendation was generated. Generate a new one for the rest.",
});
/** One of those lines, whole: no other app string with the same opening can match. */
export const REC_STATUS = (() => {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^(${Object.values(REC_OUTCOMES).map(esc).join('|')})$`);
})();
/** The outcome lines after Apply, where the app shows them: the card's note once the recommendation is applied, and
 *  the toast (app-modals.tsx, role="status"). Both are read: a change that threw still leaves the card reading
 *  applied while the toast says some changes couldn't be applied, and an outcome that wrote nothing has the toast only. */
const recStatusLines = (ctx) => insightCard(ctx).getByText(REC_STATUS).or(ctx.page.getByRole('status').getByText(REC_STATUS));

/** What is wrong with a recommendation's status lines after Apply, or null when there is one and every one reads
 *  applied in full. */
export function recommendationNotApplied(statuses) {
  if (!statuses.length) return 'the recommendation shows no applied status';
  const other = statuses.find((s) => s !== REC_OUTCOMES.insightRecommendationApplied);
  return other === undefined ? null : `the recommendation was not applied in full: "${other}"`;
}
const SPLIT_FROM = 'Pilot feedback fixes';
const SPLIT_NEW = 'Pilot feedback fixes – registration flow';

export const FRIDAY = [
  step('crm-done', {
    run: async (ctx) => {
      await nav(ctx, 'Open Points');
      await caption(ctx, 'Erasure verified end to end: the CRM task is done.', 'fri-crm-done');
      await choose(ctx, main(ctx).getByRole('combobox', { name: `Status – ${DEMO_CRM_TASK}`, exact: true }), 'Done', `Status – ${DEMO_CRM_TASK}`);
      await L.settle(ctx.page);
      await pace(ctx, 1500);
      await caption(ctx, 'And the GDPR issue is resolved.', 'fri-gdpr-resolved');
      const d = await openRow(ctx, 'RAID', DEMO_GDPR_ISSUE);
      await click(ctx, d.getByRole('radio', { name: 'Resolved', exact: true }), 'Resolved', 300);
      await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save RAID');
    },
  }),
  step('friday-hero', {
    run: async (ctx) => {
      await nav(ctx, 'Dashboard');
      await caption(ctx, 'Friday: the first thing to do now is to tell the DPO.', 'fri-do-first');
      const hero = main(ctx).getByRole('button', { name: `Open – Do this first – Update stakeholder: ${DEMO_DPO}`, exact: true });
      if (!(await hero.isVisible().catch(() => false))) throw new Error(`the Dashboard hero is not "Update stakeholder: ${DEMO_DPO}"`);
      await moveTo(ctx, hero, 'Do this first');
      await pace(ctx, 3000);
    },
  }),
  step('draft-dpo', {
    run: async (ctx) => {
      await caption(ctx, 'Draft message: the erasure fix is verified.', 'fri-draft-dpo');
      await draftMessage(ctx, DEMO_DPO);
    },
  }),
  step('chat-update-dpo', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'AI Assistant'); return main(ctx).locator('textarea').last(); },
    run: async (ctx) => {
      await caption(ctx, 'Or the assistant writes the DPO an update.', 'fri-chat-dpo');
      await chat(ctx, { prompt: `Draft a stakeholder update for ${DEMO_DPO}: the GDPR erasure fix is verified end to end, ahead of the re-demo on 2 October.` });
    },
    replay: noop,
  }),
  step('split-pilot-task', {
    run: async (ctx) => {
      await caption(ctx, 'Restructure by hand: split the pilot fixes in two, linked.', 'fri-split-task');
      const d = await openTask(ctx, SPLIT_FROM);
      await click(ctx, d.getByRole('button', { name: '+ New linked task' }), 'New linked task', 1000);
      // The nested "New linked task" dialog. Its defaults (due today, no one, a predecessor) would each
      // raise a new Next-actions row, so the second half gets an owner, a later date and comes after.
      const n = ctx.page.getByRole('dialog', { name: 'New linked task', exact: true });
      await type(ctx, n.getByRole('textbox', { name: 'Task name', exact: true }), SPLIT_NEW, 'task name');
      // §758: the assignee is a picker (a combobox). Typing alone leaves free text; picking the directory
      // option links the resource, and closes the list itself (no Escape: it would close this dialog too).
      await type(ctx, n.getByRole('combobox', { name: 'Assignee', exact: true }), 'Sofia Ramirez', 'assignee');
      await click(ctx, n.getByRole('option', { name: /^Sofia Ramirez/ }).locator('button'), 'Sofia Ramirez', 500);
      await n.locator('input[type=date]').first().fill('2026-10-16');
      // The link-direction select is the dialog's last (it carries no accessible name).
      await choose(ctx, n.locator('select').last(), { label: 'Successor' }, 'link direction');
      await click(ctx, n.getByRole('button', { name: 'Add', exact: true }), 'Add linked task', 800);
      await saveTask(ctx);
    },
  }),
  step('optimize-wbs', {
    ai: true,
    trigger: async (ctx) => { await nav(ctx, 'Open Points'); return main(ctx).getByRole('button', { name: 'Optimize with AI', exact: true }); },
    run: async (ctx) => {
      await nav(ctx, 'Open Points');
      await caption(ctx, 'Optimize with AI restructures the rest: splits, groups, estimates, links.', 'fri-optimize-wbs');
      if (await ctx.page.locator(DLG).count()) await ctx.page.keyboard.press('Escape');
      await click(ctx, main(ctx).getByRole('button', { name: 'Optimize with AI', exact: true }), 'Optimize with AI', 800);
      const d = ctx.page.locator(DLG).last();
      await type(ctx, d.getByPlaceholder(/^e\.g\./), 'Restructure the open pilot and rollout tasks: split anything over a week, group them, and link dependencies.', 'optimize prompt');
      await click(ctx, d.getByRole('button', { name: 'Propose', exact: true }), 'Propose', 300);
      await waitForAi(ctx, {
        busy: d.getByRole('button', { name: 'Propose', exact: true }),
        // An error or an empty plan is a toast (and closes the dialog): the check then sees no Apply and retries.
        done: d.getByRole('button', { name: /^Apply/ }).first().or(failToast(ctx)),
        label: 'optimize',
      });
      await pace(ctx, 2500);
    },
    check: async (ctx) => ((await ctx.page.locator(DLG).last().getByRole('button', { name: /^Apply/ }).isEnabled().catch(() => false)) ? null : 'no change'),
    after: async (ctx) => click(ctx, ctx.page.locator(DLG).last().getByRole('button', { name: /^Apply/ }).first(), 'Apply restructure', 2000),
    replay: noop,
  }),
  step('insights', {
    run: async (ctx) => {
      // Said on the way to Insights, after Optimize with AI (no silence over 8 s).
      await caption(ctx, 'Insights: patterns the week left behind.', 'fri-insights');
      await nav(ctx, 'Dashboard');
      await nav(ctx, 'Insights');
      await pace(ctx, 3000);
    },
  }),
  step('insight-recommendation', {
    ai: true,
    trigger: async (ctx) => {
      await nav(ctx, 'Dashboard'); await nav(ctx, 'Insights');
      return main(ctx).getByRole('button', { name: 'Generate recommendation – Budget off plan', exact: true });
    },
    // The recommendation, then its review opened: an empty plan (nothing Claude could apply) fails the check,
    // so it gets the AI step's one retry instead of a disabled confirm button after a billed call.
    run: async (ctx) => {
      // A retry finds the previous review still open: close it first. Its recommendation is still proposed, and a
      // proposed one shows only Apply and Reject (insight-recommendation-controls.tsx): Reject, the app's own way
      // to dismiss a suggestion and ask again, brings Generate back.
      const open = reviewDialog(ctx);
      if (await open.count()) await click(ctx, open.getByRole('button', { name: 'Cancel', exact: true }), 'Cancel review', 500);
      const reject = main(ctx).getByRole('button', { name: `Reject – ${BUDGET_INSIGHT}`, exact: true });
      if (await reject.count()) await click(ctx, reject, 'Reject recommendation', 500);
      await caption(ctx, 'A recommendation for the budget insight.', 'fri-insight-rec');
      await click(ctx, main(ctx).getByRole('button', { name: 'Generate recommendation – Budget off plan', exact: true }), 'Generate recommendation', 300);
      await waitForAi(ctx, {
        busy: main(ctx).getByRole('button', { name: /^(Generating|Stop)/ }).first(),
        // The suggestion's own Apply button: it shows only once the recommendation is on the card.
        done: main(ctx).getByRole('button', { name: `${APPLY_REC} – ${BUDGET_INSIGHT}`, exact: true }),
        label: 'recommendation',
      });
      await pace(ctx, 2500);
      // Apply recommendation opens a review of the proposed changes. (Act only records that the insight was
      // acted on; it applies nothing.)
      await caption(ctx, 'Apply: review the proposed changes, then apply them.', 'fri-insight-apply');
      await click(ctx, main(ctx).getByRole('button', { name: `${APPLY_REC} – ${BUDGET_INSIGHT}`, exact: true }), APPLY_REC, 1500);
    },
    check: async (ctx) => {
      if (!(await insightCard(ctx).getByText(/^AI suggests:/).count())) return 'no recommendation';
      const review = reviewDialog(ctx);
      if (!(await review.count())) return 'no review';
      const empty = (await review.getByText(EMPTY_PLAN).count()) > 0
        || !(await review.getByRole('button', { name: APPLY_REC, exact: true }).isEnabled().catch(() => false));
      ctx.log(`INSIGHT review open, ${empty ? 'empty plan' : 'plan with changes'}`);
      return empty ? 'no applicable changes' : null;
    },
    // The review is held while its beat is spoken, then confirmed; the recommendation must then read applied.
    after: async (ctx) => {
      await holdVoice(ctx);
      await click(ctx, reviewDialog(ctx).getByRole('button', { name: APPLY_REC, exact: true }), `confirm ${APPLY_REC}`, 1500);
      // The card's note and the toast come with the same render: once one shows, every line is read.
      const lines = recStatusLines(ctx);
      await lines.first().waitFor({ timeout: 15000 }).catch(() => {});
      const statuses = await lines.allInnerTexts().catch(() => []);
      ctx.log(`INSIGHT status after Apply: ${statuses.map((s) => `"${s}"`).join(', ') || '(none)'}`);
      // The applied changes may bring the budget back on plan, and a resolved insight leaves the list.
      const gone = !statuses.length && !(await insightCard(ctx).count());
      const wrong = gone ? 'the budget insight left the list before its status could be read (resolved by the changes?)' : recommendationNotApplied(statuses);
      if (wrong) throw new Error(`${ctx.clipId}: ${wrong}`);
      await pace(ctx, 1500);
    },
    // Friday is the last day: no chapter replays it. It also runs after the day's scripted steps (the split, the
    // restructure), so what Claude changes cannot reach them.
    replay: noop,
  }),
  step('trends-activity-history', {
    run: async (ctx) => {
      // Said on the way to Trends, after the insight's recommendation is applied (no silence over 8 s).
      await caption(ctx, 'Trends: the weeks behind this one.', 'fri-trends');
      await nav(ctx, 'Dashboard');
      await nav(ctx, 'Trends');
      await pace(ctx, 3000);
      // Each beat describes the view on screen: its voice ends there, before the next view opens.
      await holdVoice(ctx);
      await nav(ctx, 'Activity');
      await caption(ctx, 'Activity: who changed what this week, day by day.', 'fri-activity');
      await pace(ctx, 3000);
      await holdVoice(ctx);
      await nav(ctx, 'History');
      await caption(ctx, "History: Monday's version against today's.", 'fri-history');
      // Monday's version (MONDAY's last step) against today's data. Missing, the caption would sit over an
      // empty list, so the take fails instead.
      const vsNow = main(ctx).getByRole('button', { name: /^Compared with current – Monday/ }).first();
      await vsNow.waitFor({ timeout: 15000 }).catch(() => {
        throw new Error(`${ctx.clipId}: History holds no Monday version`);
      });
      await click(ctx, vsNow, 'compare Monday with today', 300);
      // The diff loads from Turso: hold the caption on the result, not on the plain list.
      await main(ctx).getByRole('heading', { name: 'Changes', exact: true }).first().waitFor({ timeout: 30000 });
      await pace(ctx, 2500);
    },
  }),
  fridayDigest,
  step('help', {
    run: async (ctx) => {
      await caption(ctx, 'Help: the walk-through, the demo and these videos.', 'fri-help');
      await click(ctx, ctx.page.getByRole('button', { name: /^Help/ }).first(), 'Help', 3500);
      await ctx.page.keyboard.press('Escape');
      await pace(ctx, 1500);
    },
  }),
];

export const DAYS = Object.freeze({ mon: MONDAY, tue: TUESDAY, wed: WEDNESDAY, thu: THURSDAY, fri: FRIDAY });

/** A day's step by its id, for a clip that shows the same action (steps/ai.mjs). */
export function weekStep(id) {
  const s = Object.values(DAYS).flat().find((x) => x.id === id);
  if (!s) throw new Error(`no week step ${id}`);
  return s;
}

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
    await caption(ctx, 'The demo: Northwind\'s customer identity platform. Its MVP was due last Friday.', 'demo-opens');
    await pace(ctx, 4000);
  },
});
