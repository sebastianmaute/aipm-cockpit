import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MeetingReportPanel } from "./meeting-report-panel";

// Stub the dynamically-imported Tiptap editor with a plain textarea so the test
// exercises the pane's buttons/logic, not the browser-only editor.
vi.mock("./rich-text-editor", () => ({
  RichTextEditor: ({ value, onChange, label }: { value: string; onChange: (h: string) => void; label: string }) => (
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

function renderPanel(overrides = {}) {
  return render(
    <MeetingReportPanel
      lang="en-US"
      report={{ html: "<p>hi</p>", updatedAt: "2026-05-30T10:00:00.000Z" }}
      recipients={["alice@x.com"]}
      onSave={vi.fn()}
      onSend={vi.fn()}
      m365Configured
      {...overrides}
    />,
  );
}

describe("MeetingReportPanel", () => {
  it("Save emits the current report body (draft seeded from report.html)", () => {
    const onSave = vi.fn();
    renderPanel({ onSave });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("<p>hi</p>");
  });

  it("disables Send when M365 is not configured", () => {
    renderPanel({ m365Configured: false });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("disables Send when there are no recipients, and shows the no-recipients note", () => {
    renderPanel({ recipients: [] });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/No committee members have an email address/)).toBeInTheDocument();
  });

  it("Send fires when configured with recipients", () => {
    const onSend = vi.fn();
    renderPanel({ onSend });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith(["alice@x.com"]);
  });

  it("sends the EDITED recipient list, not just the seeded members", () => {
    const onSend = vi.fn();
    renderPanel({ onSend });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "a@x.com, b@x.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalledWith(["a@x.com", "b@x.com"]);
  });

  it("shows Draft-with-AI only when aiConfigured + onGenerate", () => {
    const onGenerate = vi.fn();
    const { rerender } = renderPanel();
    expect(screen.queryByRole("button", { name: "Draft with AI" })).toBeNull();
    rerender(
      <MeetingReportPanel
        lang="en-US"
        report={{ html: "<p>hi</p>", updatedAt: "2026-05-30T10:00:00.000Z" }}
        recipients={["a@x.com"]} onSave={vi.fn()} onSend={vi.fn()} m365Configured
        aiConfigured onGenerate={onGenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft with AI" }));
    expect(onGenerate).toHaveBeenCalled();
  });

  it("popout is read-only: no Save/Send, renders the body", () => {
    renderPanel({ isPopout: true });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("lists versions with a restore button when provided", () => {
    const onRestore = vi.fn();
    renderPanel({
      versions: [{ id: "v1", capturedAt: "2026-05-29T09:00:00.000Z", isAuto: true, html: "<p>old</p>" }],
      onRestore,
    });
    fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
    expect(onRestore).toHaveBeenCalledWith("v1");
  });

  it("Compare renders a diff of the current draft vs the selected version", () => {
    renderPanel({
      report: { html: "<p>current text</p>", updatedAt: "t1" },
      versions: [{ id: "v1", capturedAt: "t0", isAuto: true, html: "<p>old text</p>" }],
      onRestore: vi.fn(),
    });
    expect(screen.queryByLabelText(/This version: old text/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Compare/ }));
    // diff shows the version's line as removed and the current draft's as added
    expect(screen.getByLabelText("This version: old text")).toBeInTheDocument();
    expect(screen.getByLabelText("Current: current text")).toBeInTheDocument();
  });
});
