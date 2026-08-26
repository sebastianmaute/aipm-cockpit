import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { HistoryPanel } from "./history-panel";
import { DisplayTimezoneProvider } from "./display-timezone-context";
import { changeKey } from "./version-restore";
import type { VersionChange } from "./version-diff";

// A stand-in for the diff view that exposes `onRestoreRecord` as a plain button,
// so a test can hand the handler a key the real view would never offer. The real
// view renders no restore control on a non-restorable row (§256), so nothing
// driving the real component can reach `restoreRecord` with a refused key.
vi.mock("./version-diff-view", () => ({
  VersionDiffView: ({ onRestoreRecord }: { onRestoreRecord?: (key: string) => void }) => (
    <button type="button" onClick={() => onRestoreRecord?.(changeKey("documents", 7))}>
      stub-restore-record
    </button>
  ),
}));

function renderPanel(ui: React.ReactNode) {
  return render(<DisplayTimezoneProvider effectiveTz="Asia/Kolkata">{ui}</DisplayTimezoneProvider>);
}

const versions = [{
  id: "v1", projectId: "p1", capturedAt: "2026-06-10T09:00:00.000Z",
  trigger: "manual", label: "Baseline", summary: null,
}];

const changes: VersionChange[] = [{
  collection: "documents", collectionLabel: "Documents", kind: "list", recordId: 7,
  recordLabel: "Doc", type: "modified", fields: [], restorable: false as const,
}];

describe("restoreRecord call-site guard (§256)", () => {
  // ★★★ THE THREE PURE TESTS IN history-panel.test.tsx DO NOT PIN THE CALL SITE
  // — every one of them passes with `restoreRecord`'s use of `recordSelection`
  // deleted. The real view renders no restore control on a non-restorable row,
  // which is the same unreachability that kept §256 open, so nothing driving the
  // real component can reach this handler with a refused key. Hence the stub: it
  // is necessary, not convenient.
  it("does not call restore when the handler is handed a non-restorable key", async () => {
    const restore = vi.fn().mockResolvedValue(true);
    const loadDiff = vi.fn().mockResolvedValue(changes);
    renderPanel(<HistoryPanel lang="en-US" versions={versions as never} busy={false}
      onCaptureNow={() => {}} loadDiff={loadDiff} restore={restore} />);
    fireEvent.click(screen.getByRole("button", { name: "Compared with current – Baseline" }));
    await waitFor(() => screen.getByRole("button", { name: "stub-restore-record" }));
    fireEvent.click(screen.getByRole("button", { name: "stub-restore-record" }));
    expect(restore).not.toHaveBeenCalled();
  });
});
