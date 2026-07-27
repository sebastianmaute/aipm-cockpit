import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TimelogApplyConfirm } from "./timelog-apply-confirm";
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

  it("lets the diff list grow with its content instead of capping at 10rem", () => {
    const rows: ApplyDiffLabel[] = Array.from({ length: 12 }, (_, i) => ({
      bucketId: 1,
      allocIndex: 0,
      period: `2026-0${(i % 9) + 1}`,
      bucketName: "Build",
      lineName: "Dev",
      current: 0,
      next: i + 1,
    }));
    const { container } = render(
      <TimelogApplyConfirm lang="en-US" rows={rows} onApply={vi.fn()} onCancel={vi.fn()} />,
    );
    const list = container.querySelector("ul");
    expect(list).toBeTruthy();
    expect(list?.className).not.toContain("max-h-40");
    // Still BOUNDED on purpose: this card gates a financial write into
    // actualHours, so Apply and Cancel must never be pushed out of reach.
    expect(list?.className).toContain("max-h-[50vh]");
  });
});
