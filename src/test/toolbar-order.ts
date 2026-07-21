// Shared helper for asserting the order of a pane toolbar's buttons.
//
// Every pane's toolbar ends with the contiguous trailing group
// Print · reset-columns · reset-pane-size; destructive/bulk actions and
// integration blocks go BEFORE it. Two panels asserted that independently with
// near-identical local helpers, so it lives here once.
//
// ★ Reads DOM order, which matches VISUAL order only while the toolbar adds no
//   `order-*` utility. jsdom has no layout engine, so that assumption cannot be
//   asserted here — a mutation adding `order-first` would slip past.
import { screen } from "@testing-library/react";
import { t, type Lang, type TranslationKey } from "../app/i18n";

/** Accessible names of every rendered button, in DOM order. */
export function buttonNames(): string[] {
  // `||`, not `??`: aria-label="" returns "" (not null), which would otherwise
  // shadow the textContent fallback and contribute an empty name.
  return screen
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") || b.textContent || "");
}

/**
 * Index of the single button whose accessible name contains `key`'s translation.
 *
 * ★ Throws when the term matches zero OR MORE THAN ONE button. `findIndex`
 * silently returns the FIRST match, so a future button reusing a label would
 * quietly shift an index and let an ordering assertion pass against the wrong
 * control; and a bare -1 can read as "before everything". Both become loud here.
 */
export function buttonIndex(names: readonly string[], key: TranslationKey, lang: Lang = "en-US"): number {
  const needle = t(lang, key);
  if (!needle) throw new Error(`buttonIndex: i18n key "${key}" resolved to nothing`);
  const hits = names.reduce<number[]>((acc, n, i) => (n.includes(needle) ? [...acc, i] : acc), []);
  if (hits.length === 0) throw new Error(`buttonIndex: no button matched "${needle}" in [${names.join(" | ")}]`);
  if (hits.length > 1) throw new Error(`buttonIndex: "${needle}" matched ${hits.length} buttons — ambiguous`);
  return hits[0];
}

/**
 * Asserts the given i18n-keyed buttons appear in exactly this DOM order.
 * Each key must match exactly one button (see `buttonIndex`), so a missing or
 * duplicated control fails loudly rather than degrading into a vacuous compare.
 *
 * ★ `contiguous: true` additionally requires the buttons to be ADJACENT. Plain
 * ordering is NOT enough for the trailing Print · reset-columns · reset-size
 * group: a stray control landing between two members leaves the indices
 * ascending, so an order-only assertion would miss the exact drift these tests
 * exist to catch. Use it for the group; use plain ordering for a leading
 * control, which the convention only requires to come BEFORE the group.
 */
export function expectButtonOrder(
  keys: readonly TranslationKey[],
  opts: { lang?: Lang; contiguous?: boolean } = {},
): void {
  const lang = opts.lang ?? "en-US";
  const names = buttonNames();
  const indices = keys.map((k) => buttonIndex(names, k, lang));
  const describe = () => keys.map((k, i) => `${t(lang, k)}@${indices[i]}`).join(" , ");

  const sorted = [...indices].sort((a, b) => a - b);
  if (indices.join(",") !== sorted.join(",")) {
    throw new Error(`expectButtonOrder: expected ascending DOM order, got ${describe()}`);
  }
  if (opts.contiguous) {
    for (let i = 1; i < indices.length; i++) {
      if (indices[i] !== indices[i - 1] + 1) {
        const between = names.slice(indices[i - 1] + 1, indices[i]).join(" | ");
        throw new Error(
          `expectButtonOrder: expected adjacent buttons, got ${describe()} — found [${between}] in between`,
        );
      }
    }
  }
}
