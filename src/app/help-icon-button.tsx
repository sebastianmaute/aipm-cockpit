"use client";

import { useCallback, useId, useRef, useState } from "react";
import { QuestionMarkCircleIcon, XMarkIcon } from "./icons";
import { HELP_ENTRIES, type HelpEntryId } from "./help-content";
import { HelpBodyText } from "./help-body-text";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";
import { PopoverPanel } from "./popover-panel";

/** The help affordance: a question-mark trigger and the popover it opens.
 *
 *  ★ EXTRACTED FROM `ModalHeader`, NOT A SECOND RENDERER. There must be exactly
 *  ONE place that renders a help popover — the headerless `Modal` sites cannot
 *  each grow their own. `ModalHeader` consumes this and its own test file passes
 *  unchanged, which is the proof the move was behaviour-preserving.
 *
 *  ★★★ THE CLOSE BUTTON BELOW IS LOAD-BEARING FOR FOCUS CONTAINMENT, not a
 *  convenience. The long comment above `<PopoverPanel>` carries the measurement;
 *  read it before deleting anything inside the panel.
 *
 *  ★ Renders NOTHING when `conceptId` resolves to no entry, so a caller cannot
 *  ship a dead trigger. That mirrors the resolved-entry guard REMOVED from
 *  `ModalHeader` in the same commit that created this file — do NOT go looking
 *  for that local, it no longer exists anywhere:
 *  `ModalHeader` gates only on the PROP being set and leaves the resolve to this
 *  component, so an unknown id is a no-op on both paths.
 *
 *  ★★ The branch is UNREACHABLE for a typed caller — `HelpEntryId` is derived
 *  from `HELP_ENTRIES_LITERAL`, so `find` cannot miss without a cast. It IS
 *  pinned, through exactly that cast: "renders nothing when the id resolves to
 *  no entry" in `help-icon-button.test.tsx`.
 *
 *  ★★ An earlier revision of this line said "defensive rather than tested. Do
 *  not read it as pinned" while that test sat in the same commit range. Read
 *  the direction of the error: an UNDERSTATED coverage claim is the rare one,
 *  and it is the one that gets a live test deleted as redundant. Unreachable
 *  for a typed caller and untested are different properties — say which. */
export function HelpIconButton({
  lang,
  conceptId,
  dialogTitle,
}: {
  lang: Lang;
  conceptId: HelpEntryId;
  /** Qualifies the trigger's accessible name. Pass the dialog's own title.
   *  ★ Two stacked dialogs otherwise put two controls named "Help" in one
   *  document; speech input does not scope by `aria-modal`, and axe has no
   *  rule that flags a duplicate accessible name. */
  dialogTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();
  // `PopoverPanel` reads this through effect dependencies, so it MUST be
  // stable — its docstring says so explicitly.
  const close = useCallback(() => setOpen(false), []);
  const entry = HELP_ENTRIES.find((e) => e.id === conceptId);
  // ★ The early return sits AFTER every hook — hoisting it above one is the
  //   rules-of-hooks violation, and `--max-warnings=0` makes that fatal.
  if (!entry) return null;
  const name = t(lang, "modalHelpAbout", dialogTitle);
  const closeName = `${t(lang, "alertModalClose")} – ${t(lang, entry.titleKey)}`;
  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        /* ★ Set only while OPEN. `aria-controls` must resolve to a node
           that EXISTS and the panel is unmounted while closed — the same
           shape as `entity-combobox-search.tsx`. */
        aria-controls={open ? panelId : undefined}
        aria-label={name}
        title={name}
        className={`rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:hover:text-ui-light-grey ${INTERACTIVE}`}
      >
        <QuestionMarkCircleIcon aria-hidden="true" className="h-4 w-4" />
      </button>
      {/* ★ SHARED PRIMITIVE, never a hand-rolled absolute panel. EVERY
          declaring modal's panel clips its overflow, and z-index
          CANNOT escape overflow — so the
          `absolute right-0 top-full` panel this replaced was clipped at
          the panel edge. `PopoverPanel` portals to `document.body` and
          positions `fixed` from the trigger's rect, which is why there
          is no `relative` wrapper left here to anchor anything.

          ★★ WHAT THE PRIMITIVE'S `kind: "modal"` BUYS AND COSTS, AND WHERE
          THAT ANALYSIS APPLIES. ★★★ THIS PARAGRAPH USED TO READ "render
          this component only inside a `Modal`" AS A FLAT REQUIREMENT. It
          is not one, and `notes-window.tsx` is the measured counterexample
          — a `kind: "layer"` window, `role="dialog"` with no `aria-modal`,
          which by design does not trap Tab. What is true is narrower: the
          Tab analysis BELOW is about a competing modal trap, so outside a
          `Modal` it does not apply, and nothing here may be read as a
          containment claim for such a host.

          ★★ THE OLD WORDING PREDICTED THE RIGHT THING AND FORBADE IT
          ANYWAY: "with no competing trap the popover cycles within
          itself". Measured on that window across twelve
          `userEvent.tab()` presses with the popover open — focus stayed on
          the popover's close button every press, while the SAME fixture
          with no icon at all reached `<body>` on press 7 and a control
          OUTSIDE the window on press 8. The escape is the host's own
          non-modal nature; the icon neither caused it nor made it earlier.

          ★★★ SO THE STANDING RULE IS A MEASUREMENT, NOT A PROHIBITION: a
          host that is not a `Modal` must MEASURE its own baseline before
          and its treatment after, and record both. A verdict without a
          baseline cannot tell "the icon broke containment" from "this host
          never had any" — and only the first of those is a regression.

          ESCAPE IS UNCHANGED. `escapeOwner()` (`dismissal-stack.ts`) is
          kind-AGNOSTIC — it walks the stack from the TOP and returns the
          first entry that claims — so the popover, pushed above the
          Modal, takes Escape and the modal stays open. That held under
          the old `usePopoverDismiss` (`kind: "layer"`, hardcoded inside
          the hook — there was never a choice at this call site) and holds
          now, so the test asserting the modal survives cannot pin the
          kind and does not claim to.

          ★★★ TAB IS THE HALF THAT CHANGES, AND THE CLOSE BUTTON BELOW IS
          WHAT MAKES IT SAFE. `kind` MEANS "traps Tab": `modal.tsx`'s Tab
          branch defers to the topmost `"modal"` entry, which is now this
          popover — and `PopoverPanel`'s own cycle returns WITHOUT
          trapping when the panel holds no focusables. A text-only panel
          would therefore stand BOTH traps down and let Tab walk out of
          the dialog (WCAG 2.4.3). MEASURED, not reasoned, by two probes
          each driving twelve `userEvent.tab()` presses inside a `Modal`
          that also rendered one button OUTSIDE it. A bare `Modal` +
          text-only `PopoverPanel` harness (four controls in the modal)
          reached `document.body` on the 4th press and the OUTSIDE button
          on the 5th, then cycled through both forever. This affordance
          with the close button below never left the panel across all
          twelve. So the button is LOAD-BEARING for containment, not
          decoration.

          ★★★ PINNED BY "keeps Tab inside the dialog while the help popover
          is open" in `help-icon-button.test.tsx` — the LOCAL one, beside
          this component. A test of that exact NAME also exists in
          `modal-header.test.tsx`, and an earlier revision here cited only
          that one; it drives SIX presses through `ModalHeader`, where the
          local test drives TWELVE against this component directly. Citing
          the distant same-named test is post-extraction citation drift: a
          reader deleting the close button gets two reds and a docstring
          pointing at the weaker of them. Both are real; cite the one that
          pins the property being described.

          ★ `autoFocus` is left at the primitive's DEFAULT (true), so
          opening lands focus on that close button. This panel is
          `role="dialog"`; leaving focus outside an open dialog is the
          shape where AT announces nothing, and the docstring's reason
          for passing `false` — a destructive first control — does not
          apply to a Close.

          ★ `max-h-[60vh] overflow-y-auto` is on the PANEL rather than an
          inner wrapper so the scroll region CONTAINS the close button:
          that keeps it keyboard-scrollable (focus sits inside the
          scroller, so arrow keys act on it) without adding a bare
          `tabIndex={0}` stop. Some bodies run past 1000 characters and
          the old panel had no height cap at all. The primitive's
          close-on-scroll listener ignores scrolls it contains, so this
          cannot dismiss itself. */}
      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        id={panelId}
        role="dialog"
        ariaLabel={t(lang, entry.titleKey)}
        className="max-h-[60vh] w-80 max-w-[90vw] overflow-y-auto p-3 text-left"
      >
        <div className="mb-1 flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">
            {t(lang, entry.titleKey)}
          </p>
          {/* ★ QUALIFIED BY THE ENTRY TITLE, never a bare "Close". A host
              dialog's own ✕ is in the same document and defaults to the
              unqualified `alertModalClose` string; two controls sharing
              an accessible name is a WCAG 2.4.6 / speech-input defect
              that axe has no rule for, so a unit test is the only
              detector. Same en-dash convention `ModalHeader`'s
              `closeLabel` documents. */}
          <button
            type="button"
            onClick={close}
            aria-label={closeName}
            title={closeName}
            className={`-mr-1 -mt-1 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue dark:hover:text-ui-light-grey ${INTERACTIVE}`}
          >
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <p className="max-w-[64ch] whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          <HelpBodyText body={t(lang, entry.bodyKey)} labelClass="font-medium text-foreground" />
        </p>
      </PopoverPanel>
    </>
  );
}
