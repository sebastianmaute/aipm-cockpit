import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";

const base = {
  lang: "en-US" as const,
  title: "Delete permanently",
  message: "This cannot be undone.",
  confirmValue: "Apollo",
  confirmLabel: "Delete",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe("TypeToConfirmDialog", () => {
  it("disables confirm until the typed value matches exactly", () => {
    render(<TypeToConfirmDialog {...base} />);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Apoll" } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Apollo" } });
    expect(btn).not.toBeDisabled();
  });

  it("calls onConfirm only when matched and clicked", () => {
    const onConfirm = vi.fn();
    render(<TypeToConfirmDialog {...base} onConfirm={onConfirm} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Apollo" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel from the Cancel button", () => {
    const onCancel = vi.fn();
    render(<TypeToConfirmDialog {...base} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
