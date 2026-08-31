// src/app/focusables.ts
//
// The one selector for "elements sequential keyboard navigation can reach".
//
// ★★ It was copy-pasted THREE times before this file existed — modal.tsx,
// use-focus-trap.ts and undo/undo-control.tsx — and a PLANNED fourth consumer
// (a Tab cycle in popover-panel.tsx) is what forced the extraction; that call
// site may not exist yet, so grep before assuming it does. The three
// copies differed only in whitespace after the commas, which a CSS selector
// list ignores, so collapsing them changed no behaviour.
//
// ★★ Hidden and inert controls are NOT excluded — a KNOWN, INHERITED gap, not
// a handled case. `:not([disabled])` filters DISABLED, which is a different
// thing: in a real browser this selector still matches `display:none`,
// `visibility:hidden`, `hidden`-attribute and `inert`-subtree controls, and
// both modal.tsx's Tab wrap and use-focus-trap.ts will focus them. All three
// original copies had this gap; none recorded a decision about it.
// ★ A layout-based filter cannot simply be added: `offsetParent` is always
// null and `getClientRects()` always empty under jsdom, which has no layout
// engine, so such a check would exclude EVERY element and break every test in
// the unit suite. Fixing this needs a browser-level test, not a tweak here.
export const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
