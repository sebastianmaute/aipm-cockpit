import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsHistoryModal } from "./documents-history-modal";
import type { DocVersion } from "./document-versions";
import type { ProjectDocument } from "./document-model";

const VERSIONS: readonly DocVersion[] = [
  {
    id: 2,
    documentId: 1,
    title: "Second",
    blocks: [],
    savedAt: "2026-08-05T10:00:00.000Z",
    source: "ai",
    op: "update",
  },
  {
    id: 1,
    documentId: 1,
    title: "First",
    blocks: [],
    savedAt: "2026-08-04T10:00:00.000Z",
    source: "user",
    op: "rename",
  },
];

const doc: ProjectDocument = {
  id: 1,
  title: "Status",
  blocks: [],
  createdAt: "2026-08-01T08:00:00.000Z",
  updatedAt: "2026-08-05T10:00:00.000Z",
};

function renderModal(over: Partial<Parameters<typeof DocumentsHistoryModal>[0]> = {}) {
  const onClose = vi.fn();
  const onRestore = vi.fn();
  const utils = render(
    <DocumentsHistoryModal
      open
      doc={doc}
      versions={VERSIONS}
      onClose={onClose}
      onRestore={onRestore}
      lang="en-US"
      {...over}
    />,
  );
  return { onClose, onRestore, ...utils };
}

describe("DocumentsHistoryModal", () => {
  it("names the dialog after the document", () => {
    renderModal();
    expect(screen.getByRole("dialog", { name: /History – Status/ })).toBeInTheDocument();
  });

  it("renders each version in the order given, with its source", () => {
    renderModal();
    // ★ The component does NOT sort — versions arrive sorted from the
    // orchestrator, the same contract DocumentsList.documents carries. So this
    // pins order PRESERVATION, not ordering. Naming it "newest first" (as the
    // sketch did) would describe a behaviour that lives somewhere else, and
    // would keep passing if this component started reversing its input.
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Second");
    expect(rows[0]).toHaveTextContent("Assistant");
    expect(rows[1]).toHaveTextContent("First");
    expect(rows[1]).toHaveTextContent("You");
  });

  it("renders the timestamp locale-free, to the minute", () => {
    renderModal();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("2026-08-05 10:00");
  });

  // ★★★ MUTATION-PROVED. The sketch asserted only
  // `new Set(names).size === names.length`, which passes when EVERY name is
  // `null` — one unlabelled button and one unlabelled button are "unique" to a
  // Set of size 1... and worse, `getAllByRole("button", {name: /Restore/})`
  // would not even find them, so the whole thing reduces to `0 === 0`. Three
  // things are asserted instead: the buttons exist (a count), every name is a
  // non-empty string, and each name carries something that identifies ITS
  // version rather than the shared verb.
  it("gives each Restore button a version-unique accessible name", () => {
    renderModal();
    const buttons = screen.getAllByRole("button", { name: /Restore/ });
    expect(buttons).toHaveLength(VERSIONS.length);

    const names = buttons.map((b) => b.getAttribute("aria-label"));
    expect(names.every((n) => typeof n === "string" && n.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    // The distinguishing part, not just the verb: a label of plain "Restore"
    // on every row would satisfy the two lines above only if the Set check
    // caught it, and it would not if the labels differed in some invisible way.
    expect(names[0]).toContain("Second");
    expect(names[1]).toContain("First");
  });

  // ★★ UNIQUE BY CONSTRUCTION, not merely unique in this fixture. Two
  // mutations in the same tick produce versions with an IDENTICAL `savedAt`,
  // and two successive `ops` writes leave the title unchanged too — so a label
  // built from title+timestamp alone collides on real data. The id is the only
  // field that cannot. This fixture is that collision.
  it("stays unique when title AND timestamp are identical across versions", () => {
    const collide: readonly DocVersion[] = [
      { ...VERSIONS[0], id: 8, title: "Same", savedAt: "2026-08-05T10:00:00.000Z" },
      { ...VERSIONS[1], id: 9, title: "Same", savedAt: "2026-08-05T10:00:00.000Z" },
    ];
    renderModal({ versions: collide });
    const names = screen
      .getAllByRole("button", { name: /Restore/ })
      .map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
  });

  // ★★★ MUTATION-PROVED — see the report. Asserts the id of the version whose
  // button was clicked, and clicks the SECOND row: with `toHaveBeenCalledWith(2)`
  // against the first row, an implementation passing the row INDEX, or the
  // document id, or a hardcoded first-version id would all still pass, because
  // the first row's version id happens to be 2.
  it("calls onRestore with the id of the version whose button was clicked", async () => {
    const user = userEvent.setup();
    const { onRestore } = renderModal();

    await user.click(screen.getAllByRole("button", { name: /Restore/ })[1]);

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith(1);
    // And the first row is a different id, so "always the same id" fails too.
    await user.click(screen.getAllByRole("button", { name: /Restore/ })[0]);
    expect(onRestore).toHaveBeenNthCalledWith(2, 2);
  });

  // ★★ The empty-state assertion needs a POSITIVE observable that the modal
  // rendered at all — `getByText(/No history yet/)` alone would fail rather
  // than pass against a component returning null, but it would also pass
  // against one that rendered ONLY that string and no dialog. Assert the
  // dialog, its name, and the absence of a list.
  it("shows an empty state, inside a real dialog, when there is no history", () => {
    renderModal({ versions: [] });
    expect(screen.getByRole("dialog", { name: /History – Status/ })).toBeInTheDocument();
    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
  });

  it("renders nothing when closed or when there is no document", () => {
    const { unmount } = renderModal({ open: false });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    unmount();

    renderModal({ doc: null });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes through the shared modal chrome", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    // The X comes from ModalHeader — the point is that dismissal is the shared
    // primitive's, not hand-rolled here.
    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("labels an assistant-written version differently from a user-written one", () => {
    renderModal();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows[0]).not.toHaveTextContent("You");
    expect(rows[1]).not.toHaveTextContent("Assistant");
  });
});
