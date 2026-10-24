// §715 A — what a take's cleanup deletes, and the recorder's week clock.
import { describe, expect, it } from 'vitest';
import { cleanupStatements, recorderProjectIds } from './cleanup.mjs';
import { T0, atDay } from './lib.mjs';

const sqls = (batches) => batches.flat().map((s) => s.sql);

describe('cleanupStatements (§715)', () => {
  it('child rows first, then the project rows', () => {
    const batches = cleanupStatements(['a', 'b'], ['tasks', 'snapshot']);
    const children = batches[0];
    expect(children.map((s) => s.sql)).toEqual([
      'DELETE FROM "tasks" WHERE project_id IN (?,?)',
      'DELETE FROM "snapshot" WHERE project_id IN (?,?)',
    ]);
    for (const s of children) expect(s.args).toEqual([{ type: 'text', value: 'a' }, { type: 'text', value: 'b' }]);
    expect(batches.at(-1).map((s) => s.sql)).toEqual(['DELETE FROM projects WHERE id IN (?,?)']);
  });

  it("clears the recorder's global stores", () => {
    const all = sqls(cleanupStatements(['a'], ['tasks']));
    expect(all).toContain('DELETE FROM "scheduled_jobs"');
    // §772: jobs live in scheduled_jobs_v2 now; the legacy table is still cleared, so the app's one-time copy finds nothing.
    expect(all).toContain('DELETE FROM "scheduled_jobs_v2"');
    expect(all).toContain('DELETE FROM "action_learning"');
  });

  it('no ids, no project deletes', () => {
    expect(sqls(cleanupStatements([], ['tasks']))).toEqual(['DELETE FROM "scheduled_jobs"', 'DELETE FROM "scheduled_jobs_v2"', 'DELETE FROM "action_learning"']);
  });
});

describe('recorderProjectIds (§715)', () => {
  const rows = [['d', 'Customer Identity Platform (demo)'], ['c', 'Customer Identity Platform'], ['x', 'Someone else']];

  it("the demo by name, a take's created project by id, nothing else", () => {
    expect(recorderProjectIds(rows, ['c'])).toEqual(['d', 'c']);
  });

  it('without a noted id, a project Claude named is left alone', () => {
    expect(recorderProjectIds(rows, [])).toEqual(['d']);
  });
});

describe('the week clock (§715)', () => {
  it('atDay is 08:30 in Berlin', () => {
    expect(atDay('mon').toISOString()).toBe('2026-09-21T06:30:00.000Z');
    expect(atDay('fri').toISOString()).toBe('2026-09-25T06:30:00.000Z');
    expect(T0.getTime()).toBe(atDay('mon').getTime());
  });
});
