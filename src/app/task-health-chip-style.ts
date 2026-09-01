// Active manual-health-override chip tint (task editor). Pure, i18n-free.
//
// RAG-semantic: border + background ride the canonical --rag-* role tokens
// (amber = warning orange, never purple) so the active RAG choice matches every
// RAG dot and reflows per scheme. Text stays dark-blue/light-grey (AA-safe) —
// the amber tint is a background only, never small text (--rag-amber-text fails
// AA on dark/mockup). Kept in its own module so it stays guarded against a
// raw-brand revert without pushing task-form-fields.tsx over the size ratchet.
import type { Health } from "./health";

// ★★★ THE TRAILING `!` IS LOAD-BEARING, NOT STYLE NOISE. Since open-followups
// §55 the chips are `ToggleButton`s, and this map arrives as that primitive's
// `className` — which is APPENDED VERBATIM to its own pressed classes
// (`border-[var(--control-state-border)] bg-ui-dark-blue/10 …`). Class-attribute
// ORDER decides nothing in CSS: two same-property utilities of equal specificity
// are resolved by their order in Tailwind's GENERATED stylesheet, which no call
// site controls. Without `!` the dark-blue border and tint can therefore win and
// the RAG hue — the only thing carrying WHICH health was picked — silently
// disappears. `!` beats a non-important declaration whatever the order, so the
// hue is pinned by the cascade rather than by luck. Repo idiom (see AGENTS.md's
// `stroke-[2]!` note); Tailwind v4 puts the modifier last, after any variant.
// ★ Only the properties that genuinely COLLIDE carry it. `text-ui-dark-blue` /
//   `dark:text-ui-light-grey` are byte-identical to the primitive's own, so they
//   would resolve the same either way.
// ★ `hover:` is NEW here. The primitive hovers to `bg-ui-dark-blue/20`, which on
//   a red chip is the wrong hue outright; re-pointing it at the chip's own token
//   keeps the pressed hover consistent with every other ToggleButton in the app.
//   (Before §55 an active chip had no hover response at all.)
// ★★ jsdom applies no stylesheet, so NOTHING in the unit suite can observe this
//    — the tests below pin the class STRINGS, and the cascade itself is
//    eye-verify-only.
export const HEALTH_CHIP_ACTIVE_CLASS: Record<Health, string> = {
  R: "border-[var(--rag-red)]! bg-[var(--rag-red)]/10! text-ui-dark-blue hover:bg-[var(--rag-red)]/20! dark:bg-[var(--rag-red)]/15! dark:text-ui-light-grey",
  A: "border-[var(--rag-amber)]! bg-[var(--rag-amber)]/10! text-ui-dark-blue hover:bg-[var(--rag-amber)]/20! dark:bg-[var(--rag-amber)]/15! dark:text-ui-light-grey",
  G: "border-[var(--rag-green)]! bg-[var(--rag-green)]/10! text-ui-dark-blue hover:bg-[var(--rag-green)]/20! dark:bg-[var(--rag-green)]/15! dark:text-ui-light-grey",
};
