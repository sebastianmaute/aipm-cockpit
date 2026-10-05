// open-followups §545, documents half — a document `dataSection` block may
// name the derived `budgetForecast` section, and every document surface
// renders it from the same `ExportExtras` the workspace export receives: the
// shared resolver, the three renderers, the in-app preview and the history
// row's preview (the last two read it from `ExportExtrasProvider`).
//
// ★ Every negative case keeps a POSITIVE observable beside it — a heading block
//   the renderer emits with no extras at all — so "the forecast is absent" can
//   never be satisfied by a render that produced nothing.
import { describe, it, expect, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { resolveDataSection } from "./doc-data-section";
import { renderDocumentHtml } from "./doc-render-html";
import { renderDocumentDocx } from "./doc-render-docx";
import { renderDocumentPptx } from "./doc-render-pptx";
import { DocumentPreview } from "./document-preview";
import { DocumentsHistoryModal } from "./documents-history-modal";
import { ExportExtrasProvider, useExportExtras } from "./export-extras-context";
import { emptyWorkspace } from "./workspace";
import { t } from "./i18n";
import { unzipBytes } from "../test/unzip-bytes";
import { forecastBundleFixture } from "../test/forecast-bundle-fixture";
import type { DocBlock, ProjectDocument } from "./document-model";
import type { DocVersion } from "./document-versions";

vi.mock("./document-assets-store", () => ({
  loadAssetData: vi.fn(), saveAssetData: vi.fn(), deleteAssetData: vi.fn(), loadAssetDataIds: vi.fn(),
}));

const LANG = "en-US";
const BAC = t(LANG, "forecastFactBac");
const TITLE = t(LANG, "exportLabelBudgetForecast");
const CONTROL: DocBlock = { type: "heading", level: 3, text: "Control heading" };
const FORECAST: DocBlock = { type: "dataSection", key: "budgetForecast" };
const doc: ProjectDocument = {
  id: 1, title: "Steering pack", blocks: [CONTROL, FORECAST],
  createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z",
};
const ws = emptyWorkspace();
const extras = () => ({ budgetForecast: forecastBundleFixture() });

async function packageText(blob: Blob): Promise<string> {
  const dec = new TextDecoder();
  return [...(await unzipBytes(blob)).entries()]
    .filter(([name]) => name.endsWith(".xml"))
    .map(([, bytes]) => dec.decode(bytes))
    .join("\n");
}

describe("resolveDataSection — budgetForecast (§545)", () => {
  it("resolves the derived section from the extras", () => {
    const section = resolveDataSection("budgetForecast", ws, LANG, extras());
    expect(section?.key).toBe("budgetForecast");
    expect(section?.title).toBe(TITLE);
    expect(section?.rows.map((r) => r[0])).toContain(BAC);
  });

  it("renders nothing without a forecast", () => {
    expect(resolveDataSection("budgetForecast", ws, LANG)).toBeNull();
    expect(resolveDataSection("budgetForecast", ws, LANG, { budgetForecast: null })).toBeNull();
  });
});

describe("the three document renderers embed the forecast (§545)", () => {
  it("HTML", () => {
    const withIt = renderDocumentHtml(doc, ws, LANG, "preview", undefined, undefined, extras());
    expect(withIt).toContain(`<h2>${TITLE}</h2>`);
    expect(withIt).toContain(BAC);
    const without = renderDocumentHtml(doc, ws, LANG, "preview");
    expect(without).toContain("Control heading");
    expect(without).not.toContain(BAC);
  });

  it("Word", async () => {
    expect(await packageText(renderDocumentDocx(doc, ws, LANG, undefined, extras()))).toContain(BAC);
    const without = await packageText(renderDocumentDocx(doc, ws, LANG));
    expect(without).toContain("Control heading");
    expect(without).not.toContain(BAC);
  });

  it("PowerPoint", async () => {
    expect(await packageText(renderDocumentPptx(doc, ws, LANG, undefined, undefined, extras()))).toContain(BAC);
    const without = await packageText(renderDocumentPptx(doc, ws, LANG));
    expect(without).toContain("Control heading");
    expect(without).not.toContain(BAC);
  });
});

describe("ExportExtrasProvider (§545)", () => {
  const wrap = (forecast: ReturnType<typeof forecastBundleFixture> | null) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return <ExportExtrasProvider forecast={forecast}>{children}</ExportExtrasProvider>;
    };

  it("carries the forecast, and nothing without one or without a provider", () => {
    const forecast = forecastBundleFixture();
    expect(renderHook(useExportExtras, { wrapper: wrap(forecast) }).result.current).toEqual({ budgetForecast: forecast });
    expect(renderHook(useExportExtras, { wrapper: wrap(null) }).result.current).toEqual({});
    expect(renderHook(useExportExtras).result.current).toEqual({});
  });

  it("feeds the in-app preview", () => {
    const { container, unmount } = render(
      <ExportExtrasProvider forecast={forecastBundleFixture()}>
        <DocumentPreview lang={LANG} doc={doc} ws={ws} />
      </ExportExtrasProvider>,
    );
    expect(container.textContent).toContain(BAC);
    unmount();
    const bare = render(<DocumentPreview lang={LANG} doc={doc} ws={ws} />);
    expect(bare.container.textContent).toContain("Control heading");
    expect(bare.container.textContent).not.toContain(BAC);
  });

  it("feeds a history row's preview", async () => {
    const user = userEvent.setup();
    const version: DocVersion = {
      id: 40, documentId: 1, title: "Steering pack", blocks: [CONTROL, FORECAST],
      savedAt: "2026-10-01T09:00:00.000Z", source: "user", op: "update",
    };
    render(
      <ExportExtrasProvider forecast={forecastBundleFixture()}>
        <DocumentsHistoryModal open doc={doc} versions={[version]} onClose={vi.fn()} onRestore={vi.fn()} lang={LANG} ws={ws} />
      </ExportExtrasProvider>,
    );
    await user.click(screen.getByRole("button", { name: /Preview/ }));
    const panel = document.getElementById("documents-history-preview-40");
    expect(panel?.textContent).toContain("Control heading");
    expect(panel?.textContent).toContain(BAC);
  });
});
