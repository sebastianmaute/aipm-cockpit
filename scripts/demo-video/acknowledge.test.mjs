// The recorder's consent step: the AI consent dialog's accept buttons are "I understand — enable AI" and
// "I understand — allow background AI" (src/app/i18n.ts), not the bare "I understand" it once matched.
import { describe, expect, it, vi } from 'vitest';

const clicked = [];
vi.mock('./ui.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  click: async (_ctx, loc) => { clicked.push(loc.text); },
}));

const { acknowledge } = await import('./setup.mjs');

/** A page whose visible buttons are `names`; getByRole resolves the name the way Playwright does. */
function pageWith(names) {
  return {
    getByRole: (_role, { name, exact }) => {
      const hit = names.find((n) => (name instanceof RegExp ? name.test(n) : exact ? n === name : n.includes(name)));
      return { text: hit, isVisible: async () => hit !== undefined };
    },
  };
}

async function run(names) {
  clicked.length = 0;
  await acknowledge({ page: pageWith(names) });
  return [...clicked];
}

describe('acknowledge', () => {
  it.each([
    ['I understand — enable AI'],
    ['I understand — allow background AI'],
    ['I understand'],
  ])('accepts the consent dialog button "%s"', async (label) => {
    expect(await run(['Cancel', label])).toEqual([label]);
  });

  it('clicks nothing when only Cancel or Close is visible', async () => {
    expect(await run(['Cancel', 'Close'])).toEqual([]);
  });

  it('does not match a button that merely starts with the words', async () => {
    expect(await run(['I understand the risk'])).toEqual([]);
  });
});
