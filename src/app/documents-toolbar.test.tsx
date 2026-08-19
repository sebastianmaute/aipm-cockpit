import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, type RenderResult } from "@testing-library/react";
import { DocumentsToolbar, DOC_FORMATS } from "./documents-toolbar";
import { expectButtonOrder, buttonNames } from "../test/toolbar-order";
import { t } from "./i18n";

const noop = () => {};
const LANG = "en-US";

function renderToolbar(overrides: Partial<Parameters<typeof DocumentsToolbar>[0]> = {}) {
  return render(
    <DocumentsToolbar
      lang={LANG}
      onNew={noop}
      onDownload={noop}
      canDownload
      format="docx"
      onFormatChange={noop}
      onResetColumns={noop}
      onResetSize={noop}
      showDeleted={false}
      onShowDeletedChange={noop}
      deletedCount={0}
      editToolbar={{ editing: false, onToggleEditing: noop, canEdit: true }}
      {...overrides}
    />,
  );
}

function rerenderToolbar(
  rerender: RenderResult["rerender"],
  overrides: Partial<Parameters<typeof DocumentsToolbar>[0]> = {},
) {
  return rerender(
    <DocumentsToolbar
      lang={LANG}
      onNew={noop}
      onDownload={noop}
      canDownload
      format="docx"
      onFormatChange={noop}
      onResetColumns={noop}
      onResetSize={noop}
      showDeleted={false}
      onShowDeletedChange={noop}
      deletedCount={0}
      editToolbar={{ editing: false, onToggleEditing: noop, canEdit: true }}
      {...overrides}
    />,
  );
}

describe("DocumentsToolbar", () => {
  it("leads with the primary New document action", () => {
    renderToolbar();
    // The convention: a pane's PRIMARY action leads the control row, ahead of
    // everything else. Plain ordering (not contiguous) — it only has to come
    // BEFORE the trailing group.
    expectButtonOrder(["documentsNew", "printHint"]);
  });

  it("ends with the contiguous Print / reset-columns / reset-size group", () => {
    renderToolbar();
    // ★ `contiguous` is the assertion that matters. Plain ordering leaves the
    // indices ascending when a stray control drifts BETWEEN two members, which
    // is the exact drift this convention has been broken by before.
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
  });

  it("places Download before the trailing group, not inside it", () => {
    renderToolbar();
    expectButtonOrder(["documentsDownload", "printHint"]);
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
  });

  it("still ends with the contiguous trailing group when Download is disabled", () => {
    // ★ Guards the shape a conditional render would break: if the Download
    // button were REMOVED rather than disabled when nothing is selected, the
    // toolbar's control count would change between states and a control could
    // slide into the trailing group unnoticed. Rendering it disabled keeps one
    // stable layout.
    renderToolbar({ canDownload: false });
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
    const download = screen.getByRole("button", { name: "Download" });
    expect(download).toBeDisabled();
  });

  it("gives the format picker its OWN accessible name, distinct from Download", () => {
    renderToolbar();
    // ★★ Reusing "Download" here would put two adjacent controls under one name
    // — a WCAG 2.4.6 failure axe will NOT flag, since they are different roles
    // and each has *a* name. And a bare <select> beside a visible <span> is not
    // labelled at all, which IS axe-critical. So: its own aria-label.
    const picker = screen.getByRole("combobox", { name: "Download format" });
    expect(picker).toBeInTheDocument();
    expect(picker.getAttribute("aria-label")).not.toBe("Download");
  });

  it("offers every format downloadDocument supports", () => {
    // ★ Derived from DOC_FORMATS rather than a hardcoded list, so adding a
    // format to the module without adding an option fails here.
    renderToolbar();
    const picker = screen.getByRole("combobox", { name: "Download format" });
    const values = [...picker.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(values.sort()).toEqual(["docx", "html", "pdf", "pptx"]);
    expect(values).toHaveLength(DOC_FORMATS.length);
  });

  it("reports the chosen format to its parent", () => {
    const onFormatChange = vi.fn();
    renderToolbar({ onFormatChange });
    fireEvent.change(screen.getByRole("combobox", { name: "Download format" }), {
      target: { value: "pptx" },
    });
    expect(onFormatChange).toHaveBeenCalledWith("pptx");
  });

  it("sits ahead of the trailing group and does not break its contiguity", () => {
    // ★ The shared helper reads BUTTONS only, so the combobox is invisible to
    // it — this position check has to be hand-rolled against the DOM.
    renderToolbar();
    const picker = screen.getByRole("combobox", { name: "Download format" });
    const print = screen.getByRole("button", { name: /print/i });
    expect(picker.compareDocumentPosition(print) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
  });

  it("disables ONLY the create action when read-only", () => {
    renderToolbar({ isReadOnly: true });
    expect(screen.getByRole("button", { name: "New document" })).toBeDisabled();
    // Download, print and the view controls mutate nothing — they stay live, or
    // a popout becomes useless rather than merely read-only.
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Download format" })).toBeEnabled();
  });

  describe("the deleted-documents toggle", () => {
    it("sits after the pane actions and BEFORE the contiguous trailing group", () => {
      renderToolbar();
      expectButtonOrder(["documentsNew", "documentsDownload", "documentsShowDeleted", "printHint"]);
      // ★ Ordering alone is not enough: a control landing BETWEEN two members
      // of the trailing group leaves the indices ascending. Only `contiguous`
      // catches that, and it is the exact drift the convention has been broken
      // by more than once.
      expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
    });

    // ★★★ MUTATION-PROVED. Two separate claims, and the second is the one that
    // catches a label flipped to the opposite action: `aria-pressed` must track
    // the state the VISIBLE LABEL names, so "Deleted documents, pressed" means
    // deleted documents ARE shown. axe passes a flipped label (a name exists),
    // so this is the only coverage.
    it("announces the state on the label it enables", () => {
      const { unmount } = renderToolbar({ showDeleted: false });
      const off = screen.getByRole("button", { name: /Deleted documents/ });
      expect(off).toHaveAttribute("aria-pressed", "false");
      unmount();

      renderToolbar({ showDeleted: true });
      const on = screen.getByRole("button", { name: /Deleted documents/ });
      expect(on).toHaveAttribute("aria-pressed", "true");
      // The label does NOT flip to "Hide…" — it names what pressed=true
      // enables, in both states.
      expect(on.textContent).toContain("Deleted documents");
    });

    it("reports the flipped value to its parent", () => {
      const onShowDeletedChange = vi.fn();
      const { unmount } = renderToolbar({ showDeleted: false, onShowDeletedChange });
      fireEvent.click(screen.getByRole("button", { name: /Deleted documents/ }));
      expect(onShowDeletedChange).toHaveBeenCalledWith(true);
      unmount();

      // The other direction, so a hardcoded `true` fails.
      const onShowDeletedChange2 = vi.fn();
      renderToolbar({ showDeleted: true, onShowDeletedChange: onShowDeletedChange2 });
      fireEvent.click(screen.getByRole("button", { name: /Deleted documents/ }));
      expect(onShowDeletedChange2).toHaveBeenCalledWith(false);
    });

    it("shows the count, which is the only signal an implausible list gives", () => {
      // A corrupted `documents` blob beside a valid versions blob makes EVERY
      // version read as deleted; "Deleted documents (200)" next to an empty
      // pane is what tells the user that.
      renderToolbar({ deletedCount: 200 });
      expect(screen.getByRole("button", { name: /Deleted documents/ }).textContent).toContain("(200)");
    });

    it("carries the non-colour pressed marker the dark schemes depend on", () => {
      // ★★ In the three DARK schemes the pressed-vs-unpressed BORDER measures
      // 1.03–1.22:1, so colour cannot be the only channel (WCAG 1.4.1) — the
      // primitive renders a trailing marker glyph instead. Pinned here because
      // using a hand-rolled `aria-pressed` button would lose it silently and
      // axe has no rule that would notice.
      renderToolbar({ showDeleted: true });
      const toggle = screen.getByRole("button", { name: /Deleted documents/ });
      expect(toggle.querySelector("[data-pressed-marker]")).not.toBeNull();
    });
  });

  describe("the edit-mode toggle", () => {
    it("sits after the pane actions and BEFORE the contiguous trailing group", () => {
      renderToolbar();
      expectButtonOrder(["documentsNew", "documentsDownload", "documentsShowDeleted", "documentsEditBlocks", "printHint"]);
      expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
    });

    // ★★★ MUTATION-PROVED, mirroring the deleted-documents toggle: the label
    // must NOT flip to "Preview" — `aria-pressed` has to track the state the
    // pinned label names, or the announcement implies the wrong mode is on
    // (WCAG 4.1.2). axe cannot catch a flipped label; this is the only cover.
    it("announces the state on the label it enables, never flipping it", () => {
      const { unmount } = renderToolbar({
        editToolbar: { editing: false, onToggleEditing: noop, canEdit: true },
      });
      const off = screen.getByRole("button", { name: /Edit blocks/ });
      expect(off).toHaveAttribute("aria-pressed", "false");
      unmount();

      renderToolbar({ editToolbar: { editing: true, onToggleEditing: noop, canEdit: true } });
      const on = screen.getByRole("button", { name: /Edit blocks/ });
      expect(on).toHaveAttribute("aria-pressed", "true");
      expect(on.textContent).toContain("Edit blocks");
    });

    it("reports the flipped value to its parent", () => {
      const onToggleEditing = vi.fn();
      renderToolbar({ editToolbar: { editing: false, onToggleEditing, canEdit: true } });
      fireEvent.click(screen.getByRole("button", { name: /Edit blocks/ }));
      expect(onToggleEditing).toHaveBeenCalledTimes(1);
    });

    it("is disabled in a read-only popout mirror, not silently inert", () => {
      renderToolbar({ isReadOnly: true });
      expect(screen.getByRole("button", { name: /Edit blocks/ })).toBeDisabled();
    });

    // ★★★ A TOGGLE THAT PRESSES AND DOES NOTHING IS A LIE. With no documents
    //  selected, `DocumentEditModeBody` short-circuits on `doc === null` and
    //  renders the preview — so the pressed state announced the block editor as
    //  active while nothing had changed (WCAG 4.1.2). axe passes it: a name
    //  exists and aria-pressed is a legal attribute. Only this test can see it.
    it("is disabled when no document is selected", () => {
      renderToolbar({ editToolbar: { editing: false, onToggleEditing: noop, canEdit: false } });
      expect(screen.getByRole("button", { name: t(LANG, "documentsEditBlocks") })).toBeDisabled();
    });

    it("is enabled once a document is selected", () => {
      renderToolbar({ editToolbar: { editing: false, onToggleEditing: noop, canEdit: true } });
      expect(screen.getByRole("button", { name: t(LANG, "documentsEditBlocks") })).toBeEnabled();
    });

    // ★★ A DISABLED TOGGLE LEAVES THE TAB ORDER AND `ToggleButton` SUPPRESSES ITS
    //  state suffix while disabled, so without a description it announces a bare
    //  name and nothing about WHY it is inert. The two reasons differ, so the
    //  text is derived rather than fixed.
    it("explains why it is disabled — no document vs a read-only mirror", () => {
      const { rerender } = renderToolbar({
        editToolbar: { editing: false, onToggleEditing: noop, canEdit: false },
      });
      const noDoc = screen.getByRole("button", { name: t(LANG, "documentsEditBlocks") });
      expect(noDoc).toHaveAccessibleDescription(t(LANG, "documentsEditBlocksNoDocument"));

      rerenderToolbar(rerender, {
        isReadOnly: true,
        editToolbar: { editing: false, onToggleEditing: noop, canEdit: true },
      });
      expect(
        screen.getByRole("button", { name: t(LANG, "documentsEditBlocks") }),
      ).toHaveAccessibleDescription(t(LANG, "documentsReadOnlyMirror"));
    });

    it("explains why the New document button is inert in a read-only mirror", () => {
      renderToolbar({ isReadOnly: true });
      expect(
        screen.getByRole("button", { name: new RegExp(t(LANG, "documentsNew")) }),
      ).toHaveAccessibleDescription(t(LANG, "documentsReadOnlyMirror"));
    });
  });

  it("renders exactly one button per control — no duplicate accessible names", () => {
    // buttonIndex THROWS on an ambiguous match, so a duplicate name would make
    // every ordering assertion above unreliable rather than red. Pin it directly.
    renderToolbar();
    const names = buttonNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
