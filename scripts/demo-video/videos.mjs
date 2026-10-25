// §715 demo recorder: the 43 video guides as data. Each entry is one take and one command
// (`record.mjs --video <id>`). Specs: docs/superpowers/specs/2026-10-16-video-guides-recorder-design.md
// (the clips, tiers 3 and 4) and docs/superpowers/specs/2026-10-16-demo-week-story-design.md (the big
// video and the chapters). Opening texts are the specs' (drafts where marked there); `{ banner: <view> }`
// is that view's own banner text, read from the page at take time. See README.md.
//
// Def = { id, tier, title, opening, handRecorded?, playback?, prologueOnCamera?, firstRun?, prologue?, clock?, replayThrough?,
//         preconditions: { what, check(ctx) }[], steps: Step[] }   (Step: steps/step.mjs)
import { AI_PRECONDITIONS, AI_STEPS } from './steps/ai.mjs';
import { FEATURE_PRECONDITIONS, FEATURE_STEPS } from './steps/features.mjs';
import { FIRST_RUN } from './steps/first-run.mjs';
import { INSTALL } from './steps/install.mjs';
import { FRIDAY, MONDAY, PROLOGUE, THURSDAY, TUESDAY, WEDNESDAY, demoOpens, goTo } from './steps/week.mjs';

export const TIERS = Object.freeze(['big', 'chapters', 'ai', 'features']);

const chapter = (id, title, steps, extra = {}) => ({ id, tier: 'chapters', title, opening: title, preconditions: [], steps, ...extra });

const ai = (id, title, opening) => ({ id, tier: 'ai', title, opening, preconditions: AI_PRECONDITIONS[id] ?? [], steps: AI_STEPS[id] });
const feature = (id, title, opening) => ({ id, tier: 'features', title, opening, preconditions: FEATURE_PRECONDITIONS[id] ?? [], steps: FEATURE_STEPS[id] });

const DEFS = [
  {
    id: 'big', tier: 'big', title: 'A week with the cockpit',
    opening: 'A project lead\'s week: the MVP slipped on Friday. Monday starts here.',
    prologueOnCamera: true, prologue: PROLOGUE, clock: 'mon', preconditions: [],
    steps: [...MONDAY, goTo.tue, ...TUESDAY, goTo.wed, ...WEDNESDAY, goTo.thu, ...THURSDAY, goTo.fri, ...FRIDAY],
  },

  // Recorded by hand and played back in a take (`playback`: the cut source in <out>), so it gets every chapter's
  // splash, captions, narration and music (owner, 2026-10-25). README.md "Playback chapters".
  chapter('ch1-install', 'Install: download and set up the desktop app', INSTALL, { playback: 'sources/01-ch1-install.webm' }),
  // The first run: the setup wizard explained, a first project created, then the demo (owner, 2026-10-20).
  chapter('ch2-connect', 'Get started: connect and create a project', [demoOpens], { prologueOnCamera: true, firstRun: true, prologue: FIRST_RUN, clock: 'mon' }),
  chapter('ch3-monday', 'Monday — a milestone slipped', MONDAY, { clock: 'mon' }),
  chapter('ch4-tuesday', 'Tuesday — re-plan', TUESDAY, { replayThrough: 'mon', clock: 'tue' }),
  chapter('ch5-wednesday', 'Wednesday — people', WEDNESDAY, { replayThrough: 'tue', clock: 'wed' }),
  chapter('ch6-thursday', 'Thursday — risks, stakeholders, money', THURSDAY, { replayThrough: 'wed', clock: 'thu' }),
  chapter('ch7-friday', 'Friday — close the week', FRIDAY, { replayThrough: 'thu', clock: 'fri' }),

  ai('ai-proposal', 'Set up a project with Claude', 'Describe the project in a sentence and Claude proposes its setup.'),
  ai('ai-chat', 'The AI Assistant', 'Ask the assistant anything about the project — it can also make the changes for you.'),
  ai('ai-dedup', 'Deduplicate & unify', 'Deduplicate & unify finds tasks that say the same thing and merges them.'),
  ai('ai-wbs', 'Optimize with AI', 'Optimize with AI restructures open tasks into a clear breakdown.'),
  ai('ai-inline-task', 'Ask Claude on a task', 'Ask Claude on any field to rewrite or fill it.'),
  ai('ai-inline-entity', 'Ask Claude on RAID, changes, milestones and stakeholders', 'The same works on RAID, changes, milestones and stakeholders.'),
  ai('ai-next-actions', 'Analyze next actions with AI', 'Analyze with AI explains what needs you first, and why.'),
  ai('ai-insight', 'Insight recommendations', 'Each insight can get a recommendation you can act on.'),
  ai('ai-digest', 'The status digest', 'The digest sums up what changed since you last looked.'),
  ai('ai-alloc', 'Plan allocations with AI', 'Plan with AI proposes who works how much, when.'),
  ai('ai-raci', 'Suggest RACI', 'Suggest RACI fills the matrix from your milestones and people.'),
  ai('ai-steering', 'Draft the steering report', "Draft the steering report from the project's current state."),
  ai('ai-forecast-import', 'Import a forecast with Claude', 'Import a forecast from a spreadsheet; Claude maps the columns.'),
  ai('ai-weights', 'Tune next actions with AI', 'Claude tunes how next actions are ranked from what you acted on.'),
  ai('ai-scheduled', 'Scheduled AI jobs', 'Scheduled jobs run an AI check on the project for you.'),

  feature('f-open-points', 'Open points', { banner: 'Open Points' }),
  feature('f-board', 'The board', 'The same tasks as a board — drag a card to change its status.'),
  feature('f-swimlanes', 'Swimlanes', 'Swimlanes split the board into rows, one for each person.'),
  feature('f-gantt', 'The Gantt chart', 'The Gantt chart shows tasks and milestones on a timeline. Link dependencies to see what must finish before what.'),
  feature('f-milestones', 'Milestones', { banner: 'Milestones' }),
  feature('f-changes', 'Changes', { banner: 'Changes' }),
  feature('f-directory', 'The resource directory', { banner: 'Resources' }),
  feature('f-absences', 'Absences', 'Log vacation, training and other time off — it shows on the Gantt and in workload.'),
  feature('f-planning', 'Planning', { banner: 'Resources>Planning' }),
  feature('f-workload', 'Workload', { banner: 'Resources>Workload' }),
  feature('f-raid', 'RAID', { banner: 'RAID' }),
  feature('f-modules', 'Turn functions on or off', 'Turn functions on or off per project, so the app shows only what you use.'),
  feature('f-budget', 'Budget', { banner: 'Budget' }),
  feature('f-trends', 'Trends', { banner: 'Dashboard>Trends' }),
  feature('f-stakeholders', 'Stakeholders', { banner: 'Stakeholders' }),
  feature('f-raci', 'RACI', { banner: 'Stakeholders>RACI Matrix' }),
  feature('f-influence', 'The stakeholder map', { banner: 'Stakeholders>Influence / Interest' }),
  feature('f-knowledge', 'Knowledge', { banner: 'Knowledge' }),
  feature('f-activity', 'The activity log', 'The activity log records who changed what, and when.'),
  feature('f-history', 'Version history', 'Version history keeps every saved state — compare and restore.'),
];

export const VIDEOS = Object.freeze(DEFS.map((d) => Object.freeze(d)));
