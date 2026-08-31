// src/app/focusables.ts
//
// The one selector for "elements sequential keyboard navigation can reach".
//
// ★★ It was copy-pasted THREE times before this file existed — modal.tsx,
// use-focus-trap.ts and undo/undo-control.tsx — and a fourth consumer
// (popover-panel.tsx's Tab cycle) is what forced the extraction. The three
// copies differed only in whitespace after the commas, which a CSS selector
// list ignores, so collapsing them changed no behaviour.
//
// ★ No visibility filter, on purpose. A `offsetParent`/`getClientRects` check
// fails under jsdom, which has no layout engine and reports every element as
// hidden. The `:not([disabled])` clauses already handle the common cases.
export const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
