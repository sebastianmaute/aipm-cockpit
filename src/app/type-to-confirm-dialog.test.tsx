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

  it("accepts a trailing space, which copy-paste adds", () => {
    render(<TypeToConfirmDialog {...base} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Apollo " } });
    expect(screen.getByRole("button", { name: "Delete" })).not.toBeDisabled();
  });

  // Pins a DELIBERATE choice: confirmValue is sometimes a project NAME, and
  // case-folding would both weaken a destructive gate and make two projects
  // differing only in case indistinguishable here.
  it("does NOT accept a case difference", () => {
    render(<TypeToConfirmDialog {...base} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "apollo" } });
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
  });

  it("stays silent about a mismatch until the field is blurred", () => {
    render(<TypeToConfirmDialog {...base} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Apoll" } });
    expect(screen.queryByText(/does not match/i)).not.toBeInTheDocument();
    fireEvent.blur(input);
    expect(screen.getByText(/does not match/i)).toBeInTheDocument();
  });

  it("marks the field invalid and points at the message when mismatched", () => {
    render(<TypeToConfirmDialog {...base} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Apoll" } });
    fireEvent.blur(input);
    expect(input).toHaveAttribute("aria-invalid", "true");
    const id = input.getAttribute("aria-describedby");
    expect(id).toBeTruthy();
    expect(document.getElementById(id as string)).toHaveTextContent(/does not match/i);
  });

  it("explains a whitespace-only entry rather than just staying dead", () => {
    render(<TypeToConfirmDialog {...base} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(screen.getByText(/does not match/i)).toBeInTheDocument();
  });

  it("says nothing when an untouched empty field is blurred", () => {
    render(<TypeToConfirmDialog {...base} />);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(screen.queryByText(/does not match/i)).not.toBeInTheDocument();
  });
});
