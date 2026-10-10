// §688 — icon-only buttons that used to hand-roll IconButton's box now render
// IconButton itself. Each assertion compares the WHOLE className with what the
// primitive renders for the same size and extras (iconButtonClassFor), so a
// regression to a hand-rolled class, or a size drift, fails here. The header
// triggers were `p-2` (36px); the owner chose IconButton `md` (32px) over a new
// larger size (2026-10-09).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { iconButtonClassFor } from "../test/button-variant";
import { t } from "./i18n";
import { ColumnConfigPopover } from "./column-config-popover";
import { HelpIconButton } from "./help-icon-button";
import { HELP_ENTRIES, type HelpEntryId } from "./help-content";
import { ExportMenu } from "./export-menu";
import { ToastProvider } from "./toast-context";
import { emptyWorkspace } from "./workspace";
import { VersionMenu } from "./version-menu";
import { ApplyTemplateMenu, SaveTemplateMenu } from "./template-menus";
import { WorkspaceTabStrip } from "./workspace-section-chrome";
import { ArrangementTile } from "./arrangement-tile";

const MD = iconButtonClassFor({ size: "md" });

describe("§688 — header and toolbar triggers render IconButton md", () => {
  it("column configuration gear", () => {
    render(<ColumnConfigPopover lang="en-US" cols={[]} hidden={new Set()} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }).className).toBe(MD);
  });

  it("help trigger, and the help panel's close at the default size", () => {
    const conceptId = HELP_ENTRIES[0].id as HelpEntryId;
    render(<HelpIconButton lang="en-US" conceptId={conceptId} dialogTitle="Budget" />);
    const trigger = screen.getByRole("button", { name: t("en-US", "modalHelpAbout", "Budget") });
    expect(trigger.className).toBe(MD);
    fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: new RegExp(`^${t("en-US", "alertModalClose")} – `) });
    expect(close.className).toBe(iconButtonClassFor({ className: "-mr-1 -mt-1 shrink-0" }));
  });

  it("export menu", () => {
    const ws = { ...emptyWorkspace(), plan: { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month" as const, currency: "EUR" as const } };
    render(
      <ToastProvider value={{ showToast: vi.fn(), showToastAction: vi.fn() }}>
        <ExportMenu lang="en-US" workspace={ws} />
      </ToastProvider>,
    );
    expect(screen.getByRole("button", { name: t("en-US", "exportTitle") }).className).toBe(MD);
  });

  it("version menu", () => {
    render(<VersionMenu lang="en-US" />);
    expect(screen.getByRole("button", { name: t("en-US", "version") }).className).toBe(MD);
  });

  it("save-template and apply-template menus", () => {
    render(
      <>
        <SaveTemplateMenu lang="en-US" onSave={vi.fn()} />
        <ApplyTemplateMenu lang="en-US" templates={[]} onApply={vi.fn()} />
      </>,
    );
    expect(screen.getByRole("button", { name: t("en-US", "templateSaveTitle") }).className).toBe(MD);
    expect(screen.getByRole("button", { name: t("en-US", "templateApplyTitle") }).className).toBe(MD);
  });

  it.each([
    [false, "workspaceCollapse", "mb-1"],
    [true, "workspaceExpand", "ml-auto mb-1"],
  ] as const)("workspace collapse toggle (collapsed=%s)", (collapsed, key, extra) => {
    render(
      <WorkspaceTabStrip
        lang="en-US"
        activeTab="gantt"
        setActiveTab={vi.fn()}
        workspaceCollapsed={collapsed}
        setWorkspaceCollapsed={vi.fn()}
        resetWorkspaceSize={vi.fn()}
        features={[]}
        reuseWindow={false}
        handleClearRaidTaskFilter={vi.fn()}
        subTabs={[{ view: "milestones" }]}
      />,
    );
    expect(screen.getByRole("button", { name: t("en-US", key) }).className).toBe(iconButtonClassFor({ size: "md", className: extra }));
  });
});

describe("§688/§689 — the arrangement tile's ⋮ menu", () => {
  it("is IconButton xs (20px, the old glyph's height) drawing EllipsisVerticalIcon, not a text glyph", () => {
    render(
      <ArrangementTile id="alpha" title="Alpha board" w={2} h={2} lang="en-US" readOnly={false} keyboardReorder
        testIdPrefix="block" dragProps={{}} handleProps={{}} onOpenMenu={() => {}}>
        <p>alpha body</p>
      </ArrangementTile>,
    );
    const trigger = screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "menu");
    expect(trigger).toBeDefined();
    expect(trigger!.className).toBe(iconButtonClassFor({ size: "xs", className: "print:hidden" }));
    expect(trigger!.textContent).toBe("");
    expect(trigger!.querySelector("svg")).not.toBeNull();
  });
});

describe("§688 — the hover-revealed Ask-Claude button lives in one component", () => {
  // ★ A source check, not a DOM one: the Kanban card's old copy rendered a class
  // string byte-identical to the shared component's, so no rendered assertion
  // can tell the copy from the component (measured: the class pin passed with
  // the copy restored). The copy's class string appearing anywhere else is what
  // this entry was about.
  it("has its class string in inline-ai-edit-button.tsx only", () => {
    const dir = join(process.cwd(), "src", "app");
    const needle = "px-1.5 text-ui-dark-blue opacity-0 group-hover:opacity-100";
    const hits = (readdirSync(dir, { recursive: true }) as string[])
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .filter((f) => readFileSync(join(dir, f), "utf8").includes(needle));
    expect(hits).toEqual(["inline-ai-edit-button.tsx"]);
  });
});
