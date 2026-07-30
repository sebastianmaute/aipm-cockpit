import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TimelogApplyConfirm, MAX_VISIBLE_ROWS } from "./timelog-apply-confirm";
import { t } from "./i18n";
import type { ApplyDiffLabel } from "./timelog-apply";

const ROW: ApplyDiffLabel = {
  bucketId: 1,
  allocIndex: 0,
  period: "2026-W30",
  bucketName: "Bucket A",
  lineName: "Design",
  current: 10,
  next: 14,
};

describe("TimelogApplyConfirm", () => {
  it("renders an outline card without the muted background fill", () => {
    const { container } = render(
      <TimelogApplyConfirm lang="en-US" rows={[ROW]} onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain("border border-line");
    expect(card.className).not.toContain("bg-surface-muted");
  });

  it("fires onApply and onCancel from the primitive buttons", () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <TimelogApplyConfirm lang="en-US" rows={[ROW]} onApply={onApply} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogApply") }));
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  // ★ This asserts CLASS NAMES, which restates the implementation rather than
  // observing behaviour — accepted deliberately because jsdom has no layout
  // engine: every height, scrollHeight and getBoundingClientRect here is 0, so
  // "does the list actually grow" is unobservable in this environment. The real
  // check is by eye. What these tests buy is a tripwire against silently
  // reverting to an always-scrolling list, and they pin the exact boundary
  // (MAX_VISIBLE_ROWS) — an off-by-one here means a 25-row list still scrolls,
  // which is the exact complaint this cap exists to fix.
  function rowsOf(n: number): ApplyDiffLabel[] {
    return Array.from({ length: n }, (_, i) => ({
      bucketId: 1,
      allocIndex: 0,
      period: `2026-W${String(i + 1).padStart(2, "0")}`,
      bucketName: "Build",
      lineName: "Dev",
      current: 0,
      next: 8,
    }));
  }

  function renderRows(n: number) {
    render(
      <TimelogApplyConfirm lang="en-US" rows={rowsOf(n)} onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    return screen.getByRole("list");
  }

  describe("diff list cap", () => {
    it("does not cap a short list", () => {
      expect(renderRows(3).className).not.toMatch(/max-h-/);
    });

    it("caps once the list is longer than MAX_VISIBLE_ROWS", () => {
      expect(renderRows(MAX_VISIBLE_ROWS + 1).className).toMatch(/max-h-/);
    });

    it("does not cap at exactly MAX_VISIBLE_ROWS", () => {
      expect(renderRows(MAX_VISIBLE_ROWS).className).not.toMatch(/max-h-/);
    });
  });
});
