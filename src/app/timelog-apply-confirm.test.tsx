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
});
