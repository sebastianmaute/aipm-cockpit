// §715 recorder Task 4, the pure pieces of the clip content fixes: the Gantt prefs the clip opens with, the
// workload checks, the proposal check (NACE), the recommendation status, the scheduled-jobs query and cleanup.
import { describe, expect, it } from 'vitest';
import { countsMoved, ganttPrefsSeed, utilMoved } from './steps/features.mjs';
import { STORED_JOBS_SQL } from './steps/ai.mjs';
import { proposalMissing, recommendationNotApplied } from './steps/week.mjs';

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
    expect(recommendationNotApplied('Recommendation applied.')).toBeNull();
    expect(recommendationNotApplied("Partly applied — some changes weren't made.")).toMatch(/not applied in full/);
    expect(recommendationNotApplied('')).toBe('the recommendation shows no applied status');
  });
});

describe('the scheduled jobs (§715)', () => {
  it('reads the jobs from scheduled_jobs_v2, without its migration marker row', () => {
    expect(STORED_JOBS_SQL).toBe("SELECT data FROM scheduled_jobs_v2 WHERE id <> '__migrated__'");
  });
});
