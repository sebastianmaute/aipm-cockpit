import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentsHistoryModal, type HistoryAssetAccess } from "./documents-history-modal";
import type { DocVersion, DocVersionOp } from "./document-versions";
import type { DocBlock, ProjectDocument } from "./document-model";
import type { DocumentAsset } from "./document-asset";
import { emptyWorkspace, type Workspace } from "./workspace";

// ★ The byte store is the ONE thing this component reaches outside itself. The
// renderer is deliberately NOT mocked anywhere in this file (every other case
// asserts real rendered markup), so the image fixture below goes through the
// real `sanitizeDocumentHtml` too — which is what proves `data-asset-id`
// actually survives to the DOM the effect queries.
vi.mock("./document-assets-store", () => ({
  loadAssetData: vi.fn(), saveAssetData: vi.fn(), deleteAssetData: vi.fn(), loadAssetDataIds: vi.fn(),
}));
import { loadAssetData } from "./document-assets-store";

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

  // ★★★ IDENTITY, NOT MARKUP. A rebuilt subtree is BYTE-IDENTICAL, so an
  // `innerHTML` / `toHaveTextContent` assertion PASSES under the defect and
  // only the NODE can tell you React re-assigned `innerHTML`. That is exactly
  // how the same defect hid in `document-preview.tsx`, which carries the
  // measured account: React 19 diffs host props by `Object.is` and treats
  // `dangerouslySetInnerHTML` like any other prop, so an inline
  // `{{ __html: html }}` literal is a NEW object every render and this whole
  // panel is torn down and rebuilt on EVERY re-render, byte-identical `html`
  // or not.
  //
  // ★ `isReadOnly` is the unrelated prop: it reaches `HistoryRow` but is NOT in
  // the `html` memo's dep array (`[previewOpen, v, ws, lang]`) — it only
  // disables Restore. The disabled assertion below is the positive control that
  // the re-render actually reached this row, so a passing identity check cannot
  // be a render that never happened.
  it("does not rebuild the preview subtree on an unrelated re-render", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onRestore = vi.fn();
    // ★ One array, reused across both renders, so `v` keeps its identity — the
    // memo dep this test is NOT probing.
    const versions: readonly DocVersion[] = [
      { ...VERSIONS[0], id: 32, blocks: [HEADING, PARAGRAPH] },
    ];
    const { rerender } = render(
      <DocumentsHistoryModal
        open
        doc={doc}
        versions={versions}
        onClose={onClose}
        onRestore={onRestore}
        lang="en-US"
      />,
    );

    // The disclosure must be OPEN or there is no subtree to preserve at all.
    await user.click(screen.getByRole("button", { name: /Preview/ }));
    const panel = document.getElementById("documents-history-preview-32");
    const beforeFirst = panel?.firstChild ?? null;
    const beforeHeading = panel?.querySelector("h2") ?? null;
    expect(beforeFirst).not.toBeNull();
    expect(beforeHeading?.textContent).toBe("Section A");

    rerender(
      <DocumentsHistoryModal
        open
        doc={doc}
        versions={versions}
        onClose={onClose}
        onRestore={onRestore}
        lang="en-US"
        isReadOnly
      />,
    );

    expect(screen.getByRole("button", { name: /Restore/ })).toBeDisabled();
    expect(document.getElementById("documents-history-preview-32")).toBe(panel);
    expect(panel?.firstChild).toBe(beforeFirst);
    expect(panel?.querySelector("h2")).toBe(beforeHeading);
  });

  it("labels an assistant-written version differently from a user-written one", () => {
    renderModal();
    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows[0]).not.toHaveTextContent("You");
    expect(rows[1]).not.toHaveTextContent("Assistant");
  });
});

// ★★★ `dataSection` IS THE ONE BLOCK TYPE THAT READS THE WORKSPACE, AND ITS
// ABSENCE IS SILENT. `ws` is optional here and falls back to `emptyWorkspace()`,
// against which `resolveDataSection` returns null and the renderer emits the
// empty string — so the section vanishes with no throw, no broken markup and no
// layout change. Every other case in this file passes with `ws` dropped, which
// is exactly why this pair asserts the RESOLVED SECTION'S OWN CONTENT rather
// than that the panel has some text in it.
//
// ★★ These two pin the COMPONENT'S CONTRACT in both directions, directly. That
// the PANE actually hands it a workspace is a different claim and is pinned
// end-to-end in `documents-panel.test.tsx` ("the history modal's Preview") —
// neither file can stand in for the other: this one renders the modal itself
// and so can never observe a missing `ws={ws}` on the mount, and that one
// cannot exercise the no-workspace branch at all, because the pane always has
// one to pass.
describe("DocumentsHistoryModal — a version's dataSection in the Preview", () => {
  /** ★ Deliberately level 3, so `h2` inside the panel belongs to the data
   *  section ALONE. With a level-2 control the section's own `<h2>` title could
   *  only be checked by filtering a list of headings, and the negative case's
   *  "no section heading" would stop being a plain `querySelector(...)` null. */
  const CONTROL_HEADING: DocBlock = { type: "heading", level: 3, text: "Control heading" };
  const MILESTONES: DocBlock = { type: "dataSection", key: "milestones" };

  /** ★ `milestones` gates on `items.length > 0` in the export registry, so a
   *  single row is the whole requirement — and the name is a real
   *  `MILESTONES_CSV_COLUMNS` column, so it reaches a `<td>` verbatim. */
  const wsWithMilestone: Workspace = {
    ...emptyWorkspace(),
    milestones: [{ id: 7, name: "Charter countersigned", date: "2026-09-01", linkedTaskIds: [] }],
  };

  /** ONE version for both cases: a heading the renderer resolves with no
   *  workspace whatsoever, followed by the section that needs one. The heading
   *  is the positive observable the negative case needs — without it, "the
   *  milestone is absent" is indistinguishable from "the Preview never opened",
   *  which is the state this exact fixture would otherwise be asserting. */
  const version: DocVersion = { ...VERSIONS[0], id: 40, blocks: [CONTROL_HEADING, MILESTONES] };

  /** `ws: undefined` is precisely the unwired mount: the prop is optional, so
   *  omitting it and passing `undefined` both land on the component's own
   *  `ws ?? emptyWorkspace()` fallback. */
  async function openPreview(ws?: Workspace): Promise<HTMLElement> {
    const user = userEvent.setup();
    renderModal({ versions: [version], ws });
    await user.click(screen.getByRole("button", { name: /Preview/ }));
    const panel = document.getElementById("documents-history-preview-40");
    expect(panel).not.toBeNull();
    return panel as HTMLElement;
  }

  it("resolves the section against the workspace it is given", async () => {
    const panel = await openPreview(wsWithMilestone);

    // The control block rendered, so the disclosure really did open.
    expect(panel.textContent).toContain("Control heading");

    // The section resolved through the real export registry: its own title, a
    // real table, and the milestone's own name in a cell. Exact equality on
    // both — "Milestones" as a substring would also match a heading that merely
    // mentioned it, and the point here is that this IS the section's title.
    expect(panel.querySelector("h2")?.textContent).toBe("Milestones");
    expect(panel.querySelector("table")).not.toBeNull();
    const cells = [...panel.querySelectorAll("td")].map((c) => c.textContent);
    expect(cells).toContain("Charter countersigned");
  });

  it("renders the section as nothing when it is given no workspace", async () => {
    const panel = await openPreview();

    // ★★ THE POSITIVE OBSERVABLE, and the reason the three negatives below are
    // not vacuous: the same version's heading DID render, so the Preview opened
    // and the renderer ran. Only the workspace-dependent block is missing.
    expect(panel.textContent).toContain("Control heading");

    expect(panel.textContent).not.toContain("Charter countersigned");
    expect(panel.querySelector("table")).toBeNull();
    // Not a bare heading over an empty table either — the section is absent
    // whole, which is what makes the failure invisible in the running app.
    expect(panel.querySelector("h2")).toBeNull();
  });
});

// ★★★ open-followups §206: this modal renders a version's blocks through
// `renderDocumentHtml` — the SAME renderer `document-preview.tsx` uses — but was
// never wired to `attachAssetImages`. The renderer emits `<img data-asset-id>`
// with NO `src` by design (an image is referenced by id; see sanitize-html.ts),
// so a version containing an image previewed that block as a broken-image icon
// and nothing said why.
//
// ★★ THE FIX LANDS IN `HistoryRow`, not in the modal, because that is where the
// render happens — one expanded preview per row, each with its own subtree.
describe("DocumentsHistoryModal — asset images in a version Preview", () => {
  const TURSO = { httpUrl: "https://db.turso.io", authToken: "t" } as never;

  const ASSETS: readonly DocumentAsset[] = [{
    id: "a1", name: "chart.png", mime: "image/png", size: 3,
    hash: "0".repeat(64), createdAt: "2026-08-01T00:00:00.000Z",
  }];

  /** ★ An image IS a paragraph whose whole html is the `<img>` tag
   *  (`document-model.ts` states that contract) — there is no `image` block
   *  type to reach for. `a1` is inside `data-asset-id`'s own charset/length
   *  guard, so it survives the real sanitizer. */
  const IMAGE: DocBlock = { type: "paragraph", html: '<p><img data-asset-id="a1" alt="chart"></p>' };

  /** HEADING is the POSITIVE OBSERVABLE every case below needs: without it,
   *  "the image did not resolve" is indistinguishable from "the Preview never
   *  opened", which is the state a broken disclosure would also produce. */
  const version: DocVersion = { ...VERSIONS[0], id: 50, blocks: [HEADING, IMAGE] };

  /** A FRESH bag object each call, deliberately — see the C10 case below. */
  const access = (): HistoryAssetAccess => ({ tursoConfig: TURSO, projectId: "p1", assets: ASSETS });

  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL, createObjectURL: vi.fn(() => "blob:version-image"), revokeObjectURL: vi.fn(),
    });
    vi.mocked(loadAssetData).mockReset().mockResolvedValue("QUJD");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function openPreview(over: Partial<Parameters<typeof DocumentsHistoryModal>[0]> = {}) {
    const user = userEvent.setup();
    renderModal({ versions: [version], ...over });
    await user.click(screen.getByRole("button", { name: /Preview/ }));
    const panel = document.getElementById("documents-history-preview-50");
    expect(panel).not.toBeNull();
    return panel as HTMLElement;
  }

  it("resolves a version's image to blob bytes when the asset bag is supplied", async () => {
    const panel = await openPreview({ assetAccess: access() });
    expect(panel.textContent).toContain("Section A");

    const img = panel.querySelector("img[data-asset-id='a1']");
    expect(img).not.toBeNull();
    await waitFor(() => expect(img!.getAttribute("src")).toBe("blob:version-image"));
    expect(img!.hasAttribute("data-asset-missing")).toBe(false);
    // The bag's OWN three fields reached the loader — a `src` alone would also
    // appear if the effect fetched against some other project's partition.
    expect(loadAssetData).toHaveBeenCalledWith(TURSO, "a1", "p1");
  });

  it("still renders the version's blocks when no asset bag is supplied", async () => {
    // ★★ An ABSENT bag must degrade to the pre-§206 behaviour — blocks render,
    // images do not resolve — never to broken markup or a marker the user has
    // no repair path for. Documents images are Turso-gated, so this is the
    // shape every file-mode reader sees.
    const panel = await openPreview();
    expect(panel.textContent).toContain("Section A");

    const img = panel.querySelector("img[data-asset-id='a1']");
    expect(img).not.toBeNull();
    expect(img!.hasAttribute("src")).toBe(false);
    expect(img!.hasAttribute("data-asset-missing")).toBe(false);
    expect(loadAssetData).not.toHaveBeenCalled();
  });

  // ★★★ C10 MADE OBSERVABLE, and it is the whole reason the effect depends on
  // three hoisted locals rather than on the bag. `workspace-panels.tsx` builds
  // `assetPane={{ tursoConfig, projectId, assets, setAssets }}` as an INLINE
  // literal at the `DocumentsPanelLazy` mount, so the bag reaching this
  // component has a NEW identity on every render of the Documents tabpanel
  // while its three members stay reference-stable. Depending on the bag would
  // therefore re-run the effect — an UNCACHED Turso round trip — on every
  // unrelated re-render: the same `Object.is` identity failure `previewHtml`
  // exists to fix, one level up, introduced while fixing something else.
  //
  // Mutation surface: put the bag itself in the dependency array and this
  // reports 2.
  it("does not re-fetch the bytes when the caller hands it a fresh bag object", async () => {
    const user = userEvent.setup();
    const tree = (bag: HistoryAssetAccess) => (
      <DocumentsHistoryModal
        open
        doc={doc}
        versions={[version]}
        onClose={vi.fn()}
        onRestore={vi.fn()}
        lang="en-US"
        assetAccess={bag}
      />
    );
    const { rerender } = render(tree(access()));
    await user.click(screen.getByRole("button", { name: /Preview/ }));
    await waitFor(() => expect(loadAssetData).toHaveBeenCalledTimes(1));

    rerender(tree(access()));
    // ★ A REAL FLUSH, not a bare `waitFor` on the count: the load fires from
    // inside `attachAssetImages`'s `Promise.all`, so it lands a microtask after
    // the effect. `waitFor(…toHaveBeenCalledTimes(1))` would pass on its first
    // synchronous poll under the defect too, and assert nothing.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(loadAssetData).toHaveBeenCalledTimes(1);
  });
});
