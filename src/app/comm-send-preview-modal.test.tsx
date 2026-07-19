import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommSendPreviewModal, type CommSendPreviewLabels } from "./comm-send-preview-modal";

const labels: CommSendPreviewLabels = { title: "Send email", to: "To", subject: "Subject", send: "Send", sending: "Sending…", cancel: "Cancel" };
const req = { to: "a@b.com", subject: "Status", html: "<p>Hello</p><script>alert(1)</script>", plain: "Hello" };

describe("CommSendPreviewModal", () => {
  it("renders sanitized HTML (script stripped) + recipient/subject", () => {
    render(<CommSendPreviewModal open req={req} labels={labels} busy={false} onSend={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Send email" });
    expect(dialog).toBeTruthy();
    expect(dialog.innerHTML).not.toContain("<script>");
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("a@b.com")).toBeTruthy();
  });
  it("Send + Cancel invoke their handlers", () => {
    const onSend = vi.fn(); const onCancel = vi.fn();
    render(<CommSendPreviewModal open req={req} labels={labels} busy={false} onSend={onSend} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
  it("renders nothing when closed", () => {
    const { container } = render(<CommSendPreviewModal open={false} req={req} labels={labels} busy={false} onSend={vi.fn()} onCancel={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
  it("while busy: shows the sending label, marks Send aria-busy, disables both buttons", () => {
    render(<CommSendPreviewModal open req={req} labels={labels} busy onSend={vi.fn()} onCancel={vi.fn()} />);
    const send = screen.getByRole("button", { name: "Sending…" });
    expect(send).toHaveAttribute("aria-busy", "true");
    expect(send).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
  it("while busy: Escape does not dismiss (send can't be pretend-cancelled)", () => {
    const onCancel = vi.fn();
    render(<CommSendPreviewModal open req={req} labels={labels} busy onSend={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
