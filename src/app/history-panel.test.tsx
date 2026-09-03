import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { HistoryPanel, selectableSelection, recordSelection } from "./history-panel";
import { DisplayTimezoneProvider } from "./display-timezone-context";
import { ToastProvider } from "./toast-context";
import { t } from "./i18n";
import type { ProjectVersionMeta } from "./version-history";
import type { VersionChange } from "./version-diff";
import { changeKey } from "./version-restore";
import { expectRowUniqueNames } from "../test/row-unique-names";

// Delete is confirm-gated; auto-accept the branded dialog so the flow proceeds.
vi.mock("./confirm-dialog", () => ({
  useConfirm: () => () => Promise.resolve(true),
}));

// The panel reads useDisplayTimezone(); wrap every render in the provider. A
// non-UTC zone (Asia/Kolkata, +5:30) makes the zone conversion observable.
function renderPanel(ui: React.ReactNode) {
  return render(<DisplayTimezoneProvider effectiveTz="Asia/Kolkata">{ui}</DisplayTimezoneProvider>);
}

// ★★ `useToastContext` falls back to a SILENT no-op with no provider, so a toast
// assertion made against a bare `renderPanel` can never fail — it would pass with
// the showToast call deleted. Any test observing a toast must go through here.
function renderWithToast(showToast: (kind: string, text: string) => void, ui: React.ReactNode) {
  return renderPanel(
    <ToastProvider value={{ showToast: showToast as never, showToastAction: vi.fn() }}>{ui}</ToastProvider>,
  );
}

const metas: ProjectVersionMeta[] = [
  { id: "v2", projectId: "p1", capturedAt: "2026-06-11T12:00:00.000Z", trigger: "manual", label: "Before review", summary: null },
  { id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "auto", label: null, summary: null },
];

it("lists versions newest-first with label/trigger", () => {
  renderPanel(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={vi.fn()} loadDiff={vi.fn().mockResolvedValue([])} restore={vi.fn().mockResolvedValue(undefined)} />);
  expect(screen.getByText("Before review")).toBeInTheDocument();
  expect(screen.getByText(/Auto/)).toBeInTheDocument();
});

it("renders a version's capturedAt in the display timezone", () => {
  // v1 has no label, captured 2026-06-10T09:00Z → Asia/Kolkata (+5:30) = 14:30 → "02:30 PM".
  renderPanel(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={vi.fn()} loadDiff={vi.fn().mockResolvedValue([])} restore={vi.fn().mockResolvedValue(undefined)} />);
  const shown = screen.getAllByText(/06\/10\/2026/);
  expect(shown.length).toBeGreaterThan(0);
  expect(shown[0].textContent).toContain("02:30");
  expect(shown[0].textContent).not.toContain("2026-06-10T09:00:00.000Z");
});

it("shows the empty state when there are no versions", () => {
  renderPanel(<HistoryPanel lang="en-US" versions={[]} busy={false} onCaptureNow={vi.fn()} loadDiff={vi.fn().mockResolvedValue([])} restore={vi.fn().mockResolvedValue(undefined)} />);
  expect(screen.getByText(/No versions yet/)).toBeInTheDocument();
});

it("captures a named checkpoint via the inline input", () => {
  const onCaptureNow = vi.fn();
  renderPanel(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={onCaptureNow} loadDiff={vi.fn().mockResolvedValue([])} restore={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByRole("button", { name: "Save version now" }));
  const input = screen.getByPlaceholderText("Name this version");
  fireEvent.change(input, { target: { value: "My checkpoint" } });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(onCaptureNow).toHaveBeenCalledWith("My checkpoint");
});

it("compares a clicked version against now and renders the diff", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "auto", label: null, summary: "Tasks (1)" }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "A", after: "B" }] },
  ]);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  expect(await screen.findByText("T1")).toBeInTheDocument();
  expect(loadDiff).toHaveBeenCalledWith("v1", "now");
});

it("compares two ticked versions, ordered oldest→newest", async () => {
  const loadDiff = vi.fn().mockResolvedValue([]);
  renderPanel(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={vi.fn()} loadDiff={loadDiff} restore={vi.fn().mockResolvedValue(undefined)} />);
  // "Compare selected" is disabled until exactly two are ticked
  const compareBtn = screen.getByRole("button", { name: "Compare selected" });
  expect(compareBtn).toBeDisabled();
  const boxes = screen.getAllByRole("checkbox");
  fireEvent.click(boxes[0]); // v2 (newer)
  fireEvent.click(boxes[1]); // v1 (older)
  expect(compareBtn).toBeEnabled();
  fireEvent.click(compareBtn);
  // ordered oldest (v1) → newest (v2)
  expect(loadDiff).toHaveBeenCalledWith("v1", "v2");
});

it("deletes a snapshot and drops it from the two-version tick list", async () => {
  const onDelete = vi.fn().mockResolvedValue(true);
  renderPanel(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={vi.fn()} loadDiff={vi.fn().mockResolvedValue([])} restore={vi.fn().mockResolvedValue(undefined)} onDelete={onDelete} />);
  // Tick both versions so "Compare selected" is enabled.
  const boxes = screen.getAllByRole("checkbox");
  fireEvent.click(boxes[0]); // v2 (newer)
  fireEvent.click(boxes[1]); // v1 (older)
  const compareBtn = screen.getByRole("button", { name: "Compare selected" });
  expect(compareBtn).toBeEnabled();
  // Delete the newer ticked version.
  fireEvent.click(screen.getByRole("button", { name: "Delete – Before review" }));
  await waitFor(() => expect(onDelete).toHaveBeenCalledWith("v2"));
  // Its dead id must be dropped from `selected`, so compare falls back to disabled
  // (only one valid tick remains) — not a silent no-op on the next compare click.
  await waitFor(() => expect(compareBtn).toBeDisabled());
});

it("compares two ticked versions side by side with column headers", async () => {
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "A", after: "B" }] },
  ]);
  renderPanel(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={vi.fn()} loadDiff={loadDiff} restore={vi.fn().mockResolvedValue(undefined)} />);
  const boxes = screen.getAllByRole("checkbox");
  fireEvent.click(boxes[0]);
  fireEvent.click(boxes[1]);
  fireEvent.click(screen.getByRole("button", { name: "Compare side by side" }));
  expect(loadDiff).toHaveBeenCalledWith("v1", "v2");
  // Side-by-side shows the field values in two columns immediately (no expand
  // click) and, unlike the inline diff, no before→after "→" arrow.
  expect(await screen.findByText("A")).toBeInTheDocument();
  expect(screen.getByText("B")).toBeInTheDocument();
  expect(screen.queryByText("→")).toBeNull();
});

it("restores a whole version state from its row (diffs vs now, marks all)", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "Old", after: "New" }] },
    { collection: "raid", collectionLabel: "RAID", kind: "list", recordId: 5, recordLabel: "R5",
      type: "added", fields: [] },
  ]);
  const restore = vi.fn().mockResolvedValue(undefined);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={restore} />);
  fireEvent.click(screen.getByRole("button", { name: "Restore this state – Baseline" }));
  await Promise.resolve();
  await Promise.resolve();
  expect(loadDiff).toHaveBeenCalledWith("v1", "now");
  // ★★ Assert against a COMPUTED key, never a literal. `changeKey` is
  // `JSON.stringify([collection, recordId])` — NOT a `${collection}:${id}`
  // join (a join is ambiguous for string ids, and each collision is a silent
  // wrong-record restore). A literal in the dead join format would make this
  // panel assertion pass only by accident, and would make `applyRestore` miss
  // the change downstream. Every selection key in this file is built the same way.
  expect(restore).toHaveBeenCalledWith("v1", { [changeKey("tasks", 1)]: "all", [changeKey("raid", 5)]: "all" }, "Baseline");
});

it("restores a single record from a vs-now comparison via its row button", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "Old", after: "New" }] },
  ]);
  const restore = vi.fn().mockResolvedValue(undefined);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={restore} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  await screen.findByText("T1");
  // ★ The per-row verbs are token-qualified for WCAG 2.4.6 (two records can share
  // a display name), so the accessible name is "<verb> – <row token>" while the
  // VISIBLE text stays the bare verb. Matching the bare name here would pass only
  // while the row-unique naming is broken.
  fireEvent.click(screen.getByRole("button", { name: "Restore this – T1" }));
  expect(restore).toHaveBeenCalledWith("v1", { [changeKey("tasks", 1)]: "all" }, "Baseline");
});

it("restores a single record from a two-version side-by-side compare (to the older version)", async () => {
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "A", after: "B" }] },
  ]);
  const restore = vi.fn().mockResolvedValue(undefined);
  renderPanel(<HistoryPanel lang="en-US" versions={metas} busy={false} onCaptureNow={vi.fn()} loadDiff={loadDiff} restore={restore} />);
  const boxes = screen.getAllByRole("checkbox");
  fireEvent.click(boxes[0]); // v2 (newer)
  fireEvent.click(boxes[1]); // v1 (older)
  fireEvent.click(screen.getByRole("button", { name: "Compare side by side" }));
  await screen.findByText("T1");
  // Per-row restore reverts that record to the OLDER pick (v1).
  fireEvent.click(screen.getByRole("button", { name: "Restore this – T1" }));
  expect(restore).toHaveBeenCalledWith("v1", { [changeKey("tasks", 1)]: "all" }, expect.any(String));
});

it("restores ticked changes from a vs-now comparison", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "Old", after: "New" }] },
  ]);
  const restore = vi.fn().mockResolvedValue(undefined);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={restore} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  const box = await screen.findByLabelText("Select – T1");
  fireEvent.click(box);
  fireEvent.click(screen.getByRole("button", { name: "Restore selected" }));
  expect(restore).toHaveBeenCalledWith("v1", { [changeKey("tasks", 1)]: "all" }, "Baseline");
});

// ── T7: identical-vs-broken feedback + scroll to the compare output ──────────

it("shows the 'identical' message when a vs-now compare yields no changes", async () => {
  // loadDiff resolves [] = a SUCCESSFUL compare with no differences (identical).
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([]);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  // The clear "identical" message replaces the generic "no differences" text.
  expect(await screen.findByText(/identical to the current workspace/i)).toBeInTheDocument();
  // No restore controls render for an identical snapshot (nothing to restore).
  expect(screen.queryByRole("button", { name: "Restore selected" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
});

it("scrolls the compare output into view after a compare resolves", async () => {
  const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  // Capture the scheduled rAF callback and fire it MANUALLY after the diff has
  // committed, so the assertion doesn't depend on real frame timing (jsdom's rAF
  // isn't reliably flushed under CI load → the old waitFor was flaky).
  let rafCb: FrameRequestCallback | undefined;
  const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => { rafCb = cb; return 1; });
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "auto", label: null, summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "A", after: "B" }] },
  ]);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  await screen.findByText("T1"); // diff committed → compareRef is populated
  rafCb?.(0); // fire the scheduled rAF now that the compare output is in the DOM
  expect(scrollSpy).toHaveBeenCalled();
  rafSpy.mockRestore();
  scrollSpy.mockRestore();
});

// ── §243: row-unique accessible names ─────────────────────────────────────

it("gives the compare-vs-now and restore-state row controls distinct accessible names (§243)", () => {
  // ★★ TWO versions. This surface collides from N=2 unconditionally - the
  // "Compared with current" and "Restore this state" buttons are named by their
  // TEXT, with nothing row-specific in them at all.
  const versions: ProjectVersionMeta[] = [
    { id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Checkpoint", summary: null },
    { id: "v2", projectId: "p1", capturedAt: "2026-06-11T09:00:00.000Z", trigger: "manual", label: "Checkpoint", summary: null },
  ];
  renderPanel(<HistoryPanel lang="en-US" versions={versions} busy={false} onCaptureNow={vi.fn()} loadDiff={vi.fn().mockResolvedValue([])} restore={vi.fn().mockResolvedValue(undefined)} onDelete={vi.fn().mockResolvedValue(true)} />);
  // ★★ `checkbox` is load-bearing, not padding. The per-row compare tick is a
  // `Checkbox` → `<input type="checkbox">`, so the DEFAULT `roles: ["button"]`
  // never sees it and the fix to its aria-label shipped with zero coverage.
  // Mutation-proved: restoring the pre-fix space-joined label makes this RED
  // ("Select to compare Checkpoint" x2) while the button-only form stays GREEN.
  expectRowUniqueNames({ minControls: 2, roles: ["button", "checkbox"], requireCollisionSeed: true });
});

// ── T8: compare-header restore controls (Select all / Deselect all / state) ──

it("select-all ticks every record and enables restore-selected; deselect-all clears it", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "Old", after: "New" }] },
    { collection: "raid", collectionLabel: "RAID", kind: "list", recordId: 5, recordLabel: "R5",
      type: "added", fields: [] },
  ]);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  await screen.findByText("T1");
  // Restore-selected starts disabled (no ticks yet).
  const restoreSelected = screen.getByRole("button", { name: "Restore selected" });
  expect(restoreSelected).toBeDisabled();
  // Select all → every record checkbox ticked + restore-selected enabled.
  fireEvent.click(screen.getByRole("button", { name: "Select all" }));
  expect((screen.getByLabelText("Select – T1") as HTMLInputElement).checked).toBe(true);
  expect((screen.getByLabelText("Select – R5") as HTMLInputElement).checked).toBe(true);
  expect(restoreSelected).toBeEnabled();
  // Deselect all → cleared + restore-selected disabled again.
  fireEvent.click(screen.getByRole("button", { name: "Deselect all" }));
  expect((screen.getByLabelText("Select – T1") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText("Select – R5") as HTMLInputElement).checked).toBe(false);
  expect(restoreSelected).toBeDisabled();
});

it("restore-this-state (compare header) restores the whole snapshot with an all-'all' selection", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1",
      type: "modified", fields: [{ field: "title", label: "Title", before: "Old", after: "New" }] },
    { collection: "raid", collectionLabel: "RAID", kind: "list", recordId: 5, recordLabel: "R5",
      type: "added", fields: [] },
  ]);
  const restore = vi.fn().mockResolvedValue(undefined);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={restore} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  await screen.findByText("T1");
  // Two "Restore this state" buttons render while comparing: the version row's
  // (now token-disambiguated to "Restore this state – Baseline", §243) and the
  // compare header's (bare — a vs-now compare never sets compareLabels, so its
  // fallback branch is the one that fires). The bare name is therefore unique
  // here and resolves to the header button alone.
  const stateButton = screen.getByRole("button", { name: "Restore this state" });
  fireEvent.click(stateButton);
  expect(restore).toHaveBeenCalledWith("v1", { [changeKey("tasks", 1)]: "all", [changeKey("raid", 5)]: "all" }, "Baseline");
});

// ── T11: non-restorable changes stay out of every select-all path ────────────

it("omits non-restorable changes from a select-all selection", () => {
  const changes: VersionChange[] = [
    { collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1,
      recordLabel: "T1", type: "modified", fields: [] },
    { collection: "documents", collectionLabel: "Documents", kind: "list", recordId: 1,
      recordLabel: "Doc", type: "modified", fields: [], restorable: false },
  ];
  // A selection carrying a key applyRestore skips is a promise the restore
  // cannot keep: it reports success having reverted nothing for that row.
  expect(Object.keys(selectableSelection(changes))).toEqual([changeKey("tasks", 1)]);
});

it("refuses a whole-version restore whose diff is entirely non-restorable", async () => {
  // ★★ The exact project this slice was written for: a documents-only session.
  // `changes` is NON-EMPTY (the diff is what ARMS a capture) while the selection
  // is EMPTY, so a guard testing `changes.length` passes it straight through to
  // `restore`, which reverts nothing and reports success. Mutation-proved: revert
  // the guard to `changes.length === 0` and this goes RED — the waitFor times out
  // on a toast that never fires, before the `restore` assertion is even reached.
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "documents", collectionLabel: "Documents", kind: "list", recordId: "d1",
      recordLabel: "Doc", type: "modified", fields: [], restorable: false },
  ]);
  const restore = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  renderWithToast(showToast, <HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={restore} />);
  fireEvent.click(screen.getByRole("button", { name: "Restore this state – Baseline" }));
  // ★★ Assert WHICH message, not merely that one fired. The two arms state
  // different facts and the wrong one is a user-visible falsehood: the generic
  // key says "no differences from the current project" while the document rows
  // are on screen. Mutation-proved: point both arms at `historyRestoreNothing`
  // and this goes RED (the sibling empty-diff test stays green, which is why
  // both tests are needed to pin the branch).
  await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", t("en-US", "historyRestoreNothingManaged")));
  expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "historyRestoreNothing"));
  expect(restore).not.toHaveBeenCalled();
});

it("tells an EMPTY-diff whole-version restore that the snapshot is identical, not that it is managed", async () => {
  // The other arm of the same guard: nothing to restore because there is nothing
  // there at all. Mutation-proved: point both arms at `historyRestoreNothingManaged`
  // and this goes RED while its sibling above stays green.
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const restore = vi.fn().mockResolvedValue(undefined);
  const showToast = vi.fn();
  renderWithToast(showToast, <HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={vi.fn().mockResolvedValue([])} restore={restore} />);
  fireEvent.click(screen.getByRole("button", { name: "Restore this state – Baseline" }));
  await waitFor(() => expect(showToast).toHaveBeenCalledWith("info", t("en-US", "historyRestoreNothing")));
  expect(showToast).not.toHaveBeenCalledWith("info", t("en-US", "historyRestoreNothingManaged"));
  expect(restore).not.toHaveBeenCalled();
});

it("offers no compare-header restore controls when every change is non-restorable", async () => {
  // ★★ The THIRD path of the same over-promise, one level up from the guard: the
  // header's "Restore this state" calls `restore` DIRECTLY with buildAllSelection(),
  // which is now empty here — so the control has to go, not merely no-op. Its
  // gate was `diff.length > 0`, and a documents-only diff is non-empty.
  // Mutation-proved: restore that gate and the first assertion goes RED.
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  const loadDiff = vi.fn().mockResolvedValue([
    { collection: "documents", collectionLabel: "Documents", kind: "list", recordId: "d1",
      recordLabel: "Doc", type: "modified", fields: [], restorable: false },
  ]);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={vi.fn().mockResolvedValue(undefined)} />);
  fireEvent.click(screen.getByText(/Compared with current/i));
  // The diff itself still RENDERS — it is what arms a capture, and Task 10 shows
  // the row with a "managed per document" hint instead of a checkbox.
  await screen.findByText("Doc");
  expect(screen.queryByRole("button", { name: "Restore this state" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Restore selected" })).toBeNull();
});

// ★★★ THE HOOK'S `busy` DOES NOT COVER THIS WINDOW, which is why a guard exists
// in the panel at all. `restore()` only reaches the call that sets `busy` after
// two awaits, and `restoreWholeVersion` runs a whole `loadDiff` before that — so
// between the click and `busy` flipping there is room for a second click. Two
// restores of one version are not a wipe, but they append two auto-captures and
// two activity entries for one user action.
it("runs one restore for a double-clicked 'Restore this state'", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  let release!: (v: VersionChange[]) => void;
  const loadDiff = vi.fn(() => new Promise<VersionChange[]>((res) => { release = res; }));
  const restore = vi.fn().mockResolvedValue(true);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff as never} restore={restore} />);
  const btn = screen.getByRole("button", { name: "Restore this state – Baseline" });
  // ★★★ ONE `act`, TWO NATIVE CLICKS — and the shape is what makes this test
  // isolate the REF rather than the disabled attribute. React batches updates
  // within a task, so the re-render that disables the button has not happened
  // when the second `.click()` dispatches: it reaches a still-enabled button
  // running the same handler closure, and only the synchronous ref turns it
  // away. Two `fireEvent.click` calls would each flush, so the second would be
  // swallowed by `disabled` and the test would stay green with the ref deleted.
  act(() => { btn.click(); btn.click(); });
  expect(loadDiff).toHaveBeenCalledTimes(1);
  await act(async () => {
    release([{ collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1, recordLabel: "T1", type: "modified", fields: [] }]);
  });
  expect(restore).toHaveBeenCalledTimes(1);
});

it("disables the row's restore control while its restore is running, and re-enables it after", async () => {
  const versions = [{ id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null }];
  let release!: (v: VersionChange[]) => void;
  const loadDiff = vi.fn(() => new Promise<VersionChange[]>((res) => { release = res; }));
  const restore = vi.fn().mockResolvedValue(true);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff as never} restore={restore} />);
  const btn = screen.getByRole("button", { name: "Restore this state – Baseline" });
  expect(btn).not.toBeDisabled();
  fireEvent.click(btn);
  // The affordance half of the guard: without it a rejected second click is
  // indistinguishable from a dead control.
  expect(btn).toBeDisabled();
  // Resolve to an EMPTY diff so the flow short-circuits on the toast path — the
  // guard must release on every exit, not only the successful one.
  await act(async () => { release([]); });
  expect(restore).not.toHaveBeenCalled();
  expect(btn).not.toBeDisabled();
});

// ★★ `VersionDiffView` owns its per-row `open` set, and the panel cannot reach
// it (`react-hooks/set-state-in-effect` is banned). Replacing `diff` without
// remounting left stale keys behind, and `changeKey("tasks", 1)` is the same
// string in every compare — so a row expanded in one comparison came back
// pre-expanded in the next. The × button already unmounts the whole block; this
// covers compare→compare, which does not.
it("collapses expanded rows when a second compare replaces the first", async () => {
  const versions = [
    { id: "v2", projectId: "p1", capturedAt: "2026-06-11T12:00:00.000Z", trigger: "manual", label: "Later", summary: null },
    { id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null },
  ];
  // The SAME record key in both compares — that identity is the whole hazard.
  const change: VersionChange = {
    collection: "tasks", collectionLabel: "Tasks", kind: "list", recordId: 1,
    recordLabel: "T1", type: "modified",
    fields: [{ field: "title", label: "Title", before: "Old", after: "New" }],
  };
  const loadDiff = vi.fn().mockResolvedValue([change]);
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff} restore={vi.fn().mockResolvedValue(true)} />);

  fireEvent.click(screen.getByRole("button", { name: "Compared with current – Baseline" }));
  await waitFor(() => expect(screen.getByText("T1")).toBeInTheDocument());
  fireEvent.click(screen.getByText("T1"));
  expect(screen.getByText(/Title:/)).toBeVisible();

  // A second compare, WITHOUT closing the first.
  fireEvent.click(screen.getByRole("button", { name: "Compared with current – Later" }));
  await waitFor(() => expect(loadDiff).toHaveBeenCalledTimes(2));
  // The panel is conditionally rendered, so a collapsed row has no field text at
  // all — `queryByText(...) === null` is the assertion, and `getByText` would
  // throw rather than fail. If the panel ever goes back to being hidden-toggled,
  // this becomes `not.toBeVisible()`.
  expect(screen.queryByText(/Title:/)).toBeNull();
});

// ★★ THE THREE COMPARE GATES, which shipped with no coverage: a mutant deleting
// `|| restoring` from any of them survived the suite. Compare reads the LIVE
// workspace through getPayload(), so a compare started mid-restore diffs against
// a workspace being rewritten underneath it.
it("disables all three compare controls while a restore is running", async () => {
  const versions = [
    { id: "v2", projectId: "p1", capturedAt: "2026-06-11T12:00:00.000Z", trigger: "manual", label: "Later", summary: null },
    { id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z", trigger: "manual", label: "Baseline", summary: null },
  ];
  let release!: (v: VersionChange[]) => void;
  // The FIRST call is restoreWholeVersion's own loadDiff, which we hold open.
  const loadDiff = vi.fn(() => new Promise<VersionChange[]>((res) => { release = res; }));
  renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false} onCaptureNow={() => {}} loadDiff={loadDiff as never} restore={vi.fn().mockResolvedValue(true)} />);

  // Tick both versions so the two toolbar buttons are otherwise enabled — the
  // gate we are testing must be the `restoring` one, not `selected.length !== 2`.
  screen.getAllByRole("checkbox").forEach((c) => fireEvent.click(c));
  const toolbar = [
    screen.getByRole("button", { name: t("en-US", "historyCompareSelected") }),
    screen.getByRole("button", { name: t("en-US", "historyCompareSideBySide") }),
  ];
  const perRow = screen.getByRole("button", { name: "Compared with current – Baseline" });
  [...toolbar, perRow].forEach((b) => expect(b).not.toBeDisabled());

  fireEvent.click(screen.getByRole("button", { name: "Restore this state – Baseline" }));
  [...toolbar, perRow].forEach((b) => expect(b).toBeDisabled());

  await act(async () => { release([]); });
  [...toolbar, perRow].forEach((b) => expect(b).not.toBeDisabled());
});

// ── §256: recordSelection — the single-record counterpart of selectableSelection ──

describe("recordSelection", () => {
  const change = (collection: string, recordId: number, restorable?: false): VersionChange => ({
    collection, collectionLabel: collection, kind: "list", recordId,
    recordLabel: `#${recordId}`, type: "modified", fields: [],
    ...(restorable === false ? { restorable: false as const } : {}),
  });

  it("selects a restorable record by its key", () => {
    const changes = [change("tasks", 1)];
    expect(recordSelection(changeKey("tasks", 1), changes)).toEqual({ [changeKey("tasks", 1)]: "all" });
  });

  it("refuses a change marked restorable: false", () => {
    const changes = [change("documents", 7, false)];
    expect(recordSelection(changeKey("documents", 7), changes)).toBeNull();
  });

  it("refuses a key that names no change in the diff", () => {
    expect(recordSelection(changeKey("tasks", 99), [change("tasks", 1)])).toBeNull();
  });
});

describe("HistoryPanel — empty vs unavailable", () => {
  // ★★★ AN EMPTY LIST HAS TWO CAUSES AND ONLY ONE OF THEM IS "nothing captured
  //   yet". `use-version-history` returns `[]` whenever it is inactive — no
  //   Turso config, or no project id to key versions by — which is
  //   byte-identical to a brand-new project's list. Rendering "No versions yet"
  //   over the inactive case is what let a switched-off feature read as DELETED
  //   history: the user saw an empty timeline, pressed "save version", got no
  //   error, and concluded their data was gone.
  const noop = {
    onCaptureNow: vi.fn(),
    loadDiff: vi.fn().mockResolvedValue([]),
    restore: vi.fn().mockResolvedValue(undefined),
  };

  it("says the feature is unavailable, not that there are no versions yet", () => {
    renderPanel(<HistoryPanel lang="en-US" versions={[]} busy={false} unavailable {...noop} />);
    expect(screen.getByText(t("en-US", "historyUnavailable"))).toBeInTheDocument();
    // The load-bearing half: the reassuring-but-wrong copy must be ABSENT.
    // Without this the test passes with the branch deleted, because both
    // strings would render from the same empty list.
    expect(screen.queryByText(t("en-US", "historyEmpty"))).toBeNull();
  });

  it("still says there are no versions yet when history IS available", () => {
    // Control. Without it, a panel hardcoded to the unavailable copy — or one
    // that ignored `unavailable` and always showed it — satisfies the block
    // above.
    renderPanel(<HistoryPanel lang="en-US" versions={[]} busy={false} {...noop} />);
    expect(screen.getByText(t("en-US", "historyEmpty"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "historyUnavailable"))).toBeNull();
  });

  it("shows neither message once versions exist", () => {
    // `unavailable` must not leak into the populated case: the list wins.
    renderPanel(<HistoryPanel lang="en-US" versions={metas} busy={false} unavailable {...noop} />);
    expect(screen.queryByText(t("en-US", "historyUnavailable"))).toBeNull();
    expect(screen.queryByText(t("en-US", "historyEmpty"))).toBeNull();
  });
});
