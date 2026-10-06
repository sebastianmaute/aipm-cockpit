import { cleanup, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { WorkspaceTabStrip } from "./workspace-section-chrome";
import { loadI18n, t } from "./i18n";
import type { Lang } from "./i18n";
import { NAV_GROUPS, subTabsFor, type AppView } from "./nav-config";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { FEATURE_MODULES, type FeatureModuleId } from "./feature-modules";

beforeAll(async () => {
  await loadI18n("de");
});

function setup(
  lang: Lang = "en-US",
  workspaceCollapsed = false,
  subTabs: readonly { view: AppView }[] = [{ view: "milestones" }],
  features: readonly FeatureModuleId[] = [],
) {
  render(
    <WorkspaceTabStrip
      lang={lang}
      activeTab="gantt"
      setActiveTab={vi.fn()}
      workspaceCollapsed={workspaceCollapsed}
      setWorkspaceCollapsed={vi.fn()}
      resetWorkspaceSize={vi.fn()}
      features={features}
      reuseWindow={false}
      handleClearRaidTaskFilter={vi.fn()}
      subTabs={subTabs}
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

describe("WorkspaceTabStrip — every sub-tab has its own name (§672)", () => {
  // Each sub-tab is named by its view's nav label. The sub-tabs are a nav parent's children, so
  // every parent's full set is rendered in turn, with every feature module on so the main strip
  // shows all seven of its tabs, and the whole strip's tabs are scanned as well as the sub-tab
  // list. With every module on, the main strip also renders all seven popout buttons, one per main tab.
  const PARENTS = NAV_GROUPS.flatMap((g) => g.items).filter((item) => (item.children?.length ?? 0) > 0);
  const ALL_FEATURES = FEATURE_MODULES.map((m) => m.id);
  const MAIN_TABS = 7;
  const POPOUTS = 7;

  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  it("renders real German for the de case", () => {
    expect(t("de", "workspaceSubTabsLabel")).not.toBe(t("en-US", "workspaceSubTabsLabel"));
  });

  it.each(["en-US", "de"] as const)("names every sub-tab distinctly for every nav parent in %s", (lang) => {
    expect(PARENTS.length).toBeGreaterThan(1);
    for (const parent of PARENTS) {
      const subTabs = subTabsFor(parent.view);
      expect(subTabs.length).toBeGreaterThan(0);
      setup(lang, false, subTabs, ALL_FEATURES);
      const strip = screen.getByRole("tablist", { name: t(lang, "workspaceSubTabsLabel") });
      expectRowUniqueNames({ minControls: subTabs.length, scope: strip, roles: ["tab"] });
      expectRowUniqueNames({ minControls: MAIN_TABS + subTabs.length, roles: ["tab"] });
      cleanup();
    }
  });

  // Every main tab carries a popout button beside it. They all open a window, so each
  // has to say which tab it opens; a bare "Open in new window" repeated seven times names none.
  it.each(["en-US", "de"] as const)("names every popout button distinctly in %s", (lang) => {
    setup(lang, false, [], ALL_FEATURES);
    const main = screen.getByRole("tablist", { name: t(lang, "workspaceTabsLabel") });
    expectRowUniqueNames({ minControls: POPOUTS, scope: main, roles: ["button"] });
  });
});
