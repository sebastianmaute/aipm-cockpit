import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskDedupModal } from "./task-dedup-modal";
import { type GroundedMergeGroup } from "./task-dedup/dedup";
import { t } from "./i18n";

// The unified description reaches this modal as HTML: dedup.ts sets it to
// sanitizeNoteHtml(...) output. This file exists because the modal rendered it
// RAW, so the user approving a DESTRUCTIVE merge read literal "<p>" markup in
// the one screen that describes what the merge will write.

function group(over: Partial<GroundedMergeGroup> = {}): GroundedMergeGroup {
  return {
    keepId: 1,
    keepTitle: "Ship the docs",
    merged: [{ id: 2, title: "Ship docs" }],
    rationale: "same work",
    unified: {},
    ...over,
  };
}

function renderModal(groups: readonly GroundedMergeGroup[]) {
  return render(
    <TaskDedupModal
      lang="en-US"
      open
      groups={groups}
      selected={new Set([1])}
      onToggle={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      busy={false}
    />,
  );
}

describe("TaskDedupModal — unified description", () => {
  it("shows the readable text, never the markup behind it", () => {
    // ★★ The headline assertion is the ABSENCE of markup plus the PRESENCE of
    // both words separated. Asserting only "contains Vendor delay" would pass
    // with the bug, because the raw markup contains that substring too.
    renderModal([
      group({ unified: { description: "<p>Vendor delay</p><p>Mitigation plan</p>" } }),
    ]);
    const label = t("en-US", "taskDedupUnifiedNotes");
    const line = screen.getByText(new RegExp(`${label}:\\s*Vendor delay Mitigation plan$`));
    expect(line.textContent).not.toContain("<p>");
    expect(line.textContent).not.toContain("&lt;");
    // ★ And it must not FUSE the two paragraphs either — the same block-boundary
    // rule the other five description consumers follow.
    expect(line.textContent).not.toContain("delayMitigation");
  });

  it("renders nothing for the row when there is no unified description", () => {
    renderModal([group({ unified: { taskName: "Ship docs" } })]);
    expect(screen.queryByText(new RegExp(t("en-US", "taskDedupUnifiedNotes")))).toBeNull();
  });

  it("keeps a plain-text unified description intact", () => {
    // descriptionHtml upgrades a legacy plain value, and the projection brings
    // it back — the round trip must not mangle an unformatted note.
    renderModal([group({ unified: { description: "just a note" } })]);
    expect(
      screen.getByText(new RegExp(`${t("en-US", "taskDedupUnifiedNotes")}:\\s*just a note$`)),
    ).toBeTruthy();
  });
});
