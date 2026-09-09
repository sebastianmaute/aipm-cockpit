import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ProjectEditModal, ProjectModalShell } from "./project-edit-modal";
import { t } from "./i18n";
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
    // ★★ EXACT name, never the unanchored /edit project/i this used to carry.
    // The header now renders a help icon named "Help – Edit project"
    // (`MODAL_HELP.projectEdit`), built from the SAME `projectsEdit` string the
    // submit wears — so a substring match finds two buttons and the query
    // throws. An RTL string `name` is a whole-string match, so this selects the
    // submit alone, and composing it from the i18n key keeps a DE run resolving.
    await user.click(screen.getByRole("button", { name: t("en-US", "projectsEdit") }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Apollo", code: "APL" });
  });
});
