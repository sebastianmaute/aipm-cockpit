import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BLOCKERS_WINDOW_DEFAULT_POS, BlockersWindow, type BlockersWindowProps } from "./blockers-window";
import { DEFAULT_LOG_WINDOW_POS } from "./floating-log-window";
import { t } from "./i18n";

const EN = "en-US" as const;

function props(over: Partial<BlockersWindowProps> = {}): BlockersWindowProps {
  return {
    open: true,
    onClose: vi.fn(),
    entityLabel: "Draft charter",
    taskId: 7,
    entries: [],
    onAdd: vi.fn(),
    onEdit: vi.fn(),
    onResolve: vi.fn(),
    onReopen: vi.fn(),
    onDelete: vi.fn(),
    resources: [],
    lang: EN,
    ...over,
  };
}

describe("BlockersWindow", () => {
  it("opens offset from the note log's default corner, so the two do not stack", () => {
    window.localStorage.clear();
    render(<BlockersWindow {...props()} />);
    const win = screen.getByRole("dialog", { name: `${t(EN, "blockerLogTitle")} — Draft charter` });
    expect(win.style.left).toBe(`${BLOCKERS_WINDOW_DEFAULT_POS.x}px`);
    expect(win.style.top).toBe(`${BLOCKERS_WINDOW_DEFAULT_POS.y}px`);
    expect(BLOCKERS_WINDOW_DEFAULT_POS).not.toEqual(DEFAULT_LOG_WINDOW_POS);
  });

  it("names the window after the task", () => {
    render(<BlockersWindow {...props()} />);
    expect(screen.getByRole("dialog", { name: `${t(EN, "blockerLogTitle")} — Draft charter` })).toBeTruthy();
  });

  it("a draft typed for one task does not carry to another", () => {
    const { rerender } = render(<BlockersWindow {...props()} />);
    const box = () => screen.getByRole("textbox", { name: t(EN, "blockerLogPlaceholder") }) as HTMLTextAreaElement;
    fireEvent.change(box(), { target: { value: "Half-typed for task 7" } });
    expect(box().value).toBe("Half-typed for task 7");

    // Same task re-rendered: the draft stays.
    rerender(<BlockersWindow {...props()} />);
    expect(box().value).toBe("Half-typed for task 7");

    // Window switched to another task: the draft is gone.
    rerender(<BlockersWindow {...props({ taskId: 8, entityLabel: "Other task" })} />);
    expect(box().value).toBe("");
  });
});
