// §715 demo recorder: the steps of the 15 AI clips (A's spec, tier 3). A clip runs on the fresh demo
// (Monday morning) and reuses the week's step object where it shows the same action; the steps written
// here are the clips' own. See ../README.md.
import { step } from './step.mjs';
import { AI_TIMEOUT_MS, waitForAi } from '../ai-wait.mjs';
import * as L from '../lib.mjs';
import { caption, click, moveTo, nav, pace, skipTour, type } from '../ui.mjs';
import { DEMO_CRM_TASK, DEMO_DUPLICATE_PAIRS, DEMO_GDPR_ISSUE } from '../week-story.mjs';
import {
  DLG, askClaude, askClaudeApply, askClaudeCheck, chat, dedup, digestGenerate, failToast, main, nextActions, noop, resources, weekStep,
  wizardProposal,
} from './week.mjs';

const CHAT_TASK = 'Book the CRM vendor call';
const MAYA = 'Maya Patel';

/** Settings, then one of its tabs (Next actions needs Expert mode, which `weights-history` turns on). */
async function settingsTab(ctx, ...tabs) {
  await nav(ctx, 'Settings');
  for (const tab of tabs) await click(ctx, main(ctx).getByRole('button', { name: tab, exact: true }).first(), tab, 500);
}

/** A week step whose `run` relies on the step before it for its view: the clip goes there first (a with-AI
 *  take runs `run`, never `trigger`). */
const atView = (s, go) => step(s.id, { ...s, run: async (ctx) => { await go(ctx); await s.run(ctx); } });

/** The thread's last message is the reply: a reply of a few words is not an answer. */
const replyCheck = async (ctx) => {
  const last = main(ctx).getByRole('log').locator(':scope > li').last();
  return (await last.innerText().catch(() => '')).trim().length > 40 ? null : 'no answer';
};

// ---- ai-chat ----
const chatQuestion = step('chat-question', {
  ai: true,
  trigger: async (ctx) => { await nav(ctx, 'AI Assistant'); return main(ctx).locator('textarea').last(); },
  run: async (ctx) => {
    await caption(ctx, 'Ask about the project.');
    await chat(ctx, { prompt: 'Why did the MVP target slip, and what needs doing this week?' });
  },
  check: replyCheck,
  replay: noop,
});
const chatCreateTask = step('chat-create-task', {
  ai: true,
  trigger: async (ctx) => { await nav(ctx, 'AI Assistant'); return main(ctx).locator('textarea').last(); },
  run: async (ctx) => {
    await caption(ctx, 'Or ask it to make the change.');
    await chat(ctx, { prompt: `Create a task "${CHAT_TASK}" for Ava Thompson, due 2026-10-02.` });
  },
  check: async (ctx) => {
    await nav(ctx, 'Open Points');
    return (await main(ctx).locator('tbody tr', { hasText: CHAT_TASK }).count()) ? null : 'no task';
  },
  replay: noop,
});
const chatTaskInOpenPoints = step('chat-task-in-open-points', {
  run: async (ctx) => {
    await nav(ctx, 'Open Points');
    await caption(ctx, 'The task is in Open Points, with its owner and date.');
    await moveTo(ctx, main(ctx).locator('tbody tr', { hasText: CHAT_TASK }).first());
    await pace(ctx, 2500);
  },
});

// ---- ai-inline-task ----
const inlineTaskDescription = step('inline-task-description', {
  ai: true,
  trigger: async (ctx) => { await nav(ctx, 'Open Points'); return main(ctx).getByRole('button', { name: `Ask Claude – ${DEMO_CRM_TASK}`, exact: true }).first(); },
  run: async (ctx) => {
    await caption(ctx, 'Ask Claude to write the description.');
    await askClaude(ctx, 'Open Points', DEMO_CRM_TASK, 'Write the description: what the CRM provisioning connector does, and when the task is done.');
  },
  check: askClaudeCheck,
  after: askClaudeApply,
  replay: noop,
});

// ---- ai-inline-entity: as Thursday's, with an instruction that holds on Monday ----
const inlineRaidMitigation = step('inline-raid-mitigation', {
  ai: true,
  trigger: async (ctx) => { await nav(ctx, 'RAID'); return main(ctx).getByRole('button', { name: `Ask Claude – ${DEMO_GDPR_ISSUE}`, exact: true }).first(); },
  run: async (ctx) => {
    await caption(ctx, 'Ask Claude for the mitigation.');
    await askClaude(ctx, 'RAID', DEMO_GDPR_ISSUE, 'Set the mitigation to: Route erasure requests through the provisioning connector and verify them end to end.');
  },
  check: askClaudeCheck,
  after: askClaudeApply,
  replay: noop,
});

// ---- ai-insight and ai-raci: the week's steps, from their own view ----
const insightRecommend = atView(weekStep('insight-recommendation'), async (ctx) => { await nav(ctx, 'Dashboard'); await nav(ctx, 'Insights'); });
// The clip runs on Monday, before the DPO exists: it applies everything Claude suggests.
const suggestRaci = step('suggest-raci', {
  ...atView(weekStep('suggest-raci'), async (ctx) => { await nav(ctx, 'Stakeholders'); await nav(ctx, 'RACI Matrix'); }),
  after: async (ctx) => click(ctx, ctx.page.locator(DLG).last().getByRole('button', { name: 'Apply selected', exact: true }), 'Apply RACI', 1500),
});

// ---- ai-alloc ----
const allocPlan = step('alloc-plan', {
  ai: true,
  trigger: async (ctx) => { await resources(ctx, 'Planning'); return main(ctx).getByRole('button', { name: 'Plan with AI', exact: true }); },
  run: async (ctx) => {
    await resources(ctx, 'Planning');
    await caption(ctx, `${MAYA} is booked far over 100 % in September.`);
    await moveTo(ctx, main(ctx).getByRole('spinbutton', { name: `Utilization for ${MAYA} in 2026-09`, exact: true }));
    await pace(ctx, 1500);
    if (await ctx.page.locator(DLG).count()) await ctx.page.keyboard.press('Escape');
    await click(ctx, main(ctx).getByRole('button', { name: 'Plan with AI', exact: true }), 'Plan with AI', 800);
    const d = ctx.page.locator(DLG).last();
    await type(ctx, d.getByPlaceholder(/^e\.g\./), `Bring ${MAYA} under 100 % in September by sharing her work with the team.`, 'plan prompt');
    await click(ctx, d.getByRole('button', { name: 'Propose', exact: true }), 'Propose', 300);
    await waitForAi(ctx, {
      busy: d.getByRole('button', { name: 'Propose', exact: true }),
      // An error or an empty plan is a page-level toast: the check then sees no Apply and retries.
      done: d.getByRole('button', { name: /^Apply/ }).first().or(failToast(ctx)),
      label: 'plan with AI',
    });
    await pace(ctx, 3000);
  },
  check: async (ctx) => ((await ctx.page.locator(DLG).last().getByRole('button', { name: /^Apply/ }).isEnabled().catch(() => false)) ? null : 'no allocation'),
  after: async (ctx) => {
    await click(ctx, ctx.page.locator(DLG).last().getByRole('button', { name: /^Apply/ }).first(), 'Apply plan', 1500);
    await resources(ctx, 'Workload');
    await caption(ctx, 'Workload shows the new split.');
    await pace(ctx, 3000);
  },
  replay: noop,
});

// ---- ai-weights ----
/** Off camera: Expert mode on, learning on, and a few rows snoozed so the learning view has a history. */
const weightsHistory = step('weights-history', {
  setup: true,
  run: async (ctx) => {
    await nav(ctx, 'Settings');
    const expert = ctx.page.getByRole('checkbox', { name: 'Expert mode', exact: true }).first();
    if (!(await expert.isChecked())) await click(ctx, expert, 'Expert mode', 500);
    await click(ctx, main(ctx).getByRole('button', { name: 'Next actions', exact: true }).first(), 'Next actions', 500);
    const learn = main(ctx).getByRole('checkbox', { name: /^Learn from my Action Center responses/ }).first();
    if (!(await learn.isChecked())) await click(ctx, learn, 'learning', 500);
    for (let i = 0; i < 3; i++) {
      await nextActions(ctx);
      await click(ctx, main(ctx).getByRole('button', { name: /^More actions – / }).first(), 'More actions', 400);
      await click(ctx, ctx.page.getByRole('menuitem', { name: '1 day', exact: true }).or(ctx.page.getByRole('button', { name: '1 day', exact: true })).first(), 'snooze 1 day', 600);
    }
    await settingsTab(ctx, 'Next actions');
    // "View learning insights" opens a view of its own (not a dialog): one row per action kind.
    await click(ctx, main(ctx).getByRole('button', { name: 'View learning insights', exact: true }), 'View learning insights', 800);
    await main(ctx).getByRole('heading', { name: 'Action Center learning', exact: true }).waitFor({ timeout: 15000 });
    const rows = await main(ctx).locator('tbody tr').count();
    if (rows === 0) throw new Error('the learning view lists no history after three snoozes');
  },
});
const weightsSuggest = step('weights-suggest', {
  ai: true,
  trigger: async (ctx) => { await settingsTab(ctx, 'Next actions'); return main(ctx).getByRole('button', { name: 'Suggest with AI', exact: true }); },
  run: async (ctx) => {
    await settingsTab(ctx, 'Next actions');
    await caption(ctx, 'Suggest with AI reads what you acted on and snoozed.');
    await click(ctx, main(ctx).getByRole('button', { name: 'Suggest with AI', exact: true }), 'Suggest with AI', 300);
    await waitForAi(ctx, {
      busy: main(ctx).getByRole('button', { name: 'Analyzing...', exact: true }),
      // A suggestion row, Claude's "none", or the app's error line: each only appears once the call returned.
      done: main(ctx).getByRole('button', { name: /^Accept - / })
        .or(main(ctx).getByText(/^(No adjustments suggested\.|Could not reach the AI service\.|The AI returned an unexpected response\.|Configure an AI key first\.)$/)).first(),
      label: 'weights',
    });
    await pace(ctx, 3000);
  },
  check: async (ctx) => ((await main(ctx).getByRole('button', { name: /^Accept - / }).count()) ? null : 'no suggestion'),
  after: async (ctx) => {
    await caption(ctx, 'Accept the one you agree with.');
    await click(ctx, main(ctx).getByRole('button', { name: /^Accept - / }).first(), 'Accept', 2000);
  },
  replay: noop,
});

// ---- ai-scheduled ----
/** The first recorded run of the stored job `name`, polled in the throwaway database. */
async function storedRun(name) {
  const until = Date.now() + AI_TIMEOUT_MS;
  for (;;) {
    const jobs = (await L.query('SELECT data FROM scheduled_jobs')).map((r) => JSON.parse(r[0].value));
    const run = jobs.find((j) => j.name === name)?.history?.[0];
    if (run) return run;
    if (Date.now() > until) throw new Error(`scheduled job ${name} did not run`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
/** Off camera: scheduled jobs on, and one daily job at 09:00 (the app's default time; the take starts at 08:30).
 *  ★ The runner keeps its own copy of the job list, read on mount, so it sees a job added in Settings only
 *  after a reload (an app defect, filed with §715 A); the reload is off camera. */
const scheduledJob = step('scheduled-job', {
  setup: true,
  run: async (ctx) => {
    await settingsTab(ctx, 'AI Assistant', 'Scheduled jobs');
    const on = main(ctx).getByRole('checkbox', { name: 'Enable scheduled jobs', exact: true });
    if (!(await on.isChecked())) await click(ctx, on, 'Enable scheduled jobs', 500);
    await click(ctx, main(ctx).getByRole('button', { name: 'Add job', exact: true }), 'Add job', 500);
    // One change event: the name field is controlled by a store round trip, so typing it character by
    // character would interleave with the saves.
    await type(ctx, main(ctx).getByRole('textbox', { name: /^Job name – / }).last(), 'Morning check', 'job name', { slow: false });
    // The row's names change only once the save resolved (the token follows the stored name).
    await main(ctx).getByRole('checkbox', { name: 'Enabled – Morning check', exact: true }).waitFor({ timeout: 30000 });
    await ctx.page.reload();
    await L.settle(ctx.page);
    await skipTour(ctx);
  },
});
const scheduledRun = step('scheduled-run', {
  ai: true,
  trigger: async (ctx) => { await settingsTab(ctx, 'AI Assistant', 'Scheduled jobs'); return main(ctx).getByRole('checkbox', { name: 'Enabled – Morning check', exact: true }); },
  run: async (ctx) => {
    await settingsTab(ctx, 'AI Assistant', 'Scheduled jobs');
    await caption(ctx, 'The morning check runs every day at 09:00.');
    await moveTo(ctx, main(ctx).getByRole('textbox', { name: 'Job name – Morning check', exact: true }));
    await pace(ctx, 2000);
    // The app has no "run now": the runner checks every five minutes, so the clock jumps past 09:00
    // (fastForward fires each due timer once, not every tick in between).
    await caption(ctx, 'At 09:00 it runs by itself.');
    await ctx.page.clock.fastForward(35 * 60 * 1000);
    // The run is read from the stored job (Node, off screen) while the view stays put; Settings reads its
    // list on mount only (§750), so the section is then re-opened once, by its sibling tab.
    const run = await storedRun('Morning check');
    if (!run.ok) throw new Error(`${ctx.clipId}: the scheduled run failed (${run.error ?? 'no detail'})`);
    await click(ctx, main(ctx).getByRole('button', { name: 'Views', exact: true }).first(), 'Views', 300);
    await click(ctx, main(ctx).getByRole('button', { name: 'Scheduled jobs', exact: true }).first(), 'Scheduled jobs', 800);
    const lastRun = main(ctx).getByText(/^Last run: /).first();
    await lastRun.waitFor({ timeout: 15000 });
    await caption(ctx, 'It ran: its suggestions are counted on the job.');
    await moveTo(ctx, lastRun);
    await pace(ctx, 3000);
  },
  // The row reads "Last run: <time> — N suggestions" in one element.
  check: async (ctx) => ((await main(ctx).getByText(/ — (\d+ suggestions|1 suggestion)$/).count()) ? null : 'no analysis'),
  replay: noop,
});

export const AI_STEPS = Object.freeze({
  'ai-proposal': [wizardProposal],
  'ai-chat': [chatQuestion, chatCreateTask, chatTaskInOpenPoints],
  'ai-dedup': [dedup],
  'ai-wbs': [weekStep('optimize-wbs')],
  'ai-inline-task': [inlineTaskDescription],
  'ai-inline-entity': [inlineRaidMitigation],
  'ai-next-actions': [weekStep('analyze-next-actions')],
  'ai-insight': [insightRecommend],
  'ai-digest': [digestGenerate],
  'ai-alloc': [allocPlan],
  'ai-raci': [suggestRaci],
  'ai-steering': [weekStep('steering-draft')],
  // An import is refused while budget hours follow the plan (Tuesday switches it off first too).
  'ai-forecast-import': [weekStep('budget-follow-plan-off'), weekStep('forecast-import')],
  'ai-weights': [weightsHistory, weightsSuggest],
  'ai-scheduled': [scheduledJob, scheduledRun],
});

// ---- preconditions (A's "What A needs from project E", re-checked against the reworked data) ----
/** Open tasks in Open Points: rows whose status select reads neither Done nor Cancelled. The table
 *  virtualizes only from 200 rows, so every row of the demo is in the DOM. `name` narrows to rows naming it. */
async function openTaskCount(ctx, name) {
  await nav(ctx, 'Open Points');
  const rows = name ? main(ctx).locator('tbody tr', { hasText: name }) : main(ctx).locator('tbody tr');
  return rows.evaluateAll((trs) => trs.filter((r) => {
    const sel = [...r.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.value === 'Done'));
    return sel && sel.value !== 'Done' && sel.value !== 'Cancelled';
  }).length);
}

export const AI_PRECONDITIONS = Object.freeze({
  'ai-dedup': [{
    what: 'both tasks of duplicate pair 2 open',
    check: async (ctx) => {
      for (const name of DEMO_DUPLICATE_PAIRS[1]) if ((await openTaskCount(ctx, name)) === 0) return false;
      return true;
    },
  }],
  'ai-wbs': [{ what: 'at least 8 open tasks', check: async (ctx) => (await openTaskCount(ctx)) >= 8 }],
  'ai-raci': [{
    what: 'an empty cell in the RACI matrix',
    check: async (ctx) => {
      await nav(ctx, 'Stakeholders'); await nav(ctx, 'RACI Matrix');
      return (await main(ctx).getByRole('button', { name: / — Set RACI$/ }).count()) > 0;
    },
  }],
  'ai-alloc': [{
    what: `${MAYA} over-allocated in September`,
    check: async (ctx) => {
      await resources(ctx, 'Planning');
      const v = await main(ctx).getByRole('spinbutton', { name: `Utilization for ${MAYA} in 2026-09`, exact: true }).inputValue().catch(() => '');
      return Number(v) > 100;
    },
  }],
});
