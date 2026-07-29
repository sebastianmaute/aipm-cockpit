import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ProjectEditModal, ProjectModalShell } from "./project-edit-modal";
import type { ProjectMeta } from "./types";

const META = {
  name: "Apollo",
  code: "APL",
  projectManager: "Jane PM",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "Acme Corp",
  naceSection: "J",
  identityTypes: [],
  products: "Widgets",
  deployment: "Cloud",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  profitCenter: "PC-1",
  contactPersons: [{ name: "Jane PM", email: "jane@example.com", synced: false }],
  regulatory: ["Not applicable"],
} as unknown as ProjectMeta;

describe("ProjectModalShell", () => {
  test("renders its title and children inside a resizable modal panel", () => {
    render(
      <ProjectModalShell lang="en-US" title="Shell title" sizeKey="test:pm" onClose={vi.fn()}>
        <p>shell body</p>
      </ProjectModalShell>,
    );
    expect(screen.getByText("shell body")).toBeInTheDocument();
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.className).toContain("resize");
    expect(panel.className).toContain("min-h-[420px]");
  });
});

describe("ProjectEditModal", () => {
  test("prefills from the given meta and submits a sanitized meta", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ProjectEditModal
        lang="en-US"
        initial={META}
        stakeholderNames={[]}
        addressBook={[]}
        resources={[]}
        sizeKey="test:pem"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Apollo")).toBeInTheDocument();
    // Headline claim: the WRITE direction reaches the caller.
    await user.click(screen.getByRole("button", { name: /edit project/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Apollo", code: "APL" });
  });
});
