// Shared helper for asserting that no field `<label>` has silently adopted a
// BUTTON as its labeled control.
//
// ★★★ A `<label>` with no `for` binds to its FIRST LABELABLE DESCENDANT. Among
// the elements this app uses that set is button · input · meter · output ·
// progress · select · textarea — NOT the whole story (a form-associated custom
// element is labelable too, and an `<input type="hidden">` is NOT, despite being
// an `<input>`), but the repo has neither today. A contenteditable is NOT labelable — so wrapping a rich-text field
// in a `<label>` does not label the editor at all: it labels the first TOOLBAR
// BUTTON inside it (Bold, or the dictation mic when that field has one). Two
// user-visible defects follow, both measured in Chromium (jsdom can see only
// the second — it has no CSS engine, so the hover half is untestable here):
//   1. Hovering anywhere in the label — including the text area — paints the
//      button's `:hover` state, because `:hover` matches a label's labeled
//      control while the label is hovered.
//   2. Clicking anywhere in the label that is not itself interactive content
//      forwards a synthetic click to that button (label activation behaviour),
//      so clicking into the text field toggles Bold.
// ★ Whether (2) does anything depends on the adopted button's own handlers, and
// the two hover/click halves can diverge: the dictation mic binds
// pointerdown/keydown with NO `onClick`, so when a field HAS a mic the mic is
// what gets adopted, the hover bleed still happens, and the forwarded click is
// inert. `SegmentedControl`'s radios do use `onClick`, which is why the RAID
// Category/Status rows were the severe case — clicking the caption WROTE data.
// Same trap for any widget whose first labelable descendant is a button.
//
// ★ Where the wrapper's widget ALREADY names itself, the fix is to make the
// wrapper a `<div>` and leave the caption a `<span>`: true of the rich-text
// editors (`aria-label` via `editorProps.attributes`) and of `SegmentedControl`
// (`ariaLabel` on the radiogroup), which is why those conversions lost nothing.
// ★★ It is NOT a general rule, and reading it as one strips accessible names.
// Where the wrapper legitimately names a real `<input>` and a BUTTON merely got
// in front of it, keep the `<label>` and add an explicit `htmlFor`/`id` — that
// is what `next-actions-section` does.
//
// ★★★ TWO CLASSES OF THIS DEFECT ARE INVISIBLE TO THIS HELPER UNDER jsdom. Both
// are FIXED now — (a) by `htmlFor`, (b) by `FieldGroup` — but a REGRESSION in
// either would leave this green, so do not read a green run as "the tree is
// clean". `src/app/label-binding.guard.test.ts` scans the SOURCE and is what
// actually covers them:
//   (a) DICTATION MIC before a text input — every `{…Mic}` caption (RAID/change
//       title, milestone name, four stakeholder fields). `voice.ts` `getCtor()`
//       returns null in jsdom, so `dictation-mic` renders `null` and the mic
//       never competes. In Chrome the mic WON the association. Fixed with
//       `htmlFor`/`id`, which keeps the caption on the input where it belongs —
//       EXCEPT the stakeholder NAME row, which uses `FieldGroup` instead because
//       `ResourcePicker` exposes no id for its inner input.
//       ★ What that cost varied by field and the difference matters: the change
//       title and milestone name carry neither `aria-label` nor `placeholder`,
//       so they were left with NO accessible name; the RAID title has a
//       `raidPlaceholderTitle` placeholder, which HTML-AAM treats as the
//       fallback name — a poor name, not none. Don't flatten the two.
//       ★ Cited by SYMBOL, not `file:line`: this very change inserted nine lines
//       above that placeholder and broke the line number it originally carried.
//   (b) DOCUMENT LINKS — `KnowledgeLinksField` renders per-link ✕ buttons and
//       an "add" button and no input at all, inside a `<label>` at SIX sites:
//       change-edit-modal · milestone-edit-modal · raid-edit-modal ·
//       stakeholder-edit-modal directly, plus task-form-fields and
//       project-form-fields via their `Field` helper (which renders a `<label>`
//       unless `group` is passed — so the indirection hid two of the six).
//       ★ The four direct ones now share `DocumentLinksGroup`; the two `Field`
//       ones pass `group`. `knowledge-links-field-gated` returns a bare
//       `<p>` while SharePoint is off, which is how every unit test sees it, so
//       `control` is null and the check passed over a live instance. Fixed with
//       `FieldGroup`.
// Both were found by a Chromium sweep over `label.control`, not by this helper.
//
// ★ Uses `HTMLLabelElement.control` — an IMPLEMENTATION of the association
// algorithm rather than a re-derivation of "first labelable descendant" here, so
// the assertion cannot drift from the rule it is pinning. ★★ Under vitest that
// implementation is jsdom's, not a browser's. It agreed with Chromium on every
// shape in this change (checked by probe), but the two CAN diverge — the source
// scan and a real browser sweep are what settle a disputed case.

/** `"<caption>" -> "<control name>"` for every label bound to a button. */
export function labelsBoundToButtons(root: ParentNode = document.body): string[] {
  return Array.from(root.querySelectorAll("label"))
    .filter((l) => l.control?.tagName === "BUTTON")
    .map((l) => {
      const c = l.control as HTMLElement;
      // `||`, not `??`: aria-label="" is a string and would shadow textContent.
      const name = c.getAttribute("aria-label") || c.textContent?.trim() || "(unnamed)";
      return `"${l.textContent?.trim().slice(0, 48) ?? ""}" -> button "${name}"`;
    });
}

/**
 * `"<caption>" -> htmlFor="<id>" matches nothing` for every DANGLING `htmlFor`.
 *
 * ★★★ Fix strategy (b) — keep the `<label>`, add `htmlFor`/`id` — is written by
 * hand in TWO places per field, and nothing checked that the two agree. The
 * source scan asks only whether the string `htmlFor=` is present, and
 * `labelsBoundToButtons` filters on `control?.tagName === "BUTTON"`, so a
 * MISSPELLED id has `control === null` and slips through both. What it ships is
 * precisely the defect this whole helper exists to catch: a required field with
 * no accessible name in a real browser, every gate green.
 * ★ Keyed on the attribute being PRESENT, not on `control === null` alone — a
 * label wrapping a non-labelable widget also has a null control and is a
 * legitimate shape. An `htmlFor` pointing at nothing never is.
 */
export function labelsWithDanglingFor(root: ParentNode = document.body): string[] {
  return Array.from(root.querySelectorAll("label"))
    .filter((l) => l.hasAttribute("for") && l.control === null)
    .map((l) => `"${l.textContent?.trim().slice(0, 48) ?? ""}" -> htmlFor="${l.getAttribute("for")}" matches nothing`);
}

/**
 * Labels that CONTAIN another label — invalid HTML, and the third mis-binding
 * shape.
 *
 * ★★★ Neither check above can see this one. A caption wrapping a grid of
 * checkboxes adopts the FIRST checkbox, so `labelsBoundToButtons` (which filters
 * on `tagName === "BUTTON"`) reports nothing, and the `htmlFor` check reports
 * nothing because there is no `htmlFor` to dangle. Clicking the caption ticked
 * the first box — the same user-visible defect as the button cases, differing
 * only in the tag of the adopted control.
 * ★ The nested label is the reliable tell rather than "several inputs": a
 * multi-input block is perfectly legitimate when the caption names one of them
 * via `htmlFor`. `label-binding.guard.test.ts` applies the same rule to SOURCE.
 * ★★ "Same rule" is load-bearing and was briefly untrue: the source version
 * carried an `htmlFor` exemption this one does not, so `<label htmlFor="x">`
 * around a checkbox grid passed the scan and threw here. A nested label is
 * invalid HTML regardless of `htmlFor`. If you add an exemption to either,
 * add it to BOTH or they will disagree on the same markup.
 */
export function labelsContainingLabels(root: ParentNode = document.body): string[] {
  return Array.from(root.querySelectorAll("label"))
    .filter((l) => l.querySelector("label") !== null)
    .map((l) => {
      const inner = l.querySelector("label");
      const control = l.control;
      return `"${l.textContent?.trim().slice(0, 40) ?? ""}" contains <label> "${inner?.textContent?.trim().slice(0, 24) ?? ""}" — adopts <${control?.tagName.toLowerCase() ?? "?"}${control instanceof HTMLInputElement ? ` type=${control.type}` : ""}>`;
    });
}

/**
 * Asserts no label in the rendered tree is bound to a button.
 *
 * ★ Guards its own vacuity: a tree with no labels at all, or a jsdom that did
 * not implement `label.control`, would make the primary assertion pass while
 * proving nothing. Both are loud instead.
 */
export function expectNoLabelBoundToButton(root: ParentNode = document.body): void {
  const labels = Array.from(root.querySelectorAll("label"));
  if (labels.length === 0) throw new Error("expectNoLabelBoundToButton: no <label> rendered — assertion would be vacuous");
  if (!("control" in labels[0])) throw new Error("expectNoLabelBoundToButton: HTMLLabelElement.control unsupported — assertion would be vacuous");
  const bad = labelsBoundToButtons(root);
  if (bad.length > 0) {
    throw new Error(`labels bound to a <button> instead of a field:\n  ${bad.join("\n  ")}`);
  }
  // Checked here too, so every caller of the one assertion gets both halves —
  // strategy (a) mis-binding AND strategy (b) mis-SPELLING.
  const dangling = labelsWithDanglingFor(root);
  if (dangling.length > 0) {
    throw new Error(`labels whose htmlFor resolves to nothing:\n  ${dangling.join("\n  ")}`);
  }
  // Third shape, added after a cold review found two live instances the other
  // two checks were structurally incapable of seeing.
  // ★★ Why folding it into the shared assertion is safe — and NOT the reason
  // first given here. Crediting the source scan is wrong: that scan matches
  // literal `<label>` text inside a block, so it is blind to nesting produced by
  // COMPOSITION (a `<label>` wrapping a component that itself renders one),
  // which is exactly what this DOM check adds over it. The reason that actually
  // holds is the composition case measured directly: cross-referencing every
  // component tag appearing inside a `<label>`/`<Field>` body against every
  // component defined in a file containing a literal `<label>` yields zero
  // candidates, and all pre-existing call sites pass (128 tests).
  const nested = labelsContainingLabels(root);
  if (nested.length > 0) {
    throw new Error(`labels containing a nested <label> (invalid HTML; caption adopts the inner control):\n  ${nested.join("\n  ")}`);
  }
}
