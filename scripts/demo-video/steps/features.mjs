// §715 demo recorder: the steps of the 20 feature clips (A's spec, tier 4). f-gantt is the owner's fixed
// script; its step ids are pinned by videos.test.mjs. See ../README.md.
import { step } from './step.mjs';
import { dedup } from './week.mjs';

export const FEATURE_STEPS = Object.freeze({
  'f-open-points': [step('op-add-task'), step('op-sort'), step('op-filter-assignee'), step('op-set-status')],
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
