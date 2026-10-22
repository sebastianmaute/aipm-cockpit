// §715 the first-run chapter's steps: what first-project-lands does in a rehearsal that skipped the wizard's AI step.
import { describe, expect, it } from 'vitest';
import { firstProjectLands } from './steps/first-run.mjs';

describe('first-project-lands (§715)', () => {
  it('a rehearsal without --with-ai logs that its project check was skipped, still shows its captions, and awaits no dialog', async () => {
    const lines = [];
    const page = { evaluate: async () => {}, waitForTimeout: async () => {}, locator: () => { throw new Error('dialog awaited'); } };
    const ctx = { rehearse: true, withAi: false, log: (l) => lines.push(l), page };
    await firstProjectLands.run(ctx);
    expect(lines).toContain('first-project-lands: project check skipped, wizard-create makes no project without --with-ai');
    expect(lines.some((l) => l.startsWith('CAPTION The new project'))).toBe(true);
  });

  it('a rehearsal with --with-ai still checks for the project, and fails without one', async () => {
    const page = {
      locator: () => ({ filter: () => ({ waitFor: async () => {} }) }),
      getByRole: () => ({}),
      evaluate: async () => null,
      waitForTimeout: async () => {},
    };
    const ctx = { rehearse: true, withAi: true, log: () => {}, page };
    await expect(firstProjectLands.run(ctx)).rejects.toThrow();
  });
});
