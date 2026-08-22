import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { NavIcon, NAV_ICON_CLASS } from "./nav-icons";
import { allNavViews } from "./nav-config";
import type { AppView } from "./nav-config";

// lucide stamps `lucide lucide-<kebab-name>` on every icon, which is the only
// thing in the rendered DOM that says WHICH glyph was drawn.
const lucideName = (svg: Element) =>
  Array.from(svg.classList).find((c) => c.startsWith("lucide-")) ?? null;

// ★★★ A LITERAL TABLE, deliberately, and NOT derived from `NAV_ICON`. Deriving
// the expectation from the same map the component reads makes the test
// structurally incapable of catching a MIS-WIRED view — the two would move
// together. Mis-wiring is the defect class this whole barrel exists to guard,
// so the expectation has to be stated independently, the way `icons.test.ts`
// states its 69 rows. ★★ Four glyphs are intentionally REUSED across views
// (clock, text-align-start, and file-chart-column ×4), so do NOT "improve" this
// into a distinctness assertion: it would be a false red, and splitting those
// rows to satisfy it would be a product change smuggled in by a test.
const EXPECTED_GLYPH: Record<AppView, string> = {
  projects: "lucide-briefcase",
  "portfolio-health": "lucide-square-kanban",
  "open-points": "lucide-list",
  dashboard: "lucide-layout-grid",
  actions: "lucide-bell",
  insights: "lucide-lightbulb",
  trends: "lucide-trending-up",
  history: "lucide-clock",
  chat: "lucide-messages-square",
  gantt: "lucide-text-align-start",
  milestones: "lucide-flag",
  resources: "lucide-users",
  directory: "lucide-id-card",
  workload: "lucide-chart-column",
  calendar: "lucide-calendar",
  planning: "lucide-text-align-start",
  "manage-roles": "lucide-shield-check",
  budget: "lucide-circle-dollar-sign",
  "budget-report": "lucide-file-chart-column",
  raid: "lucide-triangle-alert",
  "raid-report": "lucide-file-chart-column",
  changes: "lucide-arrow-left-right",
  "change-report": "lucide-file-chart-column",
  stakeholders: "lucide-users-round",
  raci: "lucide-table",
  "stakeholder-map": "lucide-presentation",
  knowledge: "lucide-book-open",
  documents: "lucide-file-text",
  reports: "lucide-file-chart-column",
  activity: "lucide-zap",
  settings: "lucide-settings",
  help: "lucide-circle-question-mark",
  "learning-insights": "lucide-graduation-cap",
  "steering-committee": "lucide-landmark",
  timelog: "lucide-clock",
};

describe("NavIcon", () => {
  it("renders a decorative (aria-hidden, non-focusable) svg with geometry for every sidebar view", () => {
    for (const view of allNavViews()) {
      const { container, unmount } = render(<NavIcon view={view} />);
      const svg = container.querySelector("svg");
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute("aria-hidden")).toBe("true");
      expect(svg!.getAttribute("focusable")).toBe("false");
      // Not querySelector("path"): 5 of the 69 barrel icons render no <path> —
      // Bars2Icon draws a <line>, the two ellipsis icons draw <circle>s, and
      // Squares2X2Icon/StopIcon draw <rect>s. Squares2X2Icon is the Dashboard
      // nav icon, so a path-specific assertion is wrong for this loop
      // specifically, not merely fragile. Assert the svg drew SOME geometry...
      expect(svg!.children.length).toBeGreaterThan(0);
      // ...and that every child is a real shape, since a <title> or <g> would
      // satisfy a bare children.length check.
      expect(
        Array.from(svg!.children).every((c) =>
          /^(path|line|circle|rect|polyline|polygon|ellipse)$/.test(c.tagName),
        ),
      ).toBe(true);
      unmount();
    }
  });

  // ★★★ NEITHER ASSERTION ABOVE PINS WHICH GLYPH IS DRAWN, and an earlier
  // revision of this file stopped there believing the hole was closed. It was
  // not: a NavIcon that ignores `view` and returns ONE fixed icon for all 35
  // satisfies both, and it survived as a mutant. Identity is what this map is
  // FOR — pin it.
  it("draws the mapped glyph for each view, not merely some glyph", () => {
    for (const view of allNavViews()) {
      const { container, unmount } = render(<NavIcon view={view} />);
      expect(lucideName(container.querySelector("svg")!), `glyph for "${view}"`).toBe(
        EXPECTED_GLYPH[view],
      );
      unmount();
    }
  });

  // ★★ CONTAINMENT, not equality — an earlier cut asserted the two sets were
  // equal and went red on arrival. `EXPECTED_GLYPH` is keyed by `AppView` and
  // NAV_ICON is a `Record<AppView, AppIcon>`, so tsc already forces both to
  // cover every view in the union. `allNavViews()` is a strict SUBSET: it is
  // derived from NAV_GROUPS at runtime, so a view with an icon but no sidebar
  // group (there is one) legitimately never appears in it.
  it("pins every view the sidebar can actually render", () => {
    const pinned = new Set(Object.keys(EXPECTED_GLYPH));
    const unpinned = allNavViews().filter((v) => !pinned.has(v));
    expect(unpinned).toEqual([]);
  });

  it("uses the default size class, or a custom className when provided", () => {
    const { container: a } = render(<NavIcon view="open-points" />);
    expect(a.querySelector("svg")!.getAttribute("class")).toContain("h-5");

    const { container: b } = render(<NavIcon view="open-points" className="custom-size" />);
    const custom = b.querySelector("svg")!.getAttribute("class")!;
    expect(custom).toContain("custom-size");
    // ★ NOT toBe: lucide prepends `lucide lucide-<name>`, so exact equality is
    //   impossible. The point is that a custom className REPLACES the default
    //   size rather than joining it.
    // ★★ Tokens are DERIVED from NAV_ICON_CLASS, never restated. Two successive
    //    revisions hardcoded a subset ("h-5", then h-5|w-5) and each let a real
    //    leak through; a hardcoded list also drifts silently the moment the
    //    default gains a class.
    for (const token of NAV_ICON_CLASS.split(" ")) {
      expect(custom, `default token "${token}" leaked`).not.toContain(token);
    }
  });
});
