import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";
import { EditModalShell } from "./edit-modal-chrome";
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
