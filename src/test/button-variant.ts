// Shared assertion for "this control renders the `Button` primitive's SECONDARY
// (bordered-chip) variant". Lives here rather than being re-derived per file
// because the obvious spelling of it is VACUOUS and every copy has to dodge the
// same trap.
//
// ★★★ `toContain("bg-surface")` PASSES AGAINST `ghost`. The ghost variant is
// `bg-transparent text-foreground hover:bg-surface-muted` — the substring
// `bg-surface` sits inside `hover:bg-surface-muted`, so a substring check
// matches the exact variant such a test exists to reject. Every check below is
// WORD-BOUNDED (`/(^|\s)token(\s|$)/`) for that reason. The same trap applies
// to any token that is a prefix of a longer utility, so keep new checks bounded.
//
// ★★ WHICH CHECK KILLS WHICH VARIANT, read off `button.tsx` `VARIANT_CLASS`:
//   primary      `bg-ui-dark-blue text-white …`              — both checks kill it
//   ghost        `bg-transparent … hover:bg-surface-muted`   — both checks kill it
//   destructive  `border border-ui-pink/40 bg-surface …`     — `border-line` ONLY
// `destructive` carries a STANDALONE `bg-surface` of its own, so `bg-surface`
// does no work against it and `border-line` is the load-bearing check. Do not
// credit `bg-surface` with separating `secondary` from `destructive`.
//
// ★ Pre-migration HAND-ROLLED markup is per-site and deliberately NOT covered
// here — the budget bucket actions were `border border-transparent …` while the
// FX refresh control was `border border-ui-dark-blue bg-surface …`, so a single
// shared negative would be unfalsifiable at one of them. A call site that must
// also reject its own old markup adds that negative itself, having checked the
// removed classes rather than copying a neighbour's.

// ★★★ `border-line` + `bg-surface` alone do NOT identify the `Button` primitive.
// `ToggleButton`'s UNPRESSED state is `border-line bg-surface text-foreground
// hover:bg-surface-muted focus:ring-ui-green` (`toggle-button.tsx`) — the same two
// standalone tokens — so an unpressed ToggleButton, or any hand-rolled
// `border-line bg-surface` chip of the kind this slice is migrating AWAY from,
// satisfies both checks. `cursor-pointer` is the discriminator: it is in
// `Button`'s `BASE_CLASS` and absent from `ToggleButton`'s `BASE`, whose only
// cursor utility is `disabled:cursor-not-allowed` — which a bounded matcher
// cannot hit. (`disabled:cursor-not-allowed` does not CONTAIN `cursor-pointer`,
// so this one token would survive an unbounded check too — it is bounded for the
// same reason as the others, so a future `hover:cursor-pointer`-shaped utility
// cannot silently satisfy it.)
const BOUNDED_TOKENS = ["border-line", "bg-surface", "cursor-pointer"] as const;

/** Best-effort name for a failure message (matches `toolbar-order`'s rule:
 *  `||`, not `??`, so an `aria-label=""` cannot shadow the text fallback). */
function describeButton(el: HTMLElement): string {
  return el.getAttribute("aria-label") || el.textContent?.trim() || "(unnamed)";
}

/**
 * Asserts `el` carries the `secondary` variant's colour/border classes.
 *
 * ★ The tag guard catches one failure mode only — a caller that resolved a
 * non-button (`<div role="button">`, an `<a>`). It does NOT prove the element is
 * a `Button`: see the token note above, where an unpressed `ToggleButton` clears
 * the colour checks. `cursor-pointer` is what separates them. Do not read a pass
 * here as "the caller resolved the right control"; read it as "this control
 * renders the secondary variant's classes".
 */
export function expectSecondaryButton(el: HTMLElement): void {
  if (el.tagName !== "BUTTON") {
    throw new Error(
      `expectSecondaryButton: expected a <button> (the Button primitive always renders one), got <${el.tagName.toLowerCase()}>`,
    );
  }
  const cls = el.className;
  for (const token of BOUNDED_TOKENS) {
    if (!new RegExp(`(^|\\s)${token}(\\s|$)`).test(cls)) {
      throw new Error(
        `expectSecondaryButton: "${describeButton(el)}" is missing a standalone "${token}" — ` +
          `not the secondary variant. className was "${cls}"`,
      );
    }
  }
}
