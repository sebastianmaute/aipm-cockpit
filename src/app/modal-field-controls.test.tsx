// src/app/modal-field-controls.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FiltersProvider } from "./filters-context";
import { ModalFieldControls } from "./modal-field-controls";
import { t } from "./i18n";
import { SETTINGS_KEY } from "./use-settings";
import { WorkspaceProvider } from "./workspace-context";

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function renderControls() {
  return render(<ModalFieldControls modalId="milestone" lang="en-US" />, { wrapper });
}

describe("ModalFieldControls", () => {
  it("renders the three tier buttons and highlights Advanced by default", () => {
    renderControls();
    const adv = screen.getByRole("button", { name: t("en-US", "fieldViewAdvanced") });
    expect(adv).toHaveAttribute("aria-pressed", "true");
  });
  it("clicking Simple updates the pressed state", () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "fieldViewSimple") }));
    expect(screen.getByRole("button", { name: t("en-US", "fieldViewSimple") })).toHaveAttribute("aria-pressed", "true");
  });
  it("opens the cog and disables required-field checkboxes", () => {
    renderControls();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "configureFields") }));
    const nameBox = screen.getByRole("checkbox", { name: t("en-US", "name") });
    expect(nameBox).toBeDisabled();
    expect(nameBox).toBeChecked();
  });
  it("wraps the controls in the bordered header strip when shown", () => {
    // The strip is owned here (not by each modal), so hiding the controls
    // removes the whole bordered band — no empty strip left behind.
    const { container } = renderControls();
    expect(container.querySelector(".border-b")).not.toBeNull();
  });

  describe("showFieldConfig opt-out", () => {
    afterEach(() => window.localStorage.removeItem(SETTINGS_KEY));

    it("renders nothing when settings.showFieldConfig is false", async () => {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ showFieldConfig: false }));
      const { container } = renderControls();
      // useSettings hydrates from localStorage asynchronously; the controls
      // disappear once the false flag lands.
      await waitFor(() => expect(container).toBeEmptyDOMElement());
    });
  });
});
