import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { WorkspaceTabStrip } from "./workspace-section-chrome";
import { loadI18n } from "./i18n";
import type { Lang } from "./i18n";

beforeAll(async () => {
  await loadI18n("de");
});

function setup(lang: Lang = "en-US") {
  render(
    <WorkspaceTabStrip
      lang={lang}
      activeTab="gantt"
      setActiveTab={vi.fn()}
      workspaceCollapsed={false}
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

  it("names the collapse control without relying on title", () => {
    // ★ `title` alone IS a valid accessible name (accname's last resort), so this
    //   assertion passes today. The point is the ATTRIBUTE, which is what voice
    //   control and touch AT actually reach — assert on that directly.
    setup();
    const btn = screen.getByRole("button", { name: "Collapse workspace" });
    expect(btn).toHaveAttribute("aria-label");
  });
});
