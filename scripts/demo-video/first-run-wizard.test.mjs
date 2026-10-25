// §715 the first-run chapter's wizard: the project it creates is empty, as its narration says.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// click and moveTo drive a real page; here they only record what the step asks of them.
vi.mock('./ui.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  click: vi.fn(async () => {}),
  moveTo: vi.fn(async () => {}),
}));
const ui = await import('./ui.mjs');
const { wizardCreate } = await import('./steps/first-run.mjs');

/** The wizard dialog: each control is named by its role and name; the starter-content box is ticked or not. */
function ctxWith(starterTicked) {
  const dialog = {
    getByRole: (role, opts) => ({
      role,
      name: String(opts?.name),
      count: async () => 1,
      isChecked: async () => starterTicked,
    }),
  };
  const page = { locator: () => ({ last: () => dialog }), evaluate: async () => {}, waitForTimeout: async () => {} };
  return { rehearse: true, log: () => {}, page };
}
const clickLabels = () => vi.mocked(ui.click).mock.calls.map(([, , label]) => label);

describe('wizard-create (§715)', () => {
  beforeEach(() => vi.mocked(ui.click).mockClear());

  // Mutation: dropping the Blank click leaves the wizard's suggested template, whose 12 tasks and three
  // milestones the narration then calls "empty".
  it('picks Blank on the template step and unticks the starter content before Create project', async () => {
    await wizardCreate.after(ctxWith(true));
    expect(clickLabels()).toEqual(['Next (template)', 'Blank', 'Next (functions)', 'No starter content', 'Create project']);
  });

  it('leaves the starter content alone when it is already unticked', async () => {
    await wizardCreate.after(ctxWith(false));
    expect(clickLabels()).toEqual(['Next (template)', 'Blank', 'Next (functions)', 'Create project']);
  });

  it('finds Blank and the starter content by their visible names', async () => {
    await wizardCreate.after(ctxWith(true));
    const byLabel = Object.fromEntries(vi.mocked(ui.click).mock.calls.map(([, loc, label]) => [label, loc]));
    expect(byLabel.Blank).toMatchObject({ role: 'button', name: String(/^Blank/) });
    expect(byLabel['No starter content']).toMatchObject({ role: 'checkbox', name: String(/starter content/) });
  });
});
