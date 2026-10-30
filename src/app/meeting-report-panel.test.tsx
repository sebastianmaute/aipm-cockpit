import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MeetingReportPanel } from "./meeting-report-panel";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { ConfirmProvider } from "./confirm-dialog";
import { splitSections } from "./committee-report/report-sections";
import { formatDisplayTimestamp } from "./tz-display";
import { t } from "./i18n";

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
    expect(onSave).toHaveBeenCalledWith("<p>hi</p>", { fromAi: false });
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

  // Review item 2 — the version list's Restore asks over unsaved typing, like the previous version's Restore.
  describe("version-list Restore over unsaved changes", () => {
    function renderVersions() {
      const onRestore = vi.fn();
      render(
        <ConfirmProvider lang="en-US">
          <MeetingReportPanel
            lang="en-US"
            report={{ html: "<p>hi</p>", updatedAt: "2026-05-30T10:00:00.000Z" }}
            recipients={["a@x.com"]}
            onSave={vi.fn()}
            onSend={vi.fn()}
            m365Configured
            versions={[{ id: "v1", capturedAt: "2026-05-29T09:00:00.000Z", isAuto: true, html: "<p>old</p>" }]}
            onRestore={onRestore}
          />
        </ConfirmProvider>,
      );
      return onRestore;
    }
    const restoreName = /^Restore – /;

    it("clean: restores at once, no dialog", async () => {
      const onRestore = renderVersions();
      await screen.findByLabelText("Report");
      fireEvent.click(screen.getByRole("button", { name: restoreName }));
      expect(onRestore).toHaveBeenCalledWith("v1");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("dirty: asks first, and confirming restores", async () => {
      const onRestore = renderVersions();
      fireEvent.change(await screen.findByLabelText("Report"), { target: { value: "<p>typed</p>" } });
      fireEvent.click(screen.getByRole("button", { name: restoreName }));
      const dialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
      expect(onRestore).not.toHaveBeenCalled();
      fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
      await waitFor(() => expect(onRestore).toHaveBeenCalledWith("v1"));
    });

    it("dirty, cancelled: keeps the draft and restores nothing", async () => {
      const onRestore = renderVersions();
      fireEvent.change(await screen.findByLabelText("Report"), { target: { value: "<p>typed</p>" } });
      fireEvent.click(screen.getByRole("button", { name: restoreName }));
      const dialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).toBeNull());
      expect(onRestore).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Report")).toHaveValue("<p>typed</p>");
    });
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
    expect(onSave).toHaveBeenCalledWith("<p>typed</p>", { fromAi: false });
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
    expect(onSave).toHaveBeenCalledWith("<p>stored</p>", { fromAi: false });
  });
});

// AI-04 — the AI draft is a proposal taken by section; the previous version can be compared and restored.
describe("MeetingReportPanel — the AI draft as a proposal (AI-04)", () => {
  const AI = splitSections("<p>ai intro</p><h2>Risks</h2><p>ai risks</p><h2>Next steps</h2><p>ai next</p>");
  const STORED = { html: "<h2>Risks</h2><p>mine</p>", updatedAt: "2026-10-30T09:00:00.000Z" };

  function renderWithProposal(overrides: Record<string, unknown> = {}) {
    const props = {
      lang: "en-US" as const,
      report: STORED,
      recipients: ["a@x.com"],
      onSave: vi.fn(),
      onSend: vi.fn(),
      m365Configured: true,
      proposal: { sections: AI, taken: new Set<number>(), createdAt: "2026-10-30T09:01:00.000Z" },
      onTaken: vi.fn(),
      onDiscardProposal: vi.fn(),
      ...overrides,
    };
    const view = render(
      <ConfirmProvider lang="en-US">
        <MeetingReportPanel {...props} />
      </ConfirmProvider>,
    );
    const rerenderWith = (more: Record<string, unknown>) =>
      view.rerender(
        <ConfirmProvider lang="en-US">
          <MeetingReportPanel {...props} {...more} />
        </ConfirmProvider>,
      );
    return { ...props, rerenderWith };
  }

  const rowOf = (name: string) => screen.getByRole("button", { name }).closest("li") as HTMLElement;

  it("Take on a heading the report already has asks first, naming that heading", async () => {
    const p = renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Risks" }));
    const dialog = await screen.findByRole("dialog", { name: "Replace sections?" });
    expect(dialog).toHaveTextContent("Risks");
    expect(p.onTaken).not.toHaveBeenCalled();
  });

  it("confirming replaces the section in the editor text", async () => {
    const p = renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Risks" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    await waitFor(() => expect(screen.getByLabelText("Report")).toHaveValue("<h2>Risks</h2><p>ai risks</p>"));
    // Taken shows at once, but is reported only when the text is saved (I-1).
    expect(rowOf("Take – Risks")).toHaveTextContent("Taken");
    // A taken row keeps its Take enabled: the text can be taken again (it asks Replace / Keep both).
    expect(screen.getByRole("button", { name: "Take – Risks" })).toBeEnabled();
    expect(p.onTaken).not.toHaveBeenCalled();
  });

  it("cancelling keeps the user's section and adds the AI one after it", async () => {
    const p = renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Risks" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep both" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Report")).toHaveValue("<h2>Risks</h2><p>mine</p><h2>Risks</h2><p>ai risks</p>"),
    );
    expect(rowOf("Take – Risks")).toHaveTextContent("Taken");
    expect(p.onTaken).not.toHaveBeenCalled();
  });

  it("unsaved typing before the take is still in the result", async () => {
    renderWithProposal();
    fireEvent.change(await screen.findByLabelText("Report"), { target: { value: "<h2>Risks</h2><p>typed</p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Take – Next steps" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Report")).toHaveValue("<h2>Risks</h2><p>typed</p><h2>Next steps</h2><p>ai next</p>"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Discard calls onDiscardProposal and leaves the editor text alone", async () => {
    const p = renderWithProposal();
    fireEvent.change(await screen.findByLabelText("Report"), { target: { value: "<p>typed</p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    expect(p.onDiscardProposal).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Report")).toHaveValue("<p>typed</p>");
  });

  it("Save after a take is marked fromAi; a later plain save is not", async () => {
    const p = renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Next steps" }));
    await waitFor(() => expect(rowOf("Take – Next steps")).toHaveTextContent("Taken"));
    expect(p.onTaken).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onSave).toHaveBeenLastCalledWith("<h2>Risks</h2><p>mine</p><h2>Next steps</h2><p>ai next</p>", { fromAi: true });
    // I-1 — the take is reported to the proposal with the save that stores its text.
    expect(p.onTaken).toHaveBeenCalledTimes(1);
    expect(p.onTaken).toHaveBeenCalledWith([2]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onSave).toHaveBeenLastCalledWith("<h2>Risks</h2><p>mine</p><h2>Next steps</h2><p>ai next</p>", { fromAi: false });
    expect(p.onTaken).toHaveBeenCalledTimes(1);
  });

  it("a new stored body clears the unsaved taken marks (the §763 reconcile)", async () => {
    const p = renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Next steps" }));
    await waitFor(() => expect(rowOf("Take – Next steps")).toHaveTextContent("Taken"));
    p.rerenderWith({ report: { html: "<p>restored</p>", updatedAt: "2026-10-30T09:30:00.000Z" } });
    await waitFor(() => expect(rowOf("Take – Next steps")).not.toHaveTextContent("Taken"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onTaken).not.toHaveBeenCalled();
  });

  // I-2 (WCAG 2.4.3) — the row that was taken is done for now, so focus moves on to the next untaken one.
  it("after a plain take, focus moves to the next untaken row's Take", async () => {
    renderWithProposal();
    await screen.findByLabelText("Report");
    const opening = screen.getByRole("button", { name: "Take – Opening text" });
    opening.focus();
    fireEvent.click(opening);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Take – Risks" })));
  });

  it("after a confirmed take, focus moves to the next untaken row's Take, not the taken one", async () => {
    renderWithProposal();
    await screen.findByLabelText("Report");
    const risks = screen.getByRole("button", { name: "Take – Risks" });
    risks.focus();
    fireEvent.click(risks);
    fireEvent.click(await screen.findByRole("button", { name: "Replace" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Take – Next steps" })));
  });

  it("after the last section is taken, focus wraps to an earlier untaken row", async () => {
    renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Next steps" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Take – Opening text" })));
  });

  it("after Take all, focus moves to Discard draft", async () => {
    renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take all" }));
    fireEvent.click(await screen.findByRole("button", { name: "Keep both" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Discard draft" })));
    expect(screen.getByRole("button", { name: "Take all" })).toBeDisabled();
  });

  // M-1 — a write that lands while the confirm is open makes the take's base stale: it is dropped.
  it("drops a take whose confirm was answered after the stored body changed", async () => {
    const p = renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Risks" }));
    await screen.findByRole("dialog", { name: "Replace sections?" });
    p.rerenderWith({ report: { html: "<h2>Risks</h2><p>undone</p>", updatedAt: "2026-10-30T09:30:00.000Z" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    // The dropped take is announced, not silent.
    const notice = await screen.findByRole("dialog", { name: "Take not applied" });
    expect(notice).toHaveTextContent("The report changed while you were deciding");
    fireEvent.click(within(notice).getByRole("button", { name: t("en-US", "dialogOk") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByLabelText("Report")).toHaveValue("<h2>Risks</h2><p>undone</p>"));
    expect(screen.getByRole("button", { name: "Take – Risks" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onSave).toHaveBeenLastCalledWith("<h2>Risks</h2><p>undone</p>", { fromAi: false });
  });

  // Unsaved taken marks are indices into ONE proposal: a new or discarded proposal drops them.
  it("a regenerated proposal (new createdAt) clears the unsaved taken marks", async () => {
    const p = renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Next steps" }));
    await waitFor(() => expect(rowOf("Take – Next steps")).toHaveTextContent("Taken"));
    p.rerenderWith({ proposal: { sections: AI, taken: new Set<number>(), createdAt: "2026-10-30T10:00:00.000Z" } });
    await waitFor(() => expect(rowOf("Take – Next steps")).not.toHaveTextContent("Taken"));
    expect(rowOf("Take – Next steps")).not.toHaveTextContent("Taken");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onTaken).not.toHaveBeenCalled();
  });

  it("Discard clears the unsaved taken marks, so a later Save reports none", async () => {
    const p = renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Next steps" }));
    await waitFor(() => expect(rowOf("Take – Next steps")).toHaveTextContent("Taken"));
    fireEvent.click(screen.getByRole("button", { name: "Discard draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onTaken).not.toHaveBeenCalled();
  });

  // Final review item 2 — a saved take that is undone (or restored over) leaves the proposal's Taken mark,
  // and the AI text must still be takeable again.
  it("after a saved take is undone, the row still says Taken and its Take takes the text again", async () => {
    const p = renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Next steps" }));
    await waitFor(() => expect(rowOf("Take – Next steps")).toHaveTextContent("Taken"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const takenProposal = { sections: AI, taken: new Set<number>([2]), createdAt: "2026-10-30T09:01:00.000Z" };
    p.rerenderWith({
      report: { html: "<h2>Risks</h2><p>mine</p><h2>Next steps</h2><p>ai next</p>", updatedAt: "2026-10-30T09:10:00.000Z" },
      proposal: takenProposal,
    });
    // Undo writes the whole earlier report back, its stamp included.
    p.rerenderWith({ report: STORED, proposal: takenProposal });
    await waitFor(() => expect(screen.getByLabelText("Report")).toHaveValue("<h2>Risks</h2><p>mine</p>"));
    expect(rowOf("Take – Next steps")).toHaveTextContent("Taken");
    const again = screen.getByRole("button", { name: "Take – Next steps" });
    expect(again).toBeEnabled();
    fireEvent.click(again);
    await waitFor(() =>
      expect(screen.getByLabelText("Report")).toHaveValue("<h2>Risks</h2><p>mine</p><h2>Next steps</h2><p>ai next</p>"),
    );
  });

  // Final review item 4 — a new draft that replaces the proposal while the confirm is open makes the take's
  // indices point into a different proposal: dropped like a stale body (M-1).
  it("drops a take whose confirm was answered after a new draft replaced the proposal", async () => {
    const p = renderWithProposal();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Take – Risks" }));
    await screen.findByRole("dialog", { name: "Replace sections?" });
    p.rerenderWith({ proposal: { sections: AI, taken: new Set<number>(), createdAt: "2026-10-30T10:00:00.000Z" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    const notice = await screen.findByRole("dialog", { name: "Take not applied" });
    fireEvent.click(within(notice).getByRole("button", { name: t("en-US", "dialogOk") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByLabelText("Report")).toHaveValue("<h2>Risks</h2><p>mine</p>");
    expect(rowOf("Take – Risks")).not.toHaveTextContent("Taken");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(p.onSave).toHaveBeenLastCalledWith("<h2>Risks</h2><p>mine</p>", { fromAi: false });
    expect(p.onTaken).not.toHaveBeenCalled();
  });

  it("shows no proposal block without a proposal", async () => {
    renderWithProposal({ proposal: undefined });
    await screen.findByLabelText("Report");
    expect(screen.queryByRole("button", { name: "Take all" })).toBeNull();
  });
});

describe("MeetingReportPanel — the previous version (AI-04)", () => {
  const WITH_PREVIOUS = {
    html: "<p>current</p>",
    updatedAt: "2026-10-30T09:00:00.000Z",
    previous: { html: "<p>older</p>", savedAt: "2026-10-29T08:00:00.000Z" },
  };

  function renderPrev(onRestorePrevious = vi.fn()) {
    render(
      <ConfirmProvider lang="en-US">
        <MeetingReportPanel
          lang="en-US"
          report={WITH_PREVIOUS}
          recipients={["a@x.com"]}
          onSave={vi.fn()}
          onSend={vi.fn()}
          m365Configured
          onRestorePrevious={onRestorePrevious}
        />
      </ConfirmProvider>,
    );
    return onRestorePrevious;
  }

  it("names the previous version with its save time, formatted for display (M-6)", async () => {
    renderPrev();
    await screen.findByLabelText("Report");
    // Outside a DisplayTimezoneProvider the panel shows the browser's zone (useDisplayTzOrBrowser).
    const shown = formatDisplayTimestamp("2026-10-29T08:00:00.000Z", Intl.DateTimeFormat().resolvedOptions().timeZone, "en-US");
    expect(shown).not.toBe("2026-10-29T08:00:00.000Z"); // anti-vacuity: the formatter changed the text
    expect(screen.getByText(`Previous version (saved ${shown})`)).toBeInTheDocument();
  });

  it("Compare shows a line diff of the previous version against the draft", async () => {
    renderPrev();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Compare – Previous version" }));
    expect(screen.getByLabelText("Previous version: older")).toBeInTheDocument();
    expect(screen.getByLabelText("Current: current")).toBeInTheDocument();
  });

  it("Restore without unsaved changes restores at once", async () => {
    const onRestorePrevious = renderPrev();
    await screen.findByLabelText("Report");
    fireEvent.click(screen.getByRole("button", { name: "Restore – Previous version" }));
    await waitFor(() => expect(onRestorePrevious).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Restore with unsaved changes asks first", async () => {
    const onRestorePrevious = renderPrev();
    fireEvent.change(await screen.findByLabelText("Report"), { target: { value: "<p>typed</p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore – Previous version" }));
    const dialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    expect(onRestorePrevious).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(onRestorePrevious).toHaveBeenCalledTimes(1));
  });

  it("Restore with unsaved changes, cancelled, restores nothing", async () => {
    const onRestorePrevious = renderPrev();
    fireEvent.change(await screen.findByLabelText("Report"), { target: { value: "<p>typed</p>" } });
    fireEvent.click(screen.getByRole("button", { name: "Restore – Previous version" }));
    const dialog = await screen.findByRole("dialog", { name: "Unsaved changes" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Unsaved changes" })).toBeNull());
    expect(onRestorePrevious).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Report")).toHaveValue("<p>typed</p>");
  });

  it("marks the panel dirty for the top-bar undo guard only while the draft differs from the stored body", async () => {
    const { container } = render(
      <MeetingReportPanel lang="en-US" report={WITH_PREVIOUS} recipients={[]} onSave={vi.fn()} onSend={vi.fn()} m365Configured />,
    );
    const editor = await screen.findByLabelText("Report");
    expect(container.querySelector('[data-report-dirty="true"]')).toBeNull();
    fireEvent.change(editor, { target: { value: "<p>typed</p>" } });
    expect(container.querySelector('[data-report-dirty="true"]')).not.toBeNull();
  });

  // Review item 5 — a save whose sanitized text equals the stored body writes nothing (no new updatedAt, so no
  // reconcile): the panel settles the draft itself, so it does not stay dirty after Save.
  it("a Save that differs from the stored body only by what the sanitizer strips leaves the panel clean", async () => {
    const onSave = vi.fn();
    const { container } = render(
      <MeetingReportPanel lang="en-US" report={WITH_PREVIOUS} recipients={[]} onSave={onSave} onSend={vi.fn()} m365Configured />,
    );
    const editor = await screen.findByLabelText("Report");
    fireEvent.change(editor, { target: { value: "<p>current</p><script>x()</script>" } });
    expect(container.querySelector('[data-report-dirty="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-report-dirty="true"]')).toBeNull();
  });
});
