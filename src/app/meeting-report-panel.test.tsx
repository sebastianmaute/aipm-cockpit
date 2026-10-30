import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MeetingReportPanel } from "./meeting-report-panel";
import { expectRowUniqueNames } from "../test/row-unique-names";

// Stub the dynamically-imported Tiptap editor with a plain textarea so the test
// exercises the pane's buttons/logic, not the browser-only editor. ★ UNCONTROLLED
// like the real editor, which binds `content` once at mount: a controlled stub shows a
// new `value` the real editor never would (§763). The mount value is held in state,
// because a bare `defaultValue` still follows a new value until the user types.
vi.mock("./rich-text-editor", async () => {
  const { useState } = await import("react");
  return {
    RichTextEditor: ({ value, onChange, label }: { value: string; onChange: (h: string) => void; label: string }) => {
      const [atMount] = useState(value);
      return <textarea aria-label={label} defaultValue={atMount} onChange={(e) => onChange(e.target.value)} />;
    },
  };
});

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

  it("disables Send when the stored report body is blank", () => {
    renderPanel({ report: { html: "<p> </p>", updatedAt: "t2", previous: { html: "<p>b</p>", savedAt: "t1" } } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
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

  // §125: the AI draft is a billed Anthropic call — while it runs, the trigger
  // is an ENABLED Stop that cancels, and the progress text sits beside it.
  it("while generating, the trigger reads Stop and cancels instead of generating", () => {
    const onGenerate = vi.fn();
    const onCancelGenerate = vi.fn();
    renderPanel({ aiConfigured: true, onGenerate, onCancelGenerate, generateBusy: true });
    const stop = screen.getByRole("button", { name: "Stop" });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(onCancelGenerate).toHaveBeenCalledTimes(1);
    expect(onGenerate).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Drafting…");
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

  // §669 — two versions captured at the same time read alike.
  it("names the controls of two versions with one capture time apart", () => {
    const at = "2026-05-29T09:00:00.000Z";
    renderPanel({
      versions: [
        { id: "v1", capturedAt: at, isAuto: true, html: "<p>a</p>" },
        { id: "v2", capturedAt: at, isAuto: true, html: "<p>b</p>" },
        { id: "v3", capturedAt: at, isAuto: false, html: "<p>c</p>" },
      ],
      onRestore: vi.fn(),
    });
    expect(screen.getByRole("button", { name: `Restore – ${at} · auto (2)` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Compare – ${at} · saved` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 6, requireCollisionSeed: true });
    // The diff view opened from the second version names it the same way.
    fireEvent.click(screen.getByRole("button", { name: `Compare – ${at} · auto (2)` }));
    expect(screen.getByRole("list", { name: `Compare – ${at} · auto (2)` })).toBeInTheDocument();
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

// §763 — an AI draft (or a restore) that lands while the dialog is open must show in the editor,
// which reads its content once at mount; before the fix it showed only after reopening the dialog.
describe("MeetingReportPanel — a new report body reaches the open editor (§763)", () => {
  const props = { lang: "en-US" as const, recipients: ["a@x.com"], onSave: vi.fn(), onSend: vi.fn(), m365Configured: true };

  it("shows the first AI draft of a meeting that had no report", async () => {
    const { rerender } = render(<MeetingReportPanel {...props} report={undefined} />);
    expect(await screen.findByLabelText("Report")).toHaveValue("");
    rerender(<MeetingReportPanel {...props} report={{ html: "<p>drafted</p>", updatedAt: "2026-10-22T09:00:00.000Z" }} />);
    expect(await screen.findByLabelText("Report")).toHaveValue("<p>drafted</p>");
  });

  it("shows a newer body (a second draft or a restore) over the one it opened with", async () => {
    const { rerender } = render(
      <MeetingReportPanel {...props} report={{ html: "<p>first</p>", updatedAt: "2026-10-22T09:00:00.000Z" }} />,
    );
    expect(await screen.findByLabelText("Report")).toHaveValue("<p>first</p>");
    rerender(<MeetingReportPanel {...props} report={{ html: "<p>second</p>", updatedAt: "2026-10-22T09:05:00.000Z" }} />);
    expect(await screen.findByLabelText("Report")).toHaveValue("<p>second</p>");
  });

  it("keeps the same editor, its focus and the typed text while the user types", async () => {
    const report = { html: "<p>first</p>", updatedAt: "2026-10-22T09:00:00.000Z" };
    const onSave = vi.fn();
    const { rerender } = render(<MeetingReportPanel {...props} onSave={onSave} report={report} />);
    const editor = await screen.findByLabelText("Report");
    editor.focus();
    fireEvent.change(editor, { target: { value: "<p>typed</p>" } });
    // The parent re-renders with the same stored report (typing never writes it).
    rerender(<MeetingReportPanel {...props} onSave={onSave} report={{ ...report }} />);
    expect(screen.getByLabelText("Report")).toBe(editor);
    expect(editor).toHaveFocus();
    expect(editor).toHaveValue("<p>typed</p>");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("<p>typed</p>");
  });

  // The key is the stored body's STAMP, not its html: a restore (or a draft) that writes the html the
  // dialog opened with, after the user typed, re-seeds the draft to it, and the editor must show what
  // Save would write — an html key would keep the typed text on screen while Save sent the stored body.
  it("shows the stored body again when a write repeats its html with a new stamp after the user typed", async () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <MeetingReportPanel {...props} onSave={onSave} report={{ html: "<p>stored</p>", updatedAt: "2026-10-22T09:00:00.000Z" }} />,
    );
    fireEvent.change(await screen.findByLabelText("Report"), { target: { value: "<p>typed</p>" } });
    rerender(
      <MeetingReportPanel {...props} onSave={onSave} report={{ html: "<p>stored</p>", updatedAt: "2026-10-22T09:05:00.000Z" }} />,
    );
    expect(await screen.findByLabelText("Report")).toHaveValue("<p>stored</p>");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith("<p>stored</p>");
  });
});
