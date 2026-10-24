// §715 recorder Task 4, the pure pieces of the clip content fixes: the Gantt prefs the clip opens with, the
// workload checks, the proposal check (NACE), the recommendation status, the scheduled-jobs query and cleanup.
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { loadPrefs } from '../../src/app/gantt-engine.ts';
import { MIGRATED_MARKER_ID, SCHEDULED_JOBS_DDL } from '../../src/app/scheduled-jobs-store.ts';
import { SCHEDULED_REPORTS_DDL } from '../../src/app/scheduled-reports-schema.ts';
import { GANTT_PREFS_KEY, countsMoved, ganttPrefsSeed, utilMoved } from './steps/features.mjs';
import { MIGRATED_MARKER, REPORT_FOR_JOB_SQL, STORED_JOBS_SQL, jobsFromRows } from './steps/ai.mjs';
import { EMPTY_PLAN, REC_OUTCOMES, REC_STATUS, proposalMissing, recOutcomeCheck, recommendationNotApplied } from './steps/week.mjs';
import { en, t } from '../../src/app/i18n.ts';

describe('ganttPrefsSeed (§715)', () => {
  it('switches off the layers the clip turns on, keeps milestones (dragged before) and puts them below', () => {
    const seed = ganttPrefsSeed({ sort: 'auto', statuses: ['open'], showDependencies: true, showAbsences: true, showCriticalPath: true, showMilestones: false, milestonePlacement: 'inline', showGrid: true, v: 2 });
    expect(seed).toEqual({
      sort: 'auto', statuses: ['open'], showGrid: true, v: 2,
      showDependencies: false, showAbsences: false, showCriticalPath: false, showMilestones: true, milestonePlacement: 'below',
    });
  });

  it('with nothing stored, shows every status: under v2 an empty list would show nothing', () => {
    expect(ganttPrefsSeed(null).statuses).toEqual(['open', 'completed', 'overdue']);
    expect(ganttPrefsSeed({ statuses: [] }).statuses).toEqual(['open', 'completed', 'overdue']);
    expect(ganttPrefsSeed('garbage').v).toBe(2);
  });
});

describe('the workload checks (§715)', () => {
  const before = { 'Maya Patel': { open: 6, overdue: 1 }, 'Liam Foster': { open: 1, overdue: 0 } };

  it('accepts one open and overdue task moved from Maya to Liam', () => {
    expect(countsMoved(before, { 'Maya Patel': { open: 5, overdue: 0 }, 'Liam Foster': { open: 2, overdue: 1 } })).toBeNull();
  });

  it('names a count that did not move', () => {
    expect(countsMoved(before, { 'Maya Patel': { open: 6, overdue: 1 }, 'Liam Foster': { open: 1, overdue: 0 } })).toBe('Maya Patel open went from 6 to 6');
    expect(countsMoved(before, { 'Maya Patel': { open: 5, overdue: 0 }, 'Liam Foster': { open: 2, overdue: 0 } })).toBe('Liam Foster overdue went from 0 to 0');
  });

  it("wants Maya's planned load down and Liam's up", () => {
    expect(utilMoved({ 'Maya Patel': 240, 'Liam Foster': 0 }, { 'Maya Patel': 100, 'Liam Foster': 60 })).toBeNull();
    expect(utilMoved({ 'Maya Patel': 240, 'Liam Foster': 0 }, { 'Maya Patel': 240, 'Liam Foster': 60 })).toMatch(/Maya Patel util did not come down/);
    expect(utilMoved({ 'Maya Patel': 240, 'Liam Foster': 0 }, { 'Maya Patel': 100, 'Liam Foster': 0 })).toMatch(/Liam Foster util did not go up/);
  });
});

describe("the proposal check (§715)", () => {
  it('wants a name, GDPR ticked and a NACE section', () => {
    expect(proposalMissing({ name: 'Customer Identity Platform', gdpr: true, nace: 'G' })).toBeNull();
    expect(proposalMissing({ name: '', gdpr: true, nace: 'G' })).toBe('no proposal');
    expect(proposalMissing({ name: 'X', gdpr: false, nace: 'G' })).toBe('GDPR not ticked');
    expect(proposalMissing({ name: 'X', gdpr: true, nace: '' })).toBe('NACE section not filled');
  });
});

describe('the recommendation status after Apply (§715)', () => {
  it('passes only "Recommendation applied."', () => {
    const applied = en.insightRecommendationApplied;
    expect(recommendationNotApplied([applied])).toBeNull();
    expect(recommendationNotApplied([applied, applied])).toBeNull();
    expect(recommendationNotApplied([en.insightRecommendationAppliedPartial])).toMatch(/not applied in full/);
    // A change that threw: the card reads applied, the toast does not.
    expect(recommendationNotApplied([applied, en.insightRecommendationApplyFailed])).toBe(`the recommendation was not applied in full: "${en.insightRecommendationApplyFailed}"`);
    expect(recommendationNotApplied([])).toBe('the recommendation shows no applied status');
  });

  // The two lines with a {0} slot (§782's failure toasts), each pinned to its i18n.ts key like every other line.
  const SLOTTED = ['insightRecommendationApplyFailedDetail', 'insightRecommendationStalePartialDetail'];
  const check = recOutcomeCheck(en);

  it("copies the recommendation's outcome lines and the empty-plan line from the app's i18n.ts", () => {
    expect(check.mismatched).toEqual([]);
    expect(check.absent).toEqual([]);
    expect(EMPTY_PLAN).toBe(en.insightRecommendationEmptyPlan);
  });

  it('classifies a failure line with its {0} filled as a failure', () => {
    const slotted = Object.entries(REC_OUTCOMES).filter(([, line]) => line.includes('{0}'));
    expect(slotted.map(([key]) => key)).toEqual(SLOTTED);
    for (const [key, line] of slotted) {
      const filled = line.replace('{0}', 'create_task: taskName, assignee required');
      expect(REC_STATUS.test(filled), key).toBe(true);
      expect(recommendationNotApplied([en.insightRecommendationApplied, filled]), key)
        .toBe(`the recommendation was not applied in full: "${filled}"`);
    }
  });

  it('matches an outcome line whole, never another app string with the same opening', () => {
    for (const line of Object.values(REC_OUTCOMES)) expect(REC_STATUS.test(line), line).toBe(true);
    for (const other of [t('en-US', 'inlineAiEditRejected', 'x'), en.chatProposalFailed, en.wbsPlanSkippedTitle, 'Partly applied']) {
      expect(REC_STATUS.test(other), other).toBe(false);
    }
  });

  // Every outcome key the app has must be one the step knows, or a new outcome line would fail a take as an
  // unknown status. The keys are found by prefix (OUTCOME_KEY): an outcome key named outside those prefixes is
  // invisible to this test. §782's insightRecommendationCallArgsRequired, …CallArgDate and …CallNotAllowed do not
  // match the prefixes: they are the reasons placed into the two {0} lines, not lines of their own.
  it(`knows every outcome key of the app's i18n.ts (${check.matched} matched)`, () => {
    expect(check.matched).toBeGreaterThan(0);
    expect(check.unknown).toEqual([]);
  });
});

describe('the seed, read back by the app (§715)', () => {
  afterEach(() => localStorage.clear());

  it("is what gantt-engine.ts loadPrefs reads under the recorder's key: the three layers off, milestones on and below, every status", () => {
    localStorage.setItem(GANTT_PREFS_KEY, JSON.stringify(ganttPrefsSeed(null)));
    const p = loadPrefs();
    expect([p.showDependencies, p.showAbsences, p.showCriticalPath]).toEqual([false, false, false]);
    expect([p.showMilestones, p.milestonePlacement]).toEqual([true, 'below']);
    expect(p.statuses).toEqual(['open', 'completed', 'overdue']);
  });
});

describe('the scheduled jobs, against the app schema (§715)', () => {
  /** A database with the app's own scheduled-jobs and scheduled-reports tables. */
  function db() {
    const d = new DatabaseSync(':memory:');
    for (const sql of [...SCHEDULED_JOBS_DDL, ...SCHEDULED_REPORTS_DDL]) d.exec(sql);
    return d;
  }
  /** Rows as L.query returns them: each cell { value }. */
  const asCells = (rows) => rows.map((r) => Object.values(r).map((v) => ({ value: v })));

  it("uses the app's marker id", () => {
    expect(MIGRATED_MARKER).toBe(MIGRATED_MARKER_ID);
  });

  it('reads the job rows of scheduled_jobs_v2, never the migration marker', () => {
    const d = db();
    d.prepare('INSERT INTO scheduled_jobs_v2 (id, data) VALUES (?, ?)').run(MIGRATED_MARKER_ID, '1');
    d.prepare('INSERT INTO scheduled_jobs_v2 (id, data) VALUES (?, ?)').run('1', JSON.stringify({ name: 'Morning check', key: 'k1', history: [{ ok: true }] }));
    const jobs = jobsFromRows(asCells(d.prepare(STORED_JOBS_SQL).all()));
    expect(jobs).toEqual([{ name: 'Morning check', key: 'k1', history: [{ ok: true }] }]);
  });

  it("finds the report of this take's job by its key, the newest first", () => {
    const d = db();
    const add = d.prepare('INSERT INTO scheduled_reports (id, project_id, job_key, slot, status, ok, ran_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    add.run('r-old', 'p', 'k-old', 's1', 'done', 1, '2026-09-20T07:05:00Z', '{}');
    add.run('r1', 'p', 'k1', 's1', 'done', 1, '2026-09-21T07:05:00Z', '{}');
    add.run('r0', 'p', 'k1', 's0', 'done', 1, '2026-09-20T07:05:00Z', '{}');
    expect(d.prepare(REPORT_FOR_JOB_SQL).all('k1').map((r) => r.id)).toEqual(['r1']);
    expect(d.prepare(REPORT_FOR_JOB_SQL).all('k-none')).toEqual([]);
  });

  it('a row that is not JSON fails naming the table and the row', () => {
    expect(() => jobsFromRows([[{ value: '7' }, { value: '{not json' }]])).toThrow(/^scheduled_jobs_v2 row 7 is not JSON: /);
  });
});
