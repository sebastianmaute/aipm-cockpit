// §715 demo recorder: the steps of the 20 feature clips (A's spec, tier 4). f-gantt is the owner's fixed
// script; its step ids are pinned by videos.test.mjs. See ../README.md.
import { step } from './step.mjs';
import { dedup } from './week.mjs';
import { caption, click, nav, pace, type } from '../ui.mjs';

// Visible dialogs only: a closed modal can stay in the DOM after the one on screen.
const DLG = '[role="dialog"]:visible';
const main = (ctx) => ctx.page.locator('main');
const NEW_TASK = 'Draft the pilot rollout checklist';

export const FEATURE_STEPS = Object.freeze({
  'f-open-points': [
    step('op-add-task', {
      run: async (ctx) => {
        await nav(ctx, 'Open Points');
        await caption(ctx, 'Add a task: name, owner, due date.');
        await click(ctx, main(ctx).getByRole('button', { name: 'Add task', exact: true }).first(), 'Add task');
        const d = ctx.page.locator(DLG).last();
        await type(ctx, d.getByPlaceholder('What needs to happen?'), NEW_TASK, 'task name');
        await type(ctx, d.getByPlaceholder('Assignee'), 'Sofia Ramirez', 'assignee');
        await ctx.page.keyboard.press('Escape').catch(() => {});
        await d.locator('input[type=date]').nth(1).fill('2026-10-09');
        await click(ctx, d.getByRole('button', { name: 'Add task – New task' }), 'save task', 600);
      },
    }),
    step('op-sort', {
      run: async (ctx) => {
        await caption(ctx, 'Sort by any column.');
        await click(ctx, main(ctx).getByRole('button', { name: 'Due', exact: true }), 'sort by Due', 1500);
      },
    }),
    step('op-filter-assignee', {
      run: async (ctx) => {
        await caption(ctx, 'Filter by person.');
        const who = main(ctx).locator('select').filter({ has: ctx.page.locator('option', { hasText: 'All assignees' }) }).first();
        await who.selectOption({ label: 'Sofia Ramirez' });
        await pace(ctx, 2000);
      },
    }),
    step('op-set-status', {
      run: async (ctx) => {
        await caption(ctx, 'Set a status right in the row.');
        const status = main(ctx).getByRole('combobox', { name: `Status – ${NEW_TASK}`, exact: true });
        await status.selectOption('In Progress');
        await pace(ctx, 1500);
      },
    }),
  ],
  'f-board': [step('board-switch'), step('board-drag')],
  'f-swimlanes': [step('swimlanes-switch'), step('swimlanes-grouping')],
  'f-gantt': [
    dedup,
    step('drag-bar-move'), step('drag-bar-end'), step('drag-bar-start'), step('drag-milestone'),
    step('filter-completed'),
    step('view-dependencies'), step('view-absences'), step('view-critical-path'), step('view-milestones'),
    step('view-inline-milestones'),
  ],
  'f-milestones': [step('milestones-list'), step('milestones-add'), step('milestones-horizon')],
  'f-changes': [step('changes-open'), step('changes-impact'), step('changes-status')],
  'f-directory': [step('directory-list'), step('directory-person'), step('directory-roles')],
  'f-absences': [step('absences-add'), step('absences-calendar')],
  'f-planning': [step('planning-capacity')],
  'f-workload': [step('workload-overloaded'), step('workload-reassign')],
  'f-raid': [step('raid-types'), step('raid-issue'), step('raid-link-task')],
  'f-modules': [step('modules-settings'), step('modules-switch-on'), step('modules-nav')],
  'f-budget': [step('budget-setup-steps'), step('budget-plan-vs-actual')],
  'f-trends': [step('trends-history'), step('trends-baseline')],
  'f-stakeholders': [step('stakeholders-list'), step('stakeholders-open')],
  'f-raci': [step('raci-matrix'), step('raci-cell')],
  'f-influence': [step('influence-drag')],
  'f-knowledge': [step('knowledge-filter'), step('knowledge-search'), step('knowledge-jump')],
  'f-activity': [step('activity-log'), step('activity-filter')],
  'f-history': [step('history-versions', { setup: true }), step('history-open'), step('history-compare')],
});
