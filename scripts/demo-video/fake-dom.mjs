// §715 test helper: a page over a tiny element tree, answering the Playwright locator calls the steps make
// (getByRole, getByText, locator, filter({ has }), or, first, last) the way Playwright does: strict on several
// matches, a wait that fails at once on a missing element. `view()` builds the tree from the test's state on
// every query, so a click (a node's `on`) changes what the next query finds. No browser runs.

/** An element: `tag`, `role`, accessible `name`, `text`, `enabled`, `pressed` (aria-pressed), `on` (its click). */
export const el = (props, ...children) => ({ ...props, children });
export const button = (name, props = {}) => el({ role: 'button', name, text: name, ...props });
export const text = (t) => el({ text: t });

const descendants = (n) => n.children.flatMap((c) => [c, ...descendants(c)]);
const matches = (value, want, exact) => value != null && (want instanceof RegExp ? want.test(value)
  : exact ? value === want : value.toLowerCase().includes(String(want).toLowerCase()));
/** The selectors the steps pass to locator(): a tag, or the visible-dialog one. */
const bySelector = (sel) => (sel.startsWith('[role="dialog"]') ? (n) => n.role === 'dialog' : (n) => n.tag === sel);

export function fakePage(view, clicks = []) {
  const page = {
    mouse: { move: async () => {} },
    keyboard: { press: async (k) => { clicks.push(`key ${k}`); } },
    waitForTimeout: async () => {},
    evaluate: async () => 0,
  };
  const loc = (steps) => {
    const resolveFrom = (roots) => steps.reduce((ns, f) => f(ns), roots);
    const nodes = () => resolveFrom([view()]);
    const add = (f) => loc([...steps, f]);
    const one = (what) => {
      const ns = nodes();
      if (ns.length > 1) throw new Error(`strict mode violation: ${what} resolved to ${ns.length} elements`);
      if (!ns.length) throw new Error(`Timeout: ${what} found nothing`);
      return ns[0];
    };
    const l = {
      resolveFrom,
      locator: (sel) => add((ns) => ns.flatMap((n) => descendants(n).filter(bySelector(sel)))),
      getByRole: (role, { name, exact } = {}) => add((ns) => ns.flatMap((n) => descendants(n)
        .filter((d) => d.role === role && (name == null || matches(d.name, name, exact))))),
      getByText: (t, { exact } = {}) => add((ns) => ns.flatMap((n) => descendants(n).filter((d) => matches(d.text, t, exact)))),
      filter: ({ has }) => add((ns) => ns.filter((n) => has.resolveFrom([n]).length > 0)),
      or: (other) => loc([(ns) => [...new Set([...resolveFrom(ns), ...other.resolveFrom(ns)])]]),
      first: () => add((ns) => ns.slice(0, 1)),
      last: () => add((ns) => ns.slice(-1)),
      count: async () => nodes().length,
      isVisible: async () => one('isVisible') && true,
      isEnabled: async () => one('isEnabled').enabled !== false,
      waitFor: async ({ state = 'visible' } = {}) => {
        const n = nodes().length;
        if (state === 'hidden' ? n > 0 : n !== 1) throw new Error(`Timeout waiting for ${state}`);
      },
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => (nodes().length === 1 ? { x: 10, y: 10, width: 40, height: 20 } : null),
      getAttribute: async (a) => (a === 'aria-pressed' ? String(!!one('getAttribute').pressed) : null),
      innerText: async () => one('innerText').text ?? '',
      click: async () => {
        const n = one('click');
        if (n.enabled === false) throw new Error(`click on a disabled ${n.name}`);
        clicks.push(n.name);
        n.on?.();
      },
    };
    return l;
  };
  const root = loc([]);
  return Object.assign(page, { locator: root.locator, getByRole: root.getByRole, getByText: root.getByText });
}
