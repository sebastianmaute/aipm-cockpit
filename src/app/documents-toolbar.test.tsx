import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentsToolbar, DOC_FORMATS } from "./documents-toolbar";
import { expectButtonOrder, buttonNames } from "../test/toolbar-order";

const noop = () => {};

function setup(overrides: Partial<Parameters<typeof DocumentsToolbar>[0]> = {}) {
  return render(
    <DocumentsToolbar
      lang="en-US"
      onNew={noop}
      onDownload={noop}
      canDownload
      format="docx"
      onFormatChange={noop}
      onResetColumns={noop}
      onResetSize={noop}
      {...overrides}
    />,
  );
}

describe("DocumentsToolbar", () => {
  it("leads with the primary New document action", () => {
    setup();
    // The convention: a pane's PRIMARY action leads the control row, ahead of
    // everything else. Plain ordering (not contiguous) — it only has to come
    // BEFORE the trailing group.
    expectButtonOrder(["documentsNew", "printHint"]);
  });

  it("ends with the contiguous Print / reset-columns / reset-size group", () => {
    setup();
    // ★ `contiguous` is the assertion that matters. Plain ordering leaves the
    // indices ascending when a stray control drifts BETWEEN two members, which
    // is the exact drift this convention has been broken by before.
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
  });

  it("places Download before the trailing group, not inside it", () => {
    setup();
    expectButtonOrder(["documentsDownload", "printHint"]);
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
  });

  it("still ends with the contiguous trailing group when Download is disabled", () => {
    // ★ Guards the shape a conditional render would break: if the Download
    // button were REMOVED rather than disabled when nothing is selected, the
    // toolbar's control count would change between states and a control could
    // slide into the trailing group unnoticed. Rendering it disabled keeps one
    // stable layout.
    setup({ canDownload: false });
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
    const download = screen.getByRole("button", { name: "Download" });
    expect(download).toBeDisabled();
  });

  it("gives the format picker its OWN accessible name, distinct from Download", () => {
    setup();
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
    setup();
    const picker = screen.getByRole("combobox", { name: "Download format" });
    const values = [...picker.querySelectorAll("option")].map((o) => o.getAttribute("value"));
    expect(values.sort()).toEqual(["docx", "html", "pdf", "pptx"]);
    expect(values).toHaveLength(DOC_FORMATS.length);
  });

  it("reports the chosen format to its parent", () => {
    const onFormatChange = vi.fn();
    setup({ onFormatChange });
    fireEvent.change(screen.getByRole("combobox", { name: "Download format" }), {
      target: { value: "pptx" },
    });
    expect(onFormatChange).toHaveBeenCalledWith("pptx");
  });

  it("sits ahead of the trailing group and does not break its contiguity", () => {
    // ★ The shared helper reads BUTTONS only, so the combobox is invisible to
    // it — this position check has to be hand-rolled against the DOM.
    setup();
    const picker = screen.getByRole("combobox", { name: "Download format" });
    const print = screen.getByRole("button", { name: /print/i });
    expect(picker.compareDocumentPosition(print) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], { contiguous: true });
  });

  it("disables ONLY the create action when read-only", () => {
    setup({ isReadOnly: true });
    expect(screen.getByRole("button", { name: "New document" })).toBeDisabled();
    // Download, print and the view controls mutate nothing — they stay live, or
    // a popout becomes useless rather than merely read-only.
    expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Download format" })).toBeEnabled();
  });

  it("renders exactly one button per control — no duplicate accessible names", () => {
    // buttonIndex THROWS on an ambiguous match, so a duplicate name would make
    // every ordering assertion above unreliable rather than red. Pin it directly.
    setup();
    const names = buttonNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
