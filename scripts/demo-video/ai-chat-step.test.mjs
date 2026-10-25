// §715 ai-chat's last step: what chat-task-in-open-points does in a rehearsal that skipped the chat's AI steps.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// nav and moveTo drive a real page; here they only record what the step asks of them.
vi.mock('./ui.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  nav: vi.fn(async () => {}),
  moveTo: vi.fn(async () => {}),
}));
const ui = await import('./ui.mjs');
const { AI_STEPS } = await import('./steps/ai.mjs');

const taskInOpenPoints = AI_STEPS['ai-chat'].find((s) => s.id === 'chat-task-in-open-points');
const chain = { locator: () => chain, getByRole: () => chain, filter: () => chain, first: () => chain };
const ctxFor = (withAi, lines = []) => ({
  rehearse: true, withAi, log: (l) => lines.push(l),
  page: { evaluate: async () => {}, waitForTimeout: async () => {}, locator: () => chain },
});

describe('chat-task-in-open-points (§715)', () => {
  beforeEach(() => { vi.mocked(ui.nav).mockClear(); vi.mocked(ui.moveTo).mockClear(); });

  it('a rehearsal without --with-ai opens Open Points and shows its caption, but looks for no task row', async () => {
    const lines = [];
    await taskInOpenPoints.run(ctxFor(false, lines));
    expect(vi.mocked(ui.nav).mock.calls.map(([, name]) => name)).toEqual(['Open Points']);
    expect(vi.mocked(ui.moveTo)).not.toHaveBeenCalled();
    expect(lines).toContain('chat-task-in-open-points: task check skipped, chat-create-task makes no task without --with-ai');
    expect(lines.some((l) => l.startsWith('CAPTION The task is in Open Points'))).toBe(true);
  });

  it('a rehearsal with --with-ai moves to the task row the chat created', async () => {
    await taskInOpenPoints.run(ctxFor(true));
    expect(vi.mocked(ui.nav).mock.calls.map(([, name]) => name)).toEqual(['Open Points']);
    expect(vi.mocked(ui.moveTo).mock.calls.map(([, , label]) => label)).toEqual(['Book the CRM vendor call']);
  });
});
