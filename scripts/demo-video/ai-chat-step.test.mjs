// §715 ai-chat's last step: what chat-task-in-open-points does in a rehearsal that skipped the chat's AI steps.
import { describe, expect, it } from 'vitest';
import { AI_STEPS } from './steps/ai.mjs';

const taskInOpenPoints = AI_STEPS['ai-chat'].find((s) => s.id === 'chat-task-in-open-points');

describe('chat-task-in-open-points (§715)', () => {
  it('a rehearsal without --with-ai logs that its task check was skipped, still shows its caption, and looks for no row', async () => {
    const lines = [];
    const page = { evaluate: async () => {}, waitForTimeout: async () => {}, locator: () => { throw new Error('row looked for'); } };
    const ctx = { rehearse: true, withAi: false, log: (l) => lines.push(l), page };
    await taskInOpenPoints.run(ctx);
    expect(lines).toContain('chat-task-in-open-points: task check skipped, chat-create-task makes no task without --with-ai');
    expect(lines.some((l) => l.startsWith('CAPTION The task is in Open Points'))).toBe(true);
  });

  it('a rehearsal with --with-ai still looks for the task, and fails without one', async () => {
    const page = { evaluate: async () => {}, waitForTimeout: async () => {}, locator: () => { throw new Error('row looked for'); } };
    const ctx = { rehearse: true, withAi: true, log: () => {}, page };
    await expect(taskInOpenPoints.run(ctx)).rejects.toThrow();
  });
});
