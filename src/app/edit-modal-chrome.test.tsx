import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { EditModalShell } from "./edit-modal-chrome";
import { t } from "./i18n";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";

// ModalFieldControls (rendered in the shell header) reads field visibility
// from the workspace, so every render needs a WorkspaceProvider/FiltersProvider
// (mirrors change-edit-modal.test.tsx).
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

function renderShell(extra: Partial<React.ComponentProps<typeof EditModalShell>> = {}) {
  return render(
    <EditModalShell
      lang="en-US"
      title="Shell test"
      modalId="change"
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      offset={{ x: 0, y: 0 }}
      dragHandleProps={{
        ref: () => {},
        onPointerDown: vi.fn(),
        onPointerMove: vi.fn(),
        onPointerUp: vi.fn(),
      }}
      onDragReset={vi.fn()}
      sizeKey="test:shell-size"
      {...extra}
    >
      <p>body</p>
    </EditModalShell>,
    { wrapper },
  );
}

describe("EditModalShell height axis", () => {
  test("the panel carries a default height, min-height and max-height", () => {
    renderShell();
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    // Headline claim FIRST: a resizable panel needs a class-based default height
    // (use-resizable.ts's documented contract) or a dragged height is dead space.
    expect(panel.className).toContain("h-[720px]");
    expect(panel.className).toContain("min-h-[420px]");
    expect(panel.className).toContain("max-h-[95vh]");
  });

  test("the default form fills the panel so a dragged height reaches the scroller", () => {
    renderShell();
    const form = screen.getByText("body").closest("form") as HTMLElement;
    expect(form.className).toContain("flex-1");
    expect(form.className).toContain("min-h-0");
  });

  test("heightClassName overrides the default", () => {
    renderShell({ heightClassName: "h-[500px]" });
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.className).toContain("h-[500px]");
    expect(panel.className).not.toContain("h-[720px]");
  });
});

// The shell's 720px default suits the WIDE, long forms (change / raid /
// stakeholder). The four NARROW consumers are much shorter, and at 720px they
// open with visible dead space under the form — the very defect the height axis
// was added to remove. Each therefore pins its own height, and this guard stops
// one silently reverting to the default.
const NARROW_CONSUMERS = [
  "absence-edit-modal",
  "milestone-edit-modal",
  "resource-edit-modal",
  "calendar-event-modal",
] as const;

describe("narrow EditModalShell consumers pin their own height", () => {
  const sources = NARROW_CONSUMERS.map((name) => ({
    name,
    src: readFileSync(join(process.cwd(), "src/app", `${name}.tsx`), "utf8"),
  }));

  test("the scan reads all four files and they really use the shell", () => {
    // Proof the scan works before anything is concluded from it: a typo'd path
    // or a renamed file would otherwise make every assertion below vacuous.
    expect(sources).toHaveLength(4);
    for (const { name, src } of sources) {
      expect(src.length, `${name} read empty`).toBeGreaterThan(500);
      expect(src, `${name} no longer renders EditModalShell`).toContain("<EditModalShell");
    }
  });

  test.each(NARROW_CONSUMERS)("%s pins its own height, never the 720px default", (name) => {
    const { src } = sources.find((s) => s.name === name)!;
    // Scoped to the text AFTER the opening <EditModalShell tag, and matched
    // exactly once: a whole-file regex takes the FIRST hit anywhere, so a
    // commented-out or copy-pasted `heightClassName="h-[…]"` earlier in the
    // file would be graded instead of the live prop.
    const shellAt = src.indexOf("<EditModalShell");
    expect(shellAt, `${name} no longer renders EditModalShell`).toBeGreaterThan(-1);
    const rendered = src.slice(shellAt);
    // Accepts EITHER a pixel height shorter than the shell's 720px default OR
    // `h-auto` (content-fit). The guard's point is unchanged: no consumer may
    // silently fall back to the 720px default, and every override must carry
    // its own floor and cap because the prop REPLACES all three classes.
    const all = [...rendered.matchAll(/heightClassName="(h-auto|h-\[(\d+)px\])[^"]*"/g)];
    expect(all, `${name} declares no heightClassName on the shell`).toHaveLength(1);

    const [declared, , px] = all[0];
    if (px !== undefined) expect(Number(px)).toBeLessThan(720);
    expect(declared).toContain("max-h-[95vh]");
    expect(declared, `${name} height override has no min-h- floor`).toMatch(/min-h-\[\d+px\]/);
  });
});

describe("EditModalShell field-visibility control", () => {
  test("mounts the field-visibility trigger inside the modal header", () => {
    renderShell();
    const trigger = screen.getByRole("button", {
      name: new RegExp(t("en-US", "configureFields")),
    });
    // PLACEMENT, not presence: the control used to sit in its own bordered
    // strip BELOW the header, and a presence-only assertion passes against
    // that layout too.
    expect(trigger.closest("header")).not.toBeNull();
  });
});
