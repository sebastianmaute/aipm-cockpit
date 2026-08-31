import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { WorkspaceTabStrip } from "./workspace-section-chrome";
import { loadI18n } from "./i18n";
import type { Lang } from "./i18n";

beforeAll(async () => {
  await loadI18n("de");
});

function setup(lang: Lang = "en-US", workspaceCollapsed = false) {
  render(
    <WorkspaceTabStrip
      lang={lang}
      activeTab="gantt"
      setActiveTab={vi.fn()}
      workspaceCollapsed={workspaceCollapsed}
      setWorkspaceCollapsed={vi.fn()}
      resetWorkspaceSize={vi.fn()}
      features={[]}
      reuseWindow={false}
      handleClearRaidTaskFilter={vi.fn()}
      subTabs={[{ view: "milestones" }]}
    />,
  );
}

describe("WorkspaceTabStrip", () => {
  it("renders both tablists with English accessible names by default", () => {
    setup();
    expect(screen.getByRole("tablist", { name: "Workspace tabs" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Workspace sub-tabs" })).toBeInTheDocument();
  });

  // The DE dictionary is lazy — load it BEFORE asserting German output, or the
  // assertion silently reads English and passes for nothing.
  it("translates both tablists' accessible names under German", () => {
    setup("de");
    expect(screen.getByRole("tablist", { name: "Arbeitsbereich-Tabs" })).toBeInTheDocument();
    expect(screen.getByRole("tablist", { name: "Arbeitsbereich-Untertabs" })).toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Workspace tabs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Workspace sub-tabs" })).not.toBeInTheDocument();
  });

  // ★★ TWO INDEPENDENT BEHAVIOURS, so two blocks: the accessible NAME, and the
  //    fact that it rides `aria-label` rather than only `title`. Vitest aborts a
  //    block at its first failing hard assertion, so folding these together
  //    leaves the second unproved by any mutant that kills the first. They are
  //    genuinely independent despite sharing a locator: deleting the aria-label
  //    leaves `title` behind, and `title` IS a valid accessible name (accname's
  //    last resort), so the name query below still passes while the attribute
  //    assertion fails.
  it("names the collapse control", () => {
    setup();
    expect(screen.getByRole("button", { name: "Collapse workspace" })).toBeInTheDocument();
  });

  it("carries the collapse control's name in aria-label, not only in title", () => {
    // ★ Assert the VALUE. A bare `toHaveAttribute("aria-label")` passes for ANY
    //   string, including one that no longer matches what the control does.
    setup();
    const btn = screen.getByRole("button", { name: "Collapse workspace" });
    expect(btn).toHaveAttribute("aria-label", "Collapse workspace");
  });

  // The collapsed branch of the same ternary — untested until now, so an
  // inverted condition would have shipped with the expanded branch green.
  it("names the control Expand when the workspace is already collapsed", () => {
    setup("en-US", true);
    expect(screen.getByRole("button", { name: "Expand workspace" })).toBeInTheDocument();
  });

  it("carries the expand control's name in aria-label, not only in title", () => {
    setup("en-US", true);
    const btn = screen.getByRole("button", { name: "Expand workspace" });
    expect(btn).toHaveAttribute("aria-label", "Expand workspace");
  });
});
