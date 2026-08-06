// src/app/modal-field-controls.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FiltersProvider } from "./filters-context";
import { ModalFieldControls } from "./modal-field-controls";
import { fieldTierTrigger } from "../test/field-tier";
import { t } from "./i18n";
import { SETTINGS_KEY } from "./use-settings";
import { WorkspaceProvider } from "./workspace-context";

const EN = "en-US" as const;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function renderControls() {
  return render(<ModalFieldControls modalId="milestone" lang={EN} />, { wrapper });
}

// Shared with the nine modal tests — see `src/test/field-tier.ts` for why the
// query must be a regex (the accessible name leads with the ACTIVE tier).
function trigger(): HTMLElement {
  return fieldTierTrigger(EN);
}

function openPopover() {
  fireEvent.click(trigger());
}

describe("ModalFieldControls trigger", () => {
  it("shows the active tier as its visible label", () => {
    renderControls();
    expect(trigger()).toHaveTextContent(t(EN, "fieldViewAdvanced"));
  });

  it("leads its accessible name with the visible label (WCAG 2.5.3)", () => {
    renderControls();
    expect(trigger()).toHaveAccessibleName(
      `${t(EN, "fieldViewAdvanced")} – ${t(EN, "configureFields")}`,
    );
  });

  it("renders no bordered strip — the control lives in the modal header now", () => {
    // Regression pin for the whole point of this change: the component used to
    // own a `border-b` band that cost every modal a row of vertical chrome.
    const { container } = renderControls();
    expect(container.querySelector(".border-b")).toBeNull();
  });
});

describe("ModalFieldControls popover", () => {
  it("keeps the tier switch out of the DOM until the trigger is clicked", () => {
    renderControls();
    expect(screen.queryByRole("radio", { name: t(EN, "fieldViewSimple") })).toBeNull();
    openPopover();
    expect(screen.getByRole("radio", { name: t(EN, "fieldViewSimple") })).toBeInTheDocument();
  });

  it("checks the radio for the active tier", () => {
    renderControls();
    openPopover();
    expect(screen.getByRole("radio", { name: t(EN, "fieldViewAdvanced") })).toBeChecked();
    expect(screen.getByRole("radio", { name: t(EN, "fieldViewSimple") })).not.toBeChecked();
  });

  it("selecting a tier updates both the radio and the trigger label", () => {
    renderControls();
    openPopover();
    fireEvent.click(screen.getByRole("radio", { name: t(EN, "fieldViewSimple") }));
    expect(screen.getByRole("radio", { name: t(EN, "fieldViewSimple") })).toBeChecked();
    expect(trigger()).toHaveTextContent(t(EN, "fieldViewSimple"));
  });

  it("disables required-field checkboxes", () => {
    renderControls();
    openPopover();
    const nameBox = screen.getByRole("checkbox", { name: t(EN, "name") });
    expect(nameBox).toBeDisabled();
    expect(nameBox).toBeChecked();
  });

  it("labels the trigger Custom and checks no radio after a hand-toggle", () => {
    renderControls();
    openPopover();
    // `description` is an optional Advanced-tier milestone field: hiding it
    // leaves the visible set matching no preset, which is what "custom" means.
    fireEvent.click(screen.getByRole("checkbox", { name: t(EN, "description") }));
    expect(trigger()).toHaveTextContent(t(EN, "fieldViewCustom"));
    for (const key of ["fieldViewSimple", "fieldViewAdvanced", "fieldViewFull"] as const) {
      expect(screen.getByRole("radio", { name: t(EN, key) })).not.toBeChecked();
    }
  });

  // ★★★ The integration these two fixes exist for, pinned at APP level. Both
  // were previously covered only by `popover-panel`/`segmented-control` guards
  // built from synthetic markup — measured: `modal-field-controls.test.tsx`
  // passed with the arrow fix fully reverted. Nothing noticed that the real
  // precondition (this popover autofocuses a radio in a roving group) held, so
  // inserting a control ahead of the SegmentedControl, or changing the panel's
  // focus selector, would silently un-couple the primitives from the defect.
  it("autofocuses the CHECKED tier radio, not the first one", () => {
    renderControls();
    openPopover();
    // `PopoverPanel` autofocuses the first TAB-STOP. In a roving group that is
    // the checked radio — landing on the first radio instead put focus on
    // "Simple" in an Advanced modal, where Enter/Space would select it.
    expect(document.activeElement).toHaveAttribute("role", "radio");
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: t(EN, "fieldViewAdvanced") }),
    );
  });

  it("an arrow steps from the FOCUSED radio, so a mis-focused Simple lands on Advanced", () => {
    renderControls();
    openPopover();
    // Force focus onto the NON-checked first radio — the exact state the panel
    // used to open in. Deriving the step from `value` moved TWO positions from
    // here, landing on "Full".
    const simple = screen.getByRole("radio", { name: t(EN, "fieldViewSimple") });
    simple.focus();

    fireEvent.keyDown(simple, { key: "ArrowRight" });

    // ★ The control assertion, and it is not optional: the trigger ALREADY read
    // "Advanced" before the keypress, so "reads Advanced" alone would pass
    // against a handler that did nothing at all. Focus moving proves it ran.
    expect(document.activeElement).toBe(
      screen.getByRole("radio", { name: t(EN, "fieldViewAdvanced") }),
    );
    expect(trigger()).toHaveTextContent(t(EN, "fieldViewAdvanced"));
    expect(trigger()).not.toHaveTextContent(t(EN, "fieldViewFull"));
  });

  it("ArrowLeft from a mis-focused Simple wraps to Full", () => {
    // The positive-signal half: this one CHANGES the tier, so it cannot pass
    // against an inert handler the way the assertion above could.
    renderControls();
    openPopover();
    const simple = screen.getByRole("radio", { name: t(EN, "fieldViewSimple") });
    simple.focus();

    fireEvent.keyDown(simple, { key: "ArrowLeft" });

    expect(trigger()).toHaveTextContent(t(EN, "fieldViewFull")); // focused Simple − 1, wrapped
  });

  // The popover's third interactive region. It had no coverage before the move
  // either, so this closes a carried-forward gap rather than a regression —
  // `reset` writes `undefined`, which drops back to DEFAULT_TIER
  // (`use-modal-visibility.ts:42`), and nothing pinned that the trigger label
  // and the radio follow it out of custom mode.
  it("reset returns a custom set to the default tier, label and radio following", () => {
    renderControls();
    openPopover();
    // Arrange: the same hand-toggle as above puts the modal in custom mode.
    fireEvent.click(screen.getByRole("checkbox", { name: t(EN, "description") }));
    expect(trigger()).toHaveTextContent(t(EN, "fieldViewCustom"));
    expect(screen.getByRole("checkbox", { name: t(EN, "description") })).not.toBeChecked();

    // Act
    fireEvent.click(screen.getByRole("button", { name: t(EN, "resetToDefault") }));

    // Assert — the tier, the trigger's visible label, and the hidden field.
    expect(screen.getByRole("radio", { name: t(EN, "fieldViewAdvanced") })).toBeChecked();
    expect(trigger()).toHaveTextContent(t(EN, "fieldViewAdvanced"));
    expect(screen.getByRole("checkbox", { name: t(EN, "description") })).toBeChecked();
  });
});

describe("showFieldConfig opt-out", () => {
  afterEach(() => window.localStorage.removeItem(SETTINGS_KEY));

  it("renders nothing when settings.showFieldConfig is false", async () => {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showFieldConfig: false }));
    const { container } = renderControls();
    // useSettings hydrates from localStorage asynchronously; the trigger
    // disappears once the false flag lands.
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
