import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { TemplatesSection } from "./templates-section";
import { FiltersProvider } from "../filters-context";
import { WorkspaceProvider } from "../workspace-context";
import { t } from "../i18n";

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
  it("duplicating a built-in adds a user template row", () => {
    render(<TemplatesSection lang="en-US" />, { wrapper });
    const dup = screen.getAllByRole("button", { name: t("en-US", "templatesDuplicate") });
    fireEvent.click(dup[0]);
    expect(screen.getByDisplayValue(/copy/i)).toBeInTheDocument();
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
});
