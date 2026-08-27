import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { TemplatesSection } from "./templates-section";
import { FiltersProvider } from "../filters-context";
import { WorkspaceProvider } from "../workspace-context";
import { t } from "../i18n";
import { expectRowUniqueNames } from "../../test/row-unique-names";

afterEach(() => window.localStorage.clear());

// TemplatesSection now reads the live workspace (useCurrentWorkspace) to capture
// "save current project as a template", so it needs the workspace providers.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("TemplatesSection", () => {
  it("lists the three built-in templates", () => {
    render(<TemplatesSection lang="en-US" />, { wrapper });
    expect(screen.getByText("Minimal")).toBeInTheDocument();
    expect(screen.getByText("Standard PM")).toBeInTheDocument();
    expect(screen.getByText("Full delivery")).toBeInTheDocument();
  });
  it("built-in templates have no action button", () => {
    render(<TemplatesSection lang="en-US" />, { wrapper });
    expect(screen.queryByRole("button", { name: t("en-US", "templatesDuplicate") })).toBeNull();
  });
  it("saves the current project as a user template", () => {
    render(<TemplatesSection lang="en-US" />, { wrapper });
    expect(screen.getByText(t("en-US", "templatesSaveCurrent"))).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t("en-US", "templateSaveName")), {
      target: { value: "My saved project" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateSaveAction") }));
    expect(screen.getByDisplayValue("My saved project")).toBeInTheDocument();
  });

  // §247/§248: the rename input's aria-label was the constant translated
  // "Template name" for EVERY row (not merely colliding when names match —
  // colliding always), and the Delete button carried no aria-label at all
  // (falls back to its constant CONTENT "Delete"), found while grounding this
  // task's own enumeration. Both now key off a shared per-list token. Seed
  // two user templates with the SAME name via the real save flow (there is no
  // `userTemplates` prop to seed directly — it comes from the settings hook).
  //
  // Mutation-proved: rename input -> bare constant gives "Template name" x2.
  // Mutation-proved: Delete button -> aria-label removed entirely gives "Delete" x2.
  it("keeps every per-row control distinct when two user templates share a name", () => {
    render(<TemplatesSection lang="en-US" />, { wrapper });
    const nameInput = screen.getByLabelText(t("en-US", "templateSaveName"));
    const saveButton = screen.getByRole("button", { name: t("en-US", "templateSaveAction") });
    fireEvent.change(nameInput, { target: { value: "Copy" } });
    fireEvent.click(saveButton);
    fireEvent.change(nameInput, { target: { value: "Copy" } });
    fireEvent.click(saveButton);

    // Measured (`expectRowUniqueNames` with minControls set high, then read
    // the printed list): the save-name textbox + Save button + 2 rename
    // textboxes + 2 Delete buttons = 6.
    expectRowUniqueNames({
      minControls: 6,
      roles: ["textbox", "button"],
      requireCollisionSeed: true,
    });
  });
});
