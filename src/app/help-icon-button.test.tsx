// src/app/help-icon-button.test.tsx
//
// ★★ THIS FILE EXISTS BECAUSE THE BEHAVIOUR MOVED AND ITS PIN DID NOT.
// `HelpIconButton` was extracted from `ModalHeader`, but the only test of its
// focus containment is `modal-header.test.tsx`'s "keeps Tab inside the dialog
// while the help popover is open" — reachable ONLY through `ModalHeader`. A
// headerless consumer (`raci-suggest-modal.tsx` is the first) had no local pin
// at all, so deleting the popover's close button would have gone red in a file
// that names a component the change did not touch, or not at all.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpIconButton } from "./help-icon-button";
import { HELP_ENTRIES, MODAL_HELP, type HelpEntryId } from "./help-content";
import { Modal } from "./modal";
import { t } from "./i18n";

describe("HelpIconButton", () => {
  it("renders nothing when the id resolves to no entry", () => {
    // ★ ANTI-VACUITY: a positive observable in the SAME test. Without the
    // sibling, this passes against a component that failed to render at all.
    //
    // ★ The cast is the only way in — `HelpEntryId` is derived from
    // `HELP_ENTRIES_LITERAL`, so the component's own docstring calls this
    // branch unreachable for a typed caller. It is defensive code, and this
    // is what makes it observed rather than merely asserted about.
    render(
      <div>
        <button type="button">sentinel</button>
        <HelpIconButton
          lang="en-US"
          conceptId={"not-a-real-entry" as HelpEntryId}
          dialogTitle="X"
        />
      </div>,
    );
    expect(screen.getByRole("button", { name: "sentinel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Help/ })).not.toBeInTheDocument();
  });

  it("gives two dialogs' icons distinct accessible names", () => {
    // ★★ SAME conceptId, DIFFERENT dialogTitle. That is the sharper seed: it
    // proves the accessible name derives from the DIALOG TITLE and not from
    // the entry, which two different conceptIds could never isolate.
    render(
      <div>
        <HelpIconButton lang="en-US" conceptId={MODAL_HELP.raciSuggest} dialogTitle="Suggest RACI" />
        <HelpIconButton
          lang="en-US"
          conceptId={MODAL_HELP.raciSuggest}
          dialogTitle="Committee report"
        />
      </div>,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(2);
    // ★ EN DASH U+2013, matching `modalHelpAbout`'s own value. An ASCII hyphen
    // is a different string and would pass nothing.
    expect(names).toContain("Help – Suggest RACI");
    expect(new Set(names).size).toBe(names.length);
  });

  it("keeps Tab inside the dialog while the help popover is open", async () => {
    // ★★★ THE PIN THAT MOVED WITH THE COMPONENT. `PopoverPanel` pushes
    // `kind: "modal"`, so `modal.tsx` stands its own Tab trap down and defers
    // to the topmost `"modal"` entry — and `PopoverPanel`'s own cycle returns
    // WITHOUT trapping when the panel holds no focusables. A text-only panel
    // therefore stands BOTH traps down and Tab walks out of the dialog (WCAG
    // 2.4.3): measured last slice at `document.body` on the 4th press and an
    // outside control on the 5th. The popover's close button is what makes the
    // primitive's cycle engage, so deleting it turns this red.
    //
    // ★ The OUTSIDE button is the anti-vacuity half — with nowhere to escape
    // TO, "focus never left the panel" holds against a broken fixture.
    // ★ `.focus()` never proves focusability; only `userEvent.tab()` does.
    // ★ NOT a test of `kind`: `escapeOwner()` is kind-agnostic, so flipping it
    // leaves every such assertion green. This asserts where focus LANDS.
    const user = userEvent.setup();
    function label(el: Element | null): string {
      if (!el || el === document.body) return "<body>";
      return el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "<unnamed>";
    }
    render(
      <>
        <button type="button">outside the modal</button>
        <Modal open onClose={() => {}} ariaLabel="Suggest RACI dialog">
          <HelpIconButton
            lang="en-US"
            conceptId={MODAL_HELP.raciSuggest}
            dialogTitle="Suggest RACI"
          />
          <button type="button">a field in the body</button>
        </Modal>
      </>,
    );
    const entry = HELP_ENTRIES.find((e) => e.id === MODAL_HELP.raciSuggest)!;
    const popoverClose = `${t("en-US", "alertModalClose")} – ${t("en-US", entry.titleKey)}`;
    await user.click(screen.getByRole("button", { name: "Help – Suggest RACI" }));

    const whileOpen: string[] = [];
    for (let i = 0; i < 12; i++) {
      await user.tab();
      whileOpen.push(label(document.activeElement));
    }
    // ★ ASSERTED POSITIVELY, not as "never reached the outside button". A bare
    // absence is satisfied by a fixture in which Tab moves nothing and focus
    // sits on `<body>` throughout; naming the element every press must land on
    // cannot be.
    expect(whileOpen).toEqual(Array(12).fill(popoverClose));

    // ★★ THE FALSIFIER. Close the popover and the SAME twelve presses must
    // walk the modal's own controls — so "focus never left the panel" above is
    // a property of the popover, not of a fixture where Tab does nothing.
    await user.keyboard("{Escape}");
    const whileClosed: string[] = [];
    for (let i = 0; i < 12; i++) {
      await user.tab();
      whileClosed.push(label(document.activeElement));
    }
    expect(whileClosed).not.toContain("outside the modal");
    expect(whileClosed).not.toContain("<body>");
    expect(new Set(whileClosed).size).toBeGreaterThan(1);
  });
});
