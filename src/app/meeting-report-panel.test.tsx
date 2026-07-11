import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MeetingReportPanel } from "./meeting-report-panel";
import type { CommitteeMeeting } from "./types";

// Stub the dynamically-imported Tiptap editor with a plain textarea so the test
// exercises the pane's buttons/logic, not the browser-only editor.
vi.mock("./rich-text-editor", () => ({
  RichTextEditor: ({ value, onChange, label }: { value: string; onChange: (h: string) => void; label: string }) => (
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const meeting: CommitteeMeeting = { id: 1, date: "2026-06-01", title: "M1" };

function renderPanel(overrides = {}) {
  return render(
    <MeetingReportPanel
      lang="en-US"
      meeting={meeting}
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
    expect(onSend).toHaveBeenCalled();
  });

  it("shows Draft-with-AI only when aiConfigured + onGenerate", () => {
    const onGenerate = vi.fn();
    const { rerender } = renderPanel();
    expect(screen.queryByRole("button", { name: "Draft with AI" })).toBeNull();
    rerender(
      <MeetingReportPanel
        lang="en-US" meeting={meeting}
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
      versions: [{ id: "v1", capturedAt: "2026-05-29T09:00:00.000Z", isAuto: true }],
      onRestore,
    });
    fireEvent.click(screen.getByRole("button", { name: /Restore/ }));
    expect(onRestore).toHaveBeenCalledWith("v1");
  });
});
