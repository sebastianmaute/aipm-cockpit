// §715 on-camera actions: a cursor move or a select fails loudly when its target is not on screen, a select
// is picked visibly and checked, and a view's opening hint is read from the visible callout only. Fake
// locators record their calls, so no browser runs here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MOVE_TIMEOUT_MS, TYPE_BUDGET_MS, TYPE_DELAY_MS, choose, moveTo, nav, type, viewHint } from './ui.mjs';

/** A page that records the cursor's moves and the pauses; `main` never changes, so settle() ends at once. */
function fakePage(calls) {
  return {
    mouse: { move: async (x, y) => { calls.push(`mouse(${x},${y})`); } },
    waitForTimeout: async (ms) => { calls.push(`wait(${ms})`); },
    evaluate: async () => 0,
  };
}

/** A locator of `matches` elements, visible or not, the way Playwright answers: a strict call on several
 *  matches throws, a wait for a missing or hidden one times out. A select's state is { value, label, index }
 *  of its options; `takes: false` leaves it unchanged after selectOption (the app reset it), `resetLater`
 *  changes it back once the page settles, and `leaves` takes it out of the page then (its row went away). */
function fakeLoc(calls, { matches = 1, visible = true, options = [], selected = 0, takes = true, resetLater = false, leaves = false } = {}) {
  let index = selected;
  let reads = 0;
  const strict = () => { if (matches > 1) throw new Error(`strict mode violation: resolved to ${matches} elements`); };
  return {
    waitFor: async ({ timeout }) => {
      calls.push(`waitFor(${timeout})`);
      strict();
      if (!matches || !visible) throw new Error(`Timeout ${timeout}ms exceeded`);
    },
    isVisible: async () => { strict(); return matches === 1 && visible; },
    count: async () => matches,
    scrollIntoViewIfNeeded: async () => { calls.push('scroll'); },
    boundingBox: async () => (matches === 1 && visible ? { x: 100, y: 200, width: 40, height: 20 } : null),
    focus: async () => { calls.push('focus'); },
    selectOption: async (option) => {
      calls.push(`selectOption(${JSON.stringify(option)})`);
      if (!takes) return;
      const i = options.findIndex((o, n) => (typeof option === 'string' ? o.value === option || o.label === option
        : option.label != null ? o.label === option.label : option.value != null ? o.value === option.value : n === option.index));
      if (i >= 0) index = i;
    },
    // The select itself, read right after the pick and again once the page settled.
    elementHandle: async () => ({
      dispose: async () => { calls.push('dispose'); },
      evaluate: async () => {
        reads++;
        if (reads > 1 && resetLater) index = selected;
        return { ...options[index], index, connected: !(reads > 1 && leaves) };
      },
    }),
  };
}

const ctxWith = (calls) => ({ page: fakePage(calls), rehearse: true, log: () => {} });

describe('moveTo (§715)', () => {
  it('waits a short while for the target, scrolls it into view, moves the cursor to its centre and paces', async () => {
    const calls = [];
    await moveTo(ctxWith(calls), fakeLoc(calls), 'Add task');
    expect(MOVE_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    expect(calls).toEqual([`waitFor(${MOVE_TIMEOUT_MS})`, 'scroll', 'mouse(120,210)', 'wait(150)']);
  });

  it('throws on a hidden target, naming it', async () => {
    const calls = [];
    await expect(moveTo(ctxWith(calls), fakeLoc(calls, { visible: false }), 'first row')).rejects.toThrow('not visible: first row');
    expect(calls.some((c) => c.startsWith('mouse'))).toBe(false);
  });

  it('throws on a missing target', async () => {
    await expect(moveTo(ctxWith([]), fakeLoc([], { matches: 0 }), 'nav item')).rejects.toThrow('not visible: nav item');
  });

  it('throws on a target that matches several elements', async () => {
    await expect(moveTo(ctxWith([]), fakeLoc([], { matches: 3 }), 'Status')).rejects.toThrow('ambiguous (3 matches): Status');
  });
});

const STATUS = [{ value: 'Open', label: 'Open' }, { value: 'Approved', label: 'Approved' }];
const PEOPLE = [{ value: '', label: 'All assignees' }, { value: 'sofia', label: 'Sofia Ramirez' }];

describe('choose (§715)', () => {
  it('moves the cursor to the select, focuses it, selects, and checks the select holds the option', async () => {
    const calls = [];
    const loc = fakeLoc(calls, { options: STATUS });
    await choose(ctxWith(calls), loc, 'Approved', 'change status');
    const order = ['mouse(120,210)', 'focus', 'selectOption("Approved")'].map((c) => calls.indexOf(c));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect((await (await loc.elementHandle()).evaluate()).value).toBe('Approved');
  });

  it('releases the select it read, after a pick that took and after one that did not', async () => {
    const ok = [];
    await choose(ctxWith(ok), fakeLoc(ok, { options: STATUS }), 'Approved', 'change status');
    expect(ok.filter((c) => c === 'dispose')).toEqual(['dispose']);
    const bad = [];
    await expect(choose(ctxWith(bad), fakeLoc(bad, { options: STATUS, takes: false }), 'Approved', 'change status')).rejects.toThrow('did not take');
    expect(bad.filter((c) => c === 'dispose')).toEqual(['dispose']);
  });

  it('throws when the app changes the select back once the page settles', async () => {
    const loc = fakeLoc([], { options: STATUS, resetLater: true });
    await expect(choose(ctxWith([]), loc, 'Approved', 'change status')).rejects.toThrow('did not take: change status');
  });

  it('an action select that resets itself by design (`resets`) is picked visibly and left to the step to check', async () => {
    const calls = [];
    await choose(ctxWith(calls), fakeLoc(calls, { options: PEOPLE, takes: false }), { label: 'Sofia Ramirez' }, 'Add person lane', { resets: true });
    expect(calls).toContain('selectOption({"label":"Sofia Ramirez"})');
    expect(calls).toContain('mouse(120,210)');
  });

  it('accepts a select that leaves the page after the pick, when it held the option at the pick', async () => {
    const lines = [];
    const ctx = { ...ctxWith([]), log: (l) => lines.push(l) };
    await choose(ctx, fakeLoc([], { options: PEOPLE, leaves: true }), { label: 'Sofia Ramirez' }, 'reassign owner');
    expect(lines).toEqual(['choose: reassign owner left the page with the change']);
  });

  it('checks a label option by its label and an index option by its index', async () => {
    await choose(ctxWith([]), fakeLoc([], { options: PEOPLE }), { label: 'Sofia Ramirez' }, 'assignee filter');
    await choose(ctxWith([]), fakeLoc([], { options: PEOPLE }), { index: 1 }, 'second option');
  });

  it('throws when the select does not hold the option afterwards', async () => {
    const loc = fakeLoc([], { options: STATUS, takes: false });
    await expect(choose(ctxWith([]), loc, 'Approved', 'change status')).rejects.toThrow('did not take: change status');
    await expect(choose(ctxWith([]), fakeLoc([], { options: PEOPLE, takes: false }), { label: 'Sofia Ramirez' }, 'who'))
      .rejects.toThrow('did not take: who');
  });

  it('throws on a hidden or ambiguous select before selecting anything', async () => {
    const calls = [];
    await expect(choose(ctxWith(calls), fakeLoc(calls, { visible: false, options: STATUS }), 'Approved', 'Status')).rejects.toThrow('not visible: Status');
    await expect(choose(ctxWith(calls), fakeLoc(calls, { matches: 2, options: STATUS }), 'Approved', 'Status')).rejects.toThrow('ambiguous (2 matches): Status');
    expect(calls.filter((c) => c.startsWith('selectOption'))).toEqual([]);
  });
});

/** A page whose callout selector finds `hints` ({ text, visible }) in DOM order. */
function hintPage(hints) {
  const calls = [];
  const page = {
    ...fakePage(calls),
    locator: () => ({
      all: async () => hints.map((h) => ({ isVisible: async () => h.visible, innerText: async () => h.text })),
    }),
  };
  return { page, log: () => {}, rehearse: true };
}

/** A page with one nav item, visible or not; the header's title changes once the item is clicked. The click
 *  is the in-page evaluate that receives the item's name (lib.mjs openView). */
function navPage({ visible }) {
  const calls = [];
  const titles = ['Dashboard'];
  const item = {
    filter: () => item,
    first: () => item,
    waitFor: async () => { if (!visible) throw new Error('Timeout exceeded'); },
    isVisible: async () => visible,
    count: async () => 1,
    scrollIntoViewIfNeeded: async () => { calls.push('scroll'); },
    boundingBox: async () => ({ x: 0, y: 600, width: 200, height: 30 }),
  };
  const page = {
    locator: (sel) => (sel === 'header' ? { first: () => ({ innerText: async () => titles.shift() ?? 'Milestones' }) } : item),
    mouse: { move: async (x, y) => { calls.push(`mouse(${x},${y})`); } },
    waitForTimeout: async () => {},
    waitForFunction: async () => {},
    evaluate: async (_fn, arg) => { if (arg?.name) calls.push(`click(${arg.name})`); return true; },
  };
  return { ctx: { page, rehearse: true, log: () => {} }, calls };
}

describe('type (§715)', () => {
  it('types at TYPE_DELAY_MS a key, short enough that a filled form does not leave a long silence', async () => {
    const calls = [];
    const loc = {
      ...fakeLoc(calls),
      click: async () => { calls.push('click'); },
      press: async (k) => { calls.push(`press(${k})`); },
      pressSequentially: async (text, { delay }) => { calls.push(`keys(${text},${delay})`); },
    };
    await type({ ...ctxWith(calls), rehearse: false }, loc, 'Pilot', 'task name');
    expect(TYPE_DELAY_MS).toBeLessThanOrEqual(15);
    expect(calls).toContain(`keys(Pilot,${TYPE_DELAY_MS})`);
  });

  /** A field whose every typed chunk takes `msPerChunk` on a fake clock. */
  function slowField(calls, msPerChunk) {
    let t = 0;
    const loc = {
      ...fakeLoc(calls),
      click: async () => {},
      press: async () => {},
      pressSequentially: async (text) => { calls.push(`keys(${text})`); t += msPerChunk; },
      fill: async (text) => { calls.push(`fill(${text})`); },
    };
    return { loc, now: () => t };
  }

  it('types a long text in full while the page keeps up', async () => {
    const calls = [];
    const { loc, now } = slowField(calls, 100);
    await type({ ...ctxWith(calls), rehearse: false, now }, loc, 'Licence cost and one week of work', 'impact');
    const typed = calls.filter((c) => c.startsWith('keys(')).map((c) => c.slice(5, -1)).join('');
    expect(typed).toBe('Licence cost and one week of work');
    expect(calls.some((c) => c.startsWith('fill('))).toBe(false);
  });

  // Mutation: dropping the budget types every chunk however slow the page is, which left 39 s of dead air in a take.
  it('stops typing once TYPE_BUDGET_MS has passed and fills the whole text, so a slow page leaves no long silence', async () => {
    const calls = [];
    const { loc, now } = slowField(calls, TYPE_BUDGET_MS * 0.6);
    await type({ ...ctxWith(calls), rehearse: false, now }, loc, 'Licence cost and one week of work', 'impact');
    const actions = calls.filter((c) => c.startsWith('keys(') || c.startsWith('fill('));
    expect(actions).toEqual(['keys(Licence )', 'keys(cost and)', 'fill(Licence cost and one week of work)']);
  });
});

describe('nav (§715)', () => {
  it('scrolls the sidebar to the item and moves the cursor onto it before the click', async () => {
    const { ctx, calls } = navPage({ visible: true });
    await nav(ctx, 'Milestones');
    expect(calls).toEqual(['scroll', 'mouse(100,615)', 'click(Milestones)']);
  });

  it('throws, and clicks nothing, when the item never shows in the sidebar', async () => {
    const { ctx, calls } = navPage({ visible: false });
    await expect(nav(ctx, 'Milestones')).rejects.toThrow('nav: no visible item "Milestones"');
    expect(calls).toEqual([]);
  });
});

describe('viewHint, the opening of a { banner } video (§715)', () => {
  it("takes the visible callout, not RAID's hidden one that comes first in the DOM", async () => {
    const ctx = hintPage([
      { text: 'RAID: risks, assumptions, issues.', visible: false },
      { text: 'Milestones:  every   date.', visible: true },
    ]);
    expect(await viewHint(ctx, 'Milestones')).toBe('Milestones: every date.');
  });

  it('throws with the view name when no callout is visible', async () => {
    const ctx = hintPage([{ text: 'RAID: risks.', visible: false }]);
    await expect(viewHint(ctx, 'Stakeholders')).rejects.toThrow('no visible hint on Stakeholders');
  });

  it('throws when more than one callout is visible', async () => {
    const ctx = hintPage([{ text: 'A', visible: true }, { text: 'B', visible: true }]);
    await expect(viewHint(ctx, 'Budget')).rejects.toThrow('2 visible hints on Budget');
  });
});

// ---- the guard: every native <select> on camera is picked through choose() ----
const HERE = path.dirname(fileURLToPath(import.meta.url));
const STEP_FILES = [...fs.readdirSync(path.join(HERE, 'steps')).filter((f) => f.endsWith('.mjs')).map((f) => `steps/${f}`), 'setup.mjs'];

describe('no raw selectOption in the steps (§715)', () => {
  it('scans the step modules and setup.mjs', () => {
    expect(STEP_FILES).toEqual(expect.arrayContaining(['steps/features.mjs', 'steps/week.mjs', 'steps/ai.mjs', 'setup.mjs']));
  });

  it('every select is chosen through ui.choose, so it is seen and checked', () => {
    const raw = STEP_FILES.flatMap((f) => fs.readFileSync(path.join(HERE, f), 'utf8').split(/\r?\n/)
      .map((line, i) => [f, i + 1, line]).filter(([, , line]) => /\.selectOption\(/.test(line)))
      .map(([f, n, line]) => `${f}:${n}: ${line.trim()}`);
    expect(raw).toEqual([]);
  });

  it('the steps do choose: the guard is not passing over files with no select at all', () => {
    const chosen = STEP_FILES.reduce((n, f) => n + (fs.readFileSync(path.join(HERE, f), 'utf8').match(/\bchoose\(ctx,/g) ?? []).length, 0);
    expect(chosen).toBeGreaterThanOrEqual(15);
  });
});
