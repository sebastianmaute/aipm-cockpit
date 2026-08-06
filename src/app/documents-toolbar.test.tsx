import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentsToolbar } from "./documents-toolbar";
import { expectButtonOrder, buttonNames } from "../test/toolbar-order";

const noop = () => {};

function setup(overrides: Partial<Parameters<typeof DocumentsToolbar>[0]> = {}) {
  return render(
    <DocumentsToolbar
      lang="en-US"
      onNew={noop}
      onDownload={noop}
      canDownload
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

  it("renders exactly one button per control — no duplicate accessible names", () => {
    // buttonIndex THROWS on an ambiguous match, so a duplicate name would make
    // every ordering assertion above unreliable rather than red. Pin it directly.
    setup();
    const names = buttonNames();
    expect(new Set(names).size).toBe(names.length);
  });
});
