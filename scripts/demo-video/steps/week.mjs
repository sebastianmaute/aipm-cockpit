// §715 demo recorder: the demo week — the prologue and Monday to Friday, one array of steps per day, in
// the order of docs/superpowers/specs/2026-10-16-demo-week-story-design.md, "The week". The big video
// joins them; each chapter records one day after replaying the days before it. See ../README.md.
import { step } from './step.mjs';

// ---- prologue (end of chapter 2): the wizard to its last step with Claude's proposal, then cancel ----
export const wizardProposal = step('wizard-proposal', { ai: true });
export const PROLOGUE = [wizardProposal];

// ---- shared across days and clips ----
export const digestGenerate = step('digest-generate', { ai: true });
export const dedup = step('dedup', { ai: true });

// ---- Monday — a milestone slipped ----
export const MONDAY = [
  step('mon-dashboard'),
  digestGenerate,
  step('mon-next-actions'),
  step('analyze-next-actions', { ai: true }),
  step('crm-blocker'),
  step('knowledge-crm'),
  step('draft-elena'),
  step('chat-update-elena', { ai: true }),
];

// ---- Tuesday — re-plan ----
export const TUESDAY = [
  step('board-crm-in-progress'),
  step('delete-duplicate'),
  dedup,
  step('change-connector'),
  step('impact-ask-claude', { ai: true }),
  step('draft-maya'),
  step('chat-update-maya', { ai: true }),
  step('milestone-redemo'),
  step('redemo-ask-claude', { ai: true }),
  step('bucket-planned-hours'),
  step('forecast-import', { ai: true }),
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

/** Moves the page clock to 08:30 on `day` (in the big video, between two days). */
export const goTo = Object.freeze(Object.fromEntries(
  ['tue', 'wed', 'thu', 'fri'].map((d) => [d, step(`day-${d}`, { run: (ctx) => ctx.goToDay(d) })]),
));

/** The demo opens: a short look at the Dashboard, the closing step of chapter 2. */
export const demoOpens = step('demo-opens');
