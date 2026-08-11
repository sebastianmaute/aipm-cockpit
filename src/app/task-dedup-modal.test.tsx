import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskDedupModal } from "./task-dedup-modal";
import { type GroundedMergeGroup } from "./task-dedup/dedup";
import { t } from "./i18n";

// The unified description reaches this modal as HTML: dedup.ts sets it to
// sanitizeRichHtml(...) output. This file exists because the modal rendered it
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
    // ★★ THE PIN IS THE ANCHORED getByText, not the toContain below it. Revert
    // the modal to `{g.unified.description}` and the row reads
    // "Unified notes: <p>Vendor delay</p>…", which this regex cannot match — so
    // getByText THROWS "Unable to find an element" and that is the failure you
    // will read. Asserting only "contains Vendor delay" would pass with the bug,
    // because the raw markup contains that substring too; requiring the two
    // words with a single space between them, anchored at the end, is what
    // cannot be satisfied by markup.
    //
    // ★ `$` also stops a wrapping ancestor with trailing content from matching,
    // and the label comes from `t()` so a legitimate i18n change does not break
    // the test.
    renderModal([
      group({ unified: { description: "<p>Vendor delay</p><p>Mitigation plan</p>" } }),
    ]);
    const label = t("en-US", "taskDedupUnifiedNotes");
    const line = screen.getByText(new RegExp(`${label}:\\s*Vendor delay Mitigation plan$`));
    // Belt-and-braces, and deliberately NOT called the headline: textContent
    // DECODES entities, so an `&lt;` assertion here would be unfailable — the
    // raw-render mutation surfaces a literal "<p>", never "&lt;".
    expect(line.textContent).not.toContain("<p>");
  });

  it("renders nothing for the row when there is no unified description", () => {
    renderModal([group({ unified: { taskName: "Ship docs" } })]);
    expect(screen.queryByText(new RegExp(t("en-US", "taskDedupUnifiedNotes")))).toBeNull();
  });

  it("keeps a plain-text unified description intact", () => {
    // ★ HONEST SCOPE: this one does NOT catch the raw-render bug — a plain value
    // renders identically either way. It pins the legacy-plain round trip
    // (descriptionHtml upgrade → projection back) at this surface, which
    // rich-text-projection.test.ts already covers at unit level. Kept as a
    // regression net for the upgrade path, not as evidence the projection is
    // wired.
    renderModal([group({ unified: { description: "just a note" } })]);
    expect(
      screen.getByText(new RegExp(`${t("en-US", "taskDedupUnifiedNotes")}:\\s*just a note$`)),
    ).toBeTruthy();
  });
});
