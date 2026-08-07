import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsHistoryModal } from "./documents-history-modal";
import type { DocVersion, DocVersionOp } from "./document-versions";
import type { DocBlock, ProjectDocument } from "./document-model";

const PARAGRAPH: DocBlock = { type: "paragraph", html: "<p>Hello preview</p>" };
const HEADING: DocBlock = { type: "heading", level: 2, text: "Section A" };

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

  // ★★★ A restored MARKER is not a before-image — it is the bookkeeping entry
  // that closes a tombstone, and restoring one mints another copy of an
  // already-restored document plus a SECOND marker (measured against the
  // engine). It must never be offered.
  it("never offers a restored marker as a restorable version", () => {
    const withMarker: readonly DocVersion[] = [
      { ...VERSIONS[0], id: 5, title: "Marker", op: "restored" },
      ...VERSIONS,
    ];
    renderModal({ versions: withMarker });

    const buttons = screen.getAllByRole("button", { name: /Restore/ });
    expect(buttons).toHaveLength(2); // the two real versions, not three
    const names = buttons.map((b) => b.getAttribute("aria-label") ?? "");
    expect(names.some((n) => n.includes("#5"))).toBe(false);
    // Positive control: the real versions ARE still offered, so this is not
    // passing because the list failed to render at all.
    expect(names.some((n) => n.includes("#2"))).toBe(true);
    expect(names.some((n) => n.includes("#1"))).toBe(true);
  });

  // The empty state is driven by what is RESTORABLE, not by the raw input: a
  // group holding nothing but a marker has no history a user can act on.
  it("shows the empty state when the only version is a marker", () => {
    renderModal({ versions: [{ ...VERSIONS[0], id: 5, op: "restored" }] });
    expect(screen.getByRole("dialog", { name: /History – Status/ })).toBeInTheDocument();
    expect(screen.getByText(/No history yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Restore/ })).not.toBeInTheDocument();
  });

  // ★★ A popout must not hold a live Restore — it is the most destructive
  // control here (a restore replaces the whole document) and every other
  // control in this pane honours the guard. A real `disabled` attribute, not
  // an `aria-disabled` lookalike, which would still fire onClick.
  it("disables Restore in a read-only popout while still showing the history", async () => {
    const user = userEvent.setup();
    const { onRestore } = renderModal({ isReadOnly: true });

    const buttons = screen.getAllByRole("button", { name: /Restore/ });
    expect(buttons).toHaveLength(2); // history is still readable
    expect(buttons[0]).toBeDisabled();

    await user.click(buttons[0]);
    expect(onRestore).not.toHaveBeenCalled();
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

  // ★ Every op EXCEPT "restored", which `restorable` filters out before a row
  // is ever built — asserting it renders would pin a path this component cannot
  // reach. Its entry in the label map is there for exhaustiveness (a sixth op
  // must be a compile error), which the type system checks, not a test.
  // ★★ Each row also gets a NEGATIVE assertion against a different op's label:
  // without one, an implementation that rendered the SAME label on every row
  // would still satisfy four independent `toHaveTextContent` checks as long as
  // that label happened to be the one the row expected — and with four rows,
  // "always Edited" passes the first assertion outright.
  it("renders the op label for each op that can reach a row", () => {
    const ops: readonly DocVersionOp[] = ["update", "rename", "delete", "duplicate"];
    renderModal({
      versions: ops.map((op, i) => ({ ...VERSIONS[0], id: 20 + i, op })),
    });
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(ops.length);
    expect(rows[0]).toHaveTextContent("Edited");
    expect(rows[0]).not.toHaveTextContent("Renamed");
    expect(rows[1]).toHaveTextContent("Renamed");
    expect(rows[1]).not.toHaveTextContent("Edited");
    expect(rows[2]).toHaveTextContent("Deleted");
    expect(rows[2]).not.toHaveTextContent("Duplicated");
    expect(rows[3]).toHaveTextContent("Duplicated");
    expect(rows[3]).not.toHaveTextContent("Deleted");
  });

  // ★★★ MUTATION-PROVED — see the report. The `not.toHaveTextContent("1 blocks")`
  // line is the whole test: "1 blocks" CONTAINS "1 block", so an implementation
  // that always picked the plural key would satisfy the positive assertion and
  // ship the exact broken string ("1 blocks") the two-key split exists to
  // prevent. The positive line alone is vacuous here.
  it("uses the singular block-count label for one block and the plural otherwise", () => {
    renderModal({
      versions: [
        { ...VERSIONS[0], id: 11, blocks: [PARAGRAPH] },
        { ...VERSIONS[1], id: 12, blocks: [PARAGRAPH, HEADING] },
      ],
    });
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("1 block");
    expect(rows[0]).not.toHaveTextContent("1 blocks");
    expect(rows[1]).toHaveTextContent("2 blocks");
  });

  it("counts zero blocks with the plural label", () => {
    renderModal({ versions: [{ ...VERSIONS[0], id: 13, blocks: [] }] });
    expect(within(screen.getByRole("list")).getByRole("listitem")).toHaveTextContent("0 blocks");
  });

  // ★★★ MUTATION-PROVED — see the report. The count assertion comes FIRST and
  // deliberately: `new Set(names).size === names.length` is `0 === 0` when
  // getAllByRole found nothing, so a Set check on its own passes hardest
  // against a component that rendered no Preview buttons at all.
  // ★★ The fixture is the REAL collision, not two arbitrary rows: same title,
  // same timestamp to the minute. Anything built from those two fields alone
  // collides here, which is what a same-tick pair of mutations produces.
  it("gives each Preview button a version-unique accessible name when title and timestamp collide", () => {
    const collide: readonly DocVersion[] = [
      { ...VERSIONS[0], id: 8, title: "Same", savedAt: "2026-08-05T10:00:00.000Z" },
      { ...VERSIONS[1], id: 9, title: "Same", savedAt: "2026-08-05T10:00:00.000Z" },
    ];
    renderModal({ versions: collide });

    const buttons = screen.getAllByRole("button", { name: /Preview/ });
    expect(buttons).toHaveLength(2);
    const names = buttons.map((b) => b.getAttribute("aria-label"));
    expect(names.every((n) => typeof n === "string" && n.trim().length > 0)).toBe(true);
    expect(new Set(names).size).toBe(2);
    // The distinguishing part, not merely "different somehow": the version id.
    expect(names[0]).toContain("#8");
    expect(names[1]).toContain("#9");
  });

  // ★★ The aria-controls TARGET must exist while collapsed — that is the state
  // a screen reader meets first, and it is why the panel is `hidden`-toggled
  // rather than conditionally rendered. Asserted BEFORE the click.
  it("keeps the Preview panel mounted while collapsed and reveals content on toggle", async () => {
    const user = userEvent.setup();
    renderModal({
      versions: [{ ...VERSIONS[0], id: 30, blocks: [HEADING, PARAGRAPH] }],
    });

    const trigger = screen.getByRole("button", { name: /Preview/ });
    const panelId = trigger.getAttribute("aria-controls");
    expect(panelId).toBe("documents-history-preview-30");
    const panel = document.getElementById(panelId as string);
    expect(panel).not.toBeNull();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
    // Content is computed only while open, so the collapsed panel is genuinely
    // empty — a stronger observable than `hidden` alone, which a CSS-only
    // implementation could fake.
    expect(panel?.textContent).toBe("");

    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panel).toBeVisible();
    expect(panel?.textContent).toContain("Hello preview");
    // Rendered as real structure by the shared renderer, not as escaped text.
    expect(panel?.querySelector("h2")?.textContent).toBe("Section A");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(panel).not.toBeVisible();
  });

  // ★★★ The Preview is the one place in this component where a stored value
  // reaches `dangerouslySetInnerHTML`. It renders through `doc-render-html`'s
  // preview mode precisely because that module's `paragraph` case is the sink
  // that re-sanitizes; this pins that the reuse is real rather than a comment.
  it("strips script markup from a version's paragraph block", async () => {
    const user = userEvent.setup();
    renderModal({
      versions: [
        {
          ...VERSIONS[0],
          id: 31,
          blocks: [{ type: "paragraph", html: "<p>safe text</p><script>alert(1)</script>" }],
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: /Preview/ }));

    const panel = document.getElementById("documents-history-preview-31");
    // Positive control: the benign part DID render, so the absence below is not
    // "nothing rendered at all".
    expect(panel?.textContent).toContain("safe text");
    expect(panel?.querySelector("script")).toBeNull();
    expect(panel?.innerHTML ?? "").not.toContain("alert(1)");
  });

  it("labels an assistant-written version differently from a user-written one", () => {
    renderModal();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows[0]).not.toHaveTextContent("You");
    expect(rows[1]).not.toHaveTextContent("Assistant");
  });
});
