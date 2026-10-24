// §715 demo recorder: the steps of the 20 feature clips (A's spec, tier 4), on the fresh Monday demo.
// f-gantt is the owner's fixed script; its step ids are pinned by videos.test.mjs. See ../README.md.
import { step } from './step.mjs';
import * as L from '../lib.mjs';
import { caption, choose, click, moveTo, nav, pace, type } from '../ui.mjs';
import { DEMO_CRM_TASK, DEMO_DUPLICATE_PAIRS, DEMO_GDPR_ISSUE } from '../week-story.mjs';
import { DLG, absenceAssignee, dedup, fillNewTask, main, openNewTask, openRow, resources, saveVersion, setUtilization } from './week.mjs';

// Short: typed on camera, character by character.
const NEW_TASK = 'Pilot rollout checklist';
// Open and in the future: a Done bar is not draggable.
const BAR_TASK = 'Load testing';
const LATE_MILESTONE = 'Pilot Go-Live';
const MODULE = 'Time bookings';

/** A real mouse drag of `loc` by `dx` pixels: down at its centre, a stepped move, up. */
async function drag(ctx, loc, dx, label) {
  await moveTo(ctx, loc, label);
  const box = await loc.boundingBox();
  if (!box) throw new Error('nothing to drag');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await ctx.page.mouse.down();
  await ctx.page.mouse.move(x + dx, y, { steps: 20 });
  await ctx.page.mouse.up();
  await L.settle(ctx.page);
  await pace(ctx, 1500);
}

/** The Gantt's own prefs key (gantt-engine.ts PREFS_KEY), and the prefs the clip opens the Gantt with: the stored
 *  ones (or none) with dependencies, absences and the critical path off and milestones below the tasks, so those
 *  toggles switch their layer ON, as the narration says. Milestones stay on: the clip drags one before its View
 *  section, and viewToggle shows that layer off and on again. Stamped v2 (GANTT_PREFS_VERSION), with every status
 *  shown: under v2 an empty status list means "show nothing". */
export const GANTT_PREFS_KEY = 'aipm-cockpit:gantt-prefs';
const GANTT_STATUSES = ['open', 'completed', 'overdue'];
export function ganttPrefsSeed(current) {
  const base = current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  const statuses = Array.isArray(base.statuses) && base.statuses.length ? base.statuses : GANTT_STATUSES;
  return {
    ...base, statuses, v: 2,
    showDependencies: false, showAbsences: false, showCriticalPath: false, showMilestones: true, milestonePlacement: 'below',
  };
}

/** Off camera, before the Gantt first opens: the View layers off (ganttPrefsSeed). The app reads its prefs when
 *  the Gantt mounts, so it opens with them. */
const ganttLayersOff = step('gantt-layers-off', {
  setup: true,
  run: async (ctx) => {
    const current = await ctx.page.evaluate((k) => localStorage.getItem(k), GANTT_PREFS_KEY);
    let parsed = null;
    try { parsed = current ? JSON.parse(current) : null; } catch { parsed = null; }
    await ctx.page.evaluate(([k, v]) => localStorage.setItem(k, v), [GANTT_PREFS_KEY, JSON.stringify(ganttPrefsSeed(parsed))]);
  },
});

/** What shows a layer on the chart, where something does: the dependency arrows' marker, absence bands
 *  (titled "<person>: <type> <from>–<to>"), milestone rows. Critical path and inline placement are checked by
 *  their toggle's pressed state only. */
const LAYER_SHOWS = {
  'view-dependencies': (ctx) => main(ctx).locator('#gantt-arrow').count(),
  'view-absences': (ctx) => main(ctx).locator('[title]').evaluateAll((els) => els.filter((e) => /: \S+ \d{4}-\d\d-\d\d/.test(e.getAttribute('title'))).length),
  'view-milestones': (ctx) => main(ctx).getByRole('slider', { name: /^Move milestone – / }).count(),
};

/** A Gantt View-menu layer: opened, toggled on with its caption, closed, and checked: the toggle reads pressed
 *  and, where the chart shows the layer, it is there. */
const viewToggle = (id, label, text) => step(id, {
  run: async (ctx) => {
    await caption(ctx, text, `f-gantt-${id}`);
    const view = main(ctx).getByRole('button', { name: 'View', exact: true });
    await click(ctx, view, 'View', 500);
    const toggle = ctx.page.locator(DLG).last().getByRole('button', { name: label, exact: true });
    // A layer already on (milestones: the clip drags one before this) is switched off and on again, so the
    // toggle is seen showing its layer. The chart's re-layout may close the menu in between: it is reopened.
    if ((await toggle.getAttribute('aria-pressed')) === 'true') {
      await click(ctx, toggle, label, 900);
      if (!(await toggle.isVisible().catch(() => false))) await click(ctx, view, 'View', 500);
    }
    await click(ctx, toggle, label, 1800);
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') throw new Error(`View: ${label} did not switch on`);
    await ctx.page.keyboard.press('Escape');
    await pace(ctx, 1500);
    if (LAYER_SHOWS[id] && !(await LAYER_SHOWS[id](ctx))) throw new Error(`View: ${label} is on, but nothing on the chart shows it`);
  },
});

// ---- f-workload: the reassign moves the counts; the planned load is moved by hand ----
const MAYA = 'Maya Patel';
const LIAM = 'Liam Foster';
/** Maya's and Liam's near-term planned utilisation (%) after the rebalance: down from 240, up from 0. */
const MAYA_NOW = 100;
const LIAM_NOW = 60;
/** The Open column of a Workload row (Assignee, Email, Open, Overdue, …); Overdue is the next one. */
const OPEN_CELL = 2;
const utilCell = (ctx, who) => main(ctx).getByRole('spinbutton', { name: `Near-term utilization for ${who}`, exact: true });
/** A person's Workload row, found by its utilisation field (a role query: RAID's hidden table also names people). */
const workloadRow = (ctx, who) => main(ctx).locator('tbody').getByRole('row')
  .filter({ has: ctx.page.getByRole('spinbutton', { name: `Near-term utilization for ${who}`, exact: true }) });
async function workloadCounts(ctx, who) {
  const cells = workloadRow(ctx, who).locator('td, th');
  return { open: Number(await cells.nth(OPEN_CELL).innerText()), overdue: Number(await cells.nth(OPEN_CELL + 1).innerText()) };
}
const nearTerm = async (ctx, who) => Number(await utilCell(ctx, who).inputValue());

/** What is wrong with the counts after one overdue task of Maya's went to Liam, or null: Maya one open and one
 *  overdue fewer, Liam one of each more. */
export function countsMoved(before, after) {
  const want = { [MAYA]: -1, [LIAM]: 1 };
  for (const who of [MAYA, LIAM]) {
    for (const k of ['open', 'overdue']) {
      if (after[who][k] - before[who][k] !== want[who]) return `${who} ${k} went from ${before[who][k]} to ${after[who][k]}`;
    }
  }
  return null;
}

/** What is wrong with the planned utilisation after the rebalance, or null: Maya's lower, Liam's higher. */
export function utilMoved(before, after) {
  if (!(after[MAYA] < before[MAYA])) return `${MAYA} util did not come down (${before[MAYA]} → ${after[MAYA]})`;
  if (!(after[LIAM] > before[LIAM])) return `${LIAM} util did not go up (${before[LIAM]} → ${after[LIAM]})`;
  return null;
}

// §742: a bar's drag handles are sliders (keyboard-operable), not buttons.
const bar = (ctx, kind) => main(ctx).getByRole('slider', { name: `${kind} – ${BAR_TASK}`, exact: true }).first();

export const FEATURE_STEPS = Object.freeze({
  'f-open-points': [
    step('op-add-task', {
      run: async (ctx) => {
        await nav(ctx, 'Open Points');
        // The caption comes with the open form, so its voice runs over the filling in, not before it (§715:
        // no stretch over 8 s without a voice).
        const d = await openNewTask(ctx);
        await caption(ctx, 'Add a task: name, owner, due date.', 'f-open-points-add');
        await fillNewTask(ctx, d, NEW_TASK, 'Sofia Ramirez', '2026-10-09');
      },
    }),
    step('op-sort', {
      run: async (ctx) => {
        await caption(ctx, 'Sort by any column.', 'f-open-points-sort');
        await click(ctx, main(ctx).getByRole('button', { name: 'Due', exact: true }), 'sort by Due', 1500);
      },
    }),
    step('op-filter-assignee', {
      run: async (ctx) => {
        await caption(ctx, 'Filter by person.', 'f-open-points-filter');
        const who = main(ctx).locator('select').filter({ has: ctx.page.locator('option', { hasText: 'All assignees' }) }).first();
        await choose(ctx, who, { label: 'Sofia Ramirez' }, 'assignee filter');
        await pace(ctx, 2000);
      },
    }),
    step('op-set-status', {
      run: async (ctx) => {
        await caption(ctx, 'Set a status right in the row.', 'f-open-points-status');
        const status = main(ctx).getByRole('combobox', { name: `Status – ${NEW_TASK}`, exact: true });
        await choose(ctx, status, 'In Progress', `Status – ${NEW_TASK}`);
        await pace(ctx, 1500);
      },
    }),
  ],

  'f-board': [
    step('board-switch', {
      run: async (ctx) => {
        await nav(ctx, 'Open Points');
        await caption(ctx, 'Switch to Board: one column per status.', 'f-board-switch');
        await click(ctx, main(ctx).getByRole('radio', { name: 'Board', exact: true }), 'Board', 1500);
      },
    }),
    step('board-drag', {
      run: async (ctx) => {
        await caption(ctx, 'Drag a card to the next column: its status follows.', 'f-board-drag');
        const card = main(ctx).getByRole('button', { name: DEMO_CRM_TASK, exact: true }).first();
        await moveTo(ctx, card, DEMO_CRM_TASK);
        await card.dragTo(main(ctx).locator('[aria-label="In Progress"]').first());
        await L.settle(ctx.page);
        await pace(ctx, 2000);
      },
    }),
  ],

  'f-swimlanes': [
    step('swimlanes-switch', {
      run: async (ctx) => {
        await nav(ctx, 'Open Points');
        await caption(ctx, 'Swimlanes: the board, one lane per person.', 'f-swimlanes-lanes');
        await click(ctx, main(ctx).getByRole('radio', { name: 'Swimlanes', exact: true }), 'Swimlanes', 2000);
      },
    }),
    step('swimlanes-grouping', {
      run: async (ctx) => {
        // Lanes are always per person; on the demo every person already has one, so the clip narrows them
        // to open work instead.
        await caption(ctx, 'Hide finished work: the lanes keep only what is open.', 'f-swimlanes-hide-done');
        await click(ctx, main(ctx).getByRole('button', { name: /^Hide finished/ }).first(), 'Hide finished', 300);
        await L.settle(ctx.page);
        await pace(ctx, 2000);
      },
    }),
  ],

  // The clip opens on the Gantt (its banner), so the shared dedup step uses the Gantt's own button.
  'f-gantt': [
    dedup,
    step('drag-bar-move', {
      run: async (ctx) => {
        await nav(ctx, 'Gantt');
        await caption(ctx, 'Drag a bar: start and end move together.', 'f-gantt-drag-bar');
        await drag(ctx, bar(ctx, 'Move task (changes start and due date)'), 60, 'bar');
      },
    }),
    step('drag-bar-end', {
      run: async (ctx) => {
        await caption(ctx, 'Drag its right edge: the due date moves.', 'f-gantt-drag-end');
        await drag(ctx, bar(ctx, 'Change due date'), 50, 'bar end');
      },
    }),
    step('drag-bar-start', {
      run: async (ctx) => {
        await caption(ctx, 'Drag its left edge: the start moves, the duration changes.', 'f-gantt-drag-start');
        await drag(ctx, bar(ctx, 'Change start date'), -40, 'bar start');
      },
    }),
    step('drag-milestone', {
      run: async (ctx) => {
        await caption(ctx, 'Drag a milestone to a later date.', 'f-gantt-drag-milestone');
        await drag(ctx, main(ctx).getByRole('slider', { name: new RegExp(`^Move milestone – ${LATE_MILESTONE}`) }).first(), 60, LATE_MILESTONE);
      },
    }),
    step('filter-completed', {
      run: async (ctx) => {
        await caption(ctx, 'Status filter: hide what is completed.', 'f-gantt-status-filter');
        await click(ctx, main(ctx).getByRole('button', { name: /^Status – / }), 'Status filter', 500);
        const done = ctx.page.getByRole('menuitemcheckbox', { name: 'Completed', exact: true })
          .or(ctx.page.getByRole('checkbox', { name: 'Completed', exact: true })).first();
        await click(ctx, done, 'Completed', 1500);
        await ctx.page.keyboard.press('Escape');
        await pace(ctx, 1500);
      },
    }),
    viewToggle('view-dependencies', 'Dependencies', 'View: dependencies, what must finish before what.'),
    viewToggle('view-absences', 'Absences', 'View: absences on the timeline.'),
    viewToggle('view-critical-path', 'Critical path', 'View: the critical path.'),
    viewToggle('view-milestones', 'Milestones', 'View: milestones.'),
    viewToggle('view-inline-milestones', 'Inline milestones', 'View: milestones inline, in the task rows.'),
    ganttLayersOff,
  ],

  'f-milestones': [
    step('milestones-list', {
      run: async (ctx) => {
        await nav(ctx, 'Milestones');
        await caption(ctx, 'Every milestone, its date and what is linked to it.', 'f-milestones-list');
        // By role, which leaves out hidden rows: RAID's table stays mounted while hidden, and comes first.
        await moveTo(ctx, main(ctx).locator('tbody').getByRole('row').first(), 'first milestone row');
        await pace(ctx, 2500);
      },
    }),
    step('milestones-add', {
      run: async (ctx) => {
        await caption(ctx, 'Add a milestone.', 'f-milestones-add');
        await click(ctx, main(ctx).getByRole('button', { name: '+ New milestone', exact: true }), 'New milestone', 1000);
        const d = ctx.page.locator(DLG).last();
        await type(ctx, d.getByRole('textbox', { name: /^Name/ }), 'Security sign-off', 'milestone name');
        await d.locator('input[type=date]').first().fill('2026-10-16');
        await click(ctx, d.getByRole('button', { name: 'Save milestone', exact: true }), 'Save milestone');
      },
    }),
    step('milestones-horizon', {
      run: async (ctx) => {
        await caption(ctx, 'The horizon on top: overdue, this week, the next two weeks, later.', 'f-milestones-horizon');
        await moveTo(ctx, main(ctx).getByRole('button', { name: /^Milestone: / }).first(), 'horizon milestone');
        await pace(ctx, 3000);
      },
    }),
  ],

  'f-changes': [
    step('changes-open', {
      run: async (ctx) => {
        await caption(ctx, 'Open a change request.', 'f-changes-open');
        await openRow(ctx, 'Changes', 'Add MFA to SSO scope');
        await pace(ctx, 1500);
      },
    }),
    step('changes-impact', {
      run: async (ctx) => {
        await caption(ctx, 'Its impact: rating and what it does to scope, time and cost.', 'f-changes-impact');
        await moveTo(ctx, ctx.page.locator(DLG).last().getByRole('combobox', { name: 'Impact', exact: true }), 'Impact');
        await pace(ctx, 2500);
      },
    }),
    step('changes-status', {
      run: async (ctx) => {
        await caption(ctx, 'And its status, through review to a decision.', 'f-changes-status');
        const d = ctx.page.locator(DLG).last();
        await choose(ctx, d.getByRole('combobox', { name: 'Status', exact: true }), 'Approved', 'change status');
        await pace(ctx, 1200);
        await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save change');
      },
    }),
  ],

  'f-directory': [
    step('directory-list', {
      run: async (ctx) => {
        await resources(ctx, 'Directory');
        await caption(ctx, 'The directory: everyone who works on the project.', 'f-directory-list');
        await pace(ctx, 2500);
      },
    }),
    step('directory-person', {
      run: async (ctx) => {
        await caption(ctx, 'Open a person: role, contact, working time.', 'f-directory-person');
        await click(ctx, main(ctx).getByRole('button', { name: 'Noah Bennett', exact: true }).first(), 'Noah Bennett', 2500);
        await ctx.page.keyboard.press('Escape');
      },
    }),
    step('directory-roles', {
      run: async (ctx) => {
        await resources(ctx, 'Manage roles');
        await caption(ctx, 'Roles and rates: internal and external, per hour or per day.', 'f-directory-roles');
        await pace(ctx, 3000);
      },
    }),
  ],

  'f-absences': [
    step('absences-add', {
      run: async (ctx) => {
        await resources(ctx, 'Directory');
        await caption(ctx, 'Log an absence: who, what kind, from when to when.', 'f-absences-log');
        await click(ctx, main(ctx).getByRole('button', { name: '+ Add absence', exact: true }), 'Add absence');
        const d = ctx.page.locator(DLG).last();
        await absenceAssignee(ctx, d, 'Liam Foster');
        await click(ctx, d.getByText('Vacation', { exact: true }), 'Vacation', 300);
        await d.locator('input[type=date]').nth(0).fill('2026-09-28');
        await d.locator('input[type=date]').nth(1).fill('2026-10-02');
        await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save absence');
      },
    }),
    step('absences-calendar', {
      run: async (ctx) => {
        await resources(ctx, 'Calendar');
        await caption(ctx, 'It shows in the calendar, next to the meetings.', 'f-absences-calendar');
        // A day cell is named "<person> — <day>: <kind> — <from>–<to>": the absence's first day.
        await moveTo(ctx, main(ctx).getByRole('button', { name: 'Liam Foster — 2026-09-28: Vacation — 2026-09-28–2026-10-02', exact: true }), 'Liam Foster vacation');
        await pace(ctx, 3000);
      },
    }),
  ],

  'f-planning': [
    step('planning-capacity', {
      run: async (ctx) => {
        await resources(ctx, 'Planning');
        await caption(ctx, 'Plan how much of each month a person gives the project.', 'f-planning-month');
        await setUtilization(ctx, 'Liam Foster', '2026-10', 60);
        await setUtilization(ctx, 'Liam Foster', '2026-11', 80);
        await pace(ctx, 2000);
      },
    }),
  ],

  'f-workload': [
    step('workload-overloaded', {
      run: async (ctx) => {
        await resources(ctx, 'Workload');
        await caption(ctx, 'Maya is booked far over capacity.', 'f-workload-over');
        await moveTo(ctx, main(ctx).getByRole('spinbutton', { name: 'Near-term utilization for Maya Patel', exact: true }), 'Maya Patel utilization');
        await pace(ctx, 2500);
      },
    }),
    step('workload-reassign', {
      run: async (ctx) => {
        await caption(ctx, 'Reassign one of her overdue tasks.', 'f-workload-reassign');
        ctx.workloadBefore = { [MAYA]: await workloadCounts(ctx, MAYA), [LIAM]: await workloadCounts(ctx, LIAM) };
        await click(ctx, main(ctx).getByRole('button', { name: `Triage overdue tasks – ${MAYA}`, exact: true }), 'Triage', 1000);
        const owner = ctx.page.getByRole('combobox', { name: /^Owner – / }).first();
        await choose(ctx, owner, { label: LIAM }, 'reassign owner');
        await L.settle(ctx.page);
        await pace(ctx, 1200);
        await ctx.page.keyboard.press('Escape');
      },
    }),
    step('workload-counts', {
      run: async (ctx) => {
        await caption(ctx, 'The counts follow the task: one open and overdue fewer for Maya, one more for Liam.', 'f-workload-counts');
        await moveTo(ctx, workloadRow(ctx, MAYA).locator('td, th').nth(OPEN_CELL), `${MAYA} open`);
        await pace(ctx, 1500);
        await moveTo(ctx, workloadRow(ctx, LIAM).locator('td, th').nth(OPEN_CELL), `${LIAM} open`);
        await pace(ctx, 1500);
        const after = { [MAYA]: await workloadCounts(ctx, MAYA), [LIAM]: await workloadCounts(ctx, LIAM) };
        const wrong = countsMoved(ctx.workloadBefore, after);
        if (wrong) throw new Error(`workload: ${wrong}`);
      },
    }),
    step('workload-rebalance', {
      run: async (ctx) => {
        await caption(ctx, "Util (now) is planned time, not tasks: lower Maya's, raise Liam's.", 'f-workload-rebalance');
        const before = { [MAYA]: await nearTerm(ctx, MAYA), [LIAM]: await nearTerm(ctx, LIAM) };
        for (const [who, value] of [[MAYA, MAYA_NOW], [LIAM, LIAM_NOW]]) {
          const cell = utilCell(ctx, who);
          await type(ctx, cell, String(value), `${who} util`);
          await cell.press('Tab');
          await L.settle(ctx.page);
        }
        await pace(ctx, 1500);
        const wrong = utilMoved(before, { [MAYA]: await nearTerm(ctx, MAYA), [LIAM]: await nearTerm(ctx, LIAM) });
        if (wrong) throw new Error(`workload: ${wrong}`);
      },
    }),
  ],

  'f-raid': [
    step('raid-types', {
      run: async (ctx) => {
        await nav(ctx, 'RAID');
        await caption(ctx, 'Risks, assumptions, issues and dependencies in one register.', 'f-raid-register');
        await moveTo(ctx, main(ctx).getByRole('combobox', { name: 'Filter by category', exact: true }), 'Filter by category');
        await pace(ctx, 2500);
      },
    }),
    step('raid-issue', {
      run: async (ctx) => {
        await caption(ctx, 'Open an issue.', 'f-raid-open');
        await openRow(ctx, 'RAID', DEMO_GDPR_ISSUE);
        await pace(ctx, 2000);
      },
    }),
    step('raid-link-task', {
      run: async (ctx) => {
        await caption(ctx, 'Link it to the task that fixes it.', 'f-raid-link');
        const d = ctx.page.locator(DLG).last();
        const picker = d.getByRole('combobox', { name: 'Linked tasks', exact: true }).or(d.getByRole('textbox', { name: 'Linked tasks', exact: true })).first();
        await picker.scrollIntoViewIfNeeded();
        await type(ctx, picker, 'Erasure requests', 'linked task');
        await click(ctx, ctx.page.getByRole('option', { name: new RegExp(DEMO_DUPLICATE_PAIRS[1][0]) }).first(), 'pick task', 600);
        await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save RAID');
      },
    }),
  ],

  'f-modules': [
    // Off camera: one function switched off, so the clip can switch it on.
    step('modules-off', {
      setup: true,
      run: async (ctx) => {
        await openFunctions(ctx);
        const box = ctx.page.locator(DLG).last().getByRole('checkbox', { name: MODULE, exact: true });
        if (await box.isChecked()) await box.click();
        await ctx.page.locator(DLG).last().getByRole('button', { name: 'Save', exact: true }).click();
        await L.settle(ctx.page);
        // Edit project seeds its list from the functions it last loaded: reopened before a reload, it still
        // shows this one on, and the clip's click would switch it off again.
        await ctx.page.reload();
        await L.settle(ctx.page);
      },
    }),
    step('modules-settings', {
      run: async (ctx) => {
        await caption(ctx, "Settings → Functions: this project's functions.", 'f-modules-settings');
        await openFunctions(ctx);
        await moveTo(ctx, ctx.page.locator(DLG).last().getByRole('checkbox', { name: 'Dashboard', exact: true }), 'Dashboard function');
        await pace(ctx, 2000);
      },
    }),
    step('modules-switch-on', {
      run: async (ctx) => {
        await caption(ctx, `Switch ${MODULE} on.`, 'f-modules-switch-on');
        const d = ctx.page.locator(DLG).last();
        const box = d.getByRole('checkbox', { name: MODULE, exact: true });
        if (await box.isChecked()) throw new Error(`${MODULE} is already on in Edit project`);
        await click(ctx, box, MODULE, 600);
        if (!(await box.isChecked())) throw new Error(`${MODULE} did not switch on`);
        await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save', 1200);
      },
    }),
    step('modules-nav', {
      run: async (ctx) => {
        await caption(ctx, 'It appears in the navigation.', 'f-modules-nav');
        // The sidebar is scrolled down to Settings: moveTo scrolls it until the new item is in view.
        await moveTo(ctx, ctx.page.getByRole('navigation').getByText(MODULE, { exact: true }), `nav ${MODULE}`);
        await pace(ctx, 2500);
      },
    }),
  ],

  'f-budget': [
    step('budget-setup-steps', {
      run: async (ctx) => {
        await nav(ctx, 'Budget');
        // The setup checklist hides once a project has buckets and booked hours, as the demo has.
        await caption(ctx, 'A budget: rates per role, people, a bucket per phase, and booked hours.', 'f-budget-setup');
        await moveTo(ctx, main(ctx).getByRole('button', { name: 'Role – Identity Platform – T&M', exact: true }), 'bucket roles');
        await pace(ctx, 3000);
      },
    }),
    step('budget-plan-vs-actual', {
      run: async (ctx) => {
        await caption(ctx, 'Plan against actual, per bucket and for the project.', 'f-budget-plan-actual');
        await moveTo(ctx, main(ctx).getByText(/Project total/), 'Project total');
        await pace(ctx, 3000);
      },
    }),
  ],

  'f-trends': [
    step('trends-history', {
      run: async (ctx) => {
        await nav(ctx, 'Dashboard');
        await nav(ctx, 'Trends');
        await caption(ctx, 'A snapshot every week: how the project moved.', 'f-trends-weekly');
        await pace(ctx, 3000);
      },
    }),
    step('trends-baseline', {
      run: async (ctx) => {
        await caption(ctx, 'Pick a week as the baseline to compare against.', 'f-trends-baseline');
        await click(ctx, main(ctx).getByRole('button', { name: /^Set as baseline – / }).nth(3), 'Set as baseline', 2500);
      },
    }),
  ],

  'f-stakeholders': [
    step('stakeholders-list', {
      run: async (ctx) => {
        await nav(ctx, 'Stakeholders');
        await caption(ctx, 'Everyone with a stake: organisation, influence, interest.', 'f-stakeholders-list');
        await pace(ctx, 2500);
      },
    }),
    step('stakeholders-open', {
      run: async (ctx) => {
        await caption(ctx, 'Open one.', 'f-stakeholders-open');
        await click(ctx, main(ctx).getByRole('button', { name: 'Elena Fischer', exact: true }).first(), 'Elena Fischer', 3000);
        await ctx.page.keyboard.press('Escape');
      },
    }),
  ],

  'f-raci': [
    step('raci-matrix', {
      run: async (ctx) => {
        await nav(ctx, 'Stakeholders');
        await nav(ctx, 'RACI Matrix');
        await caption(ctx, 'Who is responsible, accountable, consulted and informed, per milestone.', 'f-raci-matrix');
        await pace(ctx, 2500);
      },
    }),
    step('raci-cell', {
      run: async (ctx) => {
        await caption(ctx, 'Set one cell.', 'f-raci-cell');
        await click(ctx, main(ctx).getByRole('button', { name: 'Kickoff · Elena Fischer — Set RACI', exact: true }), 'RACI cell', 600);
        await click(ctx, ctx.page.getByRole('menuitemradio', { name: 'A', exact: true }), 'Accountable', 1500);
      },
    }),
  ],

  'f-influence': [
    step('influence-drag', {
      run: async (ctx) => {
        await nav(ctx, 'Stakeholders');
        await nav(ctx, 'Influence / Interest');
        await caption(ctx, 'Drag a stakeholder to another quadrant.', 'f-influence-drag');
        const chip = main(ctx).getByRole('button', { name: 'Edit – Sam Rivera', exact: true });
        await moveTo(ctx, chip, 'Sam Rivera');
        await chip.dragTo(main(ctx).locator('div:has(> p)', { hasText: 'Manage Closely' }).last());
        await L.settle(ctx.page);
        await pace(ctx, 2000);
      },
    }),
  ],

  'f-knowledge': [
    step('knowledge-filter', {
      run: async (ctx) => {
        await nav(ctx, 'Knowledge');
        await caption(ctx, 'Filter by where a link comes from: tasks, milestones, RAID, stakeholders.', 'f-knowledge-filter');
        await click(ctx, main(ctx).getByRole('radio', { name: /^Task\b/ }).first(), 'Task filter', 1500);
      },
    }),
    step('knowledge-search', {
      run: async (ctx) => {
        await caption(ctx, 'Or search.', 'f-knowledge-search');
        await click(ctx, main(ctx).getByRole('radio', { name: /^All\b/ }).first(), 'All', 500);
        await type(ctx, main(ctx).getByPlaceholder('Search knowledge'), 'CRM', 'search knowledge');
        await pace(ctx, 1500);
      },
    }),
    step('knowledge-jump', {
      run: async (ctx) => {
        await caption(ctx, 'Each item links to the work it belongs to.', 'f-knowledge-links');
        await moveTo(ctx, main(ctx).getByRole('button', { name: /^Unlink #\d+ Integrate CRM provisioning$/ }).first(), 'linked knowledge item');
        await pace(ctx, 2500);
      },
    }),
  ],

  'f-activity': [
    step('activity-log', {
      run: async (ctx) => {
        await nav(ctx, 'Activity');
        await caption(ctx, 'Every change: when, what, and by whom.', 'f-activity-list');
        await pace(ctx, 2500);
      },
    }),
    step('activity-filter', {
      run: async (ctx) => {
        await caption(ctx, 'Filter by kind, or by who made it.', 'f-activity-filter');
        await click(ctx, main(ctx).getByRole('radio', { name: /^RAID\b/ }).first(), 'RAID', 1500);
        await click(ctx, main(ctx).getByRole('radio', { name: /^All\b/ }).first(), 'All', 800);
      },
    }),
  ],

  'f-history': [
    // Off camera: two saved versions at two clock times, with an edit between them.
    step('history-versions', {
      setup: true,
      run: async (ctx) => {
        await saveVersion(ctx, 'Monday morning');
        await ctx.page.clock.fastForward(60 * 60 * 1000);
        const d = await openRow(ctx, 'Changes', 'Add MFA to SSO scope');
        await choose(ctx, d.getByRole('combobox', { name: 'Status', exact: true }), 'Approved', 'change status');
        await click(ctx, d.getByRole('button', { name: 'Save', exact: true }), 'Save change');
        await saveVersion(ctx, 'After the MFA approval');
      },
    }),
    step('history-open', {
      run: async (ctx) => {
        await nav(ctx, 'History');
        await caption(ctx, 'History: every saved version of the project.', 'f-history-list');
        await pace(ctx, 2500);
      },
    }),
    step('history-compare', {
      run: async (ctx) => {
        await caption(ctx, 'Pick two and compare them.', 'f-history-compare');
        const rows = main(ctx).getByRole('checkbox');
        await click(ctx, rows.first(), 'newest version', 300);
        await click(ctx, rows.nth(1), 'older version', 300);
        await click(ctx, main(ctx).getByRole('button', { name: 'Compare selected', exact: true }), 'Compare selected', 3000);
      },
    }),
  ],
});

/** Settings → Functions → this project's functions (the project editor's function list). */
async function openFunctions(ctx) {
  await nav(ctx, 'Settings');
  await click(ctx, main(ctx).getByRole('button', { name: 'Functions', exact: true }).first(), 'Functions', 500);
  await click(ctx, main(ctx).getByRole('button', { name: "Open this project's functions", exact: true }), "this project's functions", 1000);
}

// ---- preconditions (re-checked on the reworked data) ----
const text = (v) => ({ type: 'text', value: v });
const cell = (r, i) => r[i]?.value ?? null;

/** The demo project's rows of `table`, as objects of `cols`. */
async function rows(ctx, table, cols) {
  const id = await ctx.page.evaluate(() => localStorage.getItem('aipm-cockpit:turso-current-project'));
  const q = cols.map((c) => `"${c}"`).join(', ');
  return (await L.query(`SELECT ${q} FROM ${table} WHERE project_id = ?`, [text(id)]))
    .map((r) => Object.fromEntries(cols.map((c, i) => [c, cell(r, i)])));
}
/** True once `loc` matches a second element: a list renders after its nav returns, so it is waited for. */
const atLeastTwo = (loc) => loc.nth(1).waitFor({ timeout: 30000 }).then(() => true, () => false);
const isOpen = (t) => t.status !== 'Done' && t.status !== 'Cancelled';
const overlaps = (a0, a1, b0, b1) => a0 && a1 && b0 && b1 && a0 <= b1 && b0 <= a1;
/** A pipe-joined id list as stored (`linkedTaskIds` "4|5|6"). */
const ids = (s) => (s ?? '').split('|').filter(Boolean);

export const FEATURE_PRECONDITIONS = Object.freeze({
  'f-gantt': [
    {
      what: 'an absence overlapping an open task bar of its assignee',
      check: async (ctx) => {
        const tasks = (await rows(ctx, 'tasks', ['assignee', 'startDate', 'dueDate', 'status'])).filter(isOpen);
        const abs = await rows(ctx, 'absences', ['assignee', 'startDate', 'endDate']);
        return abs.some((a) => tasks.some((t) => t.assignee === a.assignee && overlaps(a.startDate, a.endDate, t.startDate, t.dueDate)));
      },
    },
    {
      what: 'a dependency chain ending in a milestone',
      check: async (ctx) => {
        const tasks = await rows(ctx, 'tasks', ['id', 'dependencies']);
        // `dependencies` is stored as "FS:1|SS:2": a task with any is the end of a chain.
        const withDeps = new Set(tasks.filter((t) => ids(t.dependencies).length > 0).map((t) => String(t.id)));
        const ms = await rows(ctx, 'milestones', ['linkedTaskIds']);
        return ms.some((m) => ids(m.linkedTaskIds).some((i) => withDeps.has(i)));
      },
    },
    {
      what: 'Done tasks inside the visible window',
      check: async (ctx) => (await rows(ctx, 'tasks', ['status', 'dueDate'])).some((t) => t.status === 'Done' && (t.dueDate ?? '') >= '2026-07-01'),
    },
    {
      what: 'at least one near-duplicate pair among open tasks',
      check: async (ctx) => {
        const open = new Set((await rows(ctx, 'tasks', ['taskName', 'status'])).filter(isOpen).map((t) => t.taskName));
        return DEMO_DUPLICATE_PAIRS.some(([a, b]) => open.has(a) && open.has(b));
      },
    },
    {
      // Last, so the recording opens on the Gantt (its opening is text, not a banner that navigates).
      what: 'the Gantt with its Deduplicate & unify',
      check: async (ctx) => {
        await nav(ctx, 'Gantt');
        // The chart renders after the nav returns: wait for the button rather than count it at once.
        return main(ctx).getByRole('button', { name: 'Deduplicate & unify – Gantt', exact: true }).waitFor({ timeout: 30000 }).then(() => true, () => false);
      },
    },
  ],
  'f-workload': [{
    what: 'an over-allocated person',
    check: async (ctx) => {
      await resources(ctx, 'Workload');
      const vals = await main(ctx).getByRole('spinbutton', { name: /^Near-term utilization for / }).evaluateAll((els) => els.map((e) => Number(e.value)));
      return vals.some((v) => v > 100);
    },
  }],
  'f-history': [{
    what: 'at least two versions',
    check: async (ctx) => { await nav(ctx, 'History'); return atLeastTwo(main(ctx).getByRole('checkbox')); },
  }],
  'f-trends': [{
    what: 'at least two snapshot rows for the project',
    check: async (ctx) => {
      await nav(ctx, 'Dashboard'); await nav(ctx, 'Trends');
      return atLeastTwo(main(ctx).getByRole('checkbox', { name: /^Select snapshot / }));
    },
  }],
});
