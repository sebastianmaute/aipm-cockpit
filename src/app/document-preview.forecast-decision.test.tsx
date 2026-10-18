// §502 part 4, spec §3.3 — a document PREVIEW never runs a lever search on the render path. A download asks the
// synchronous source (`whatItTakesSync`); the preview shows "Working it out…" and fills each take from its own
// background search (`useLeverSearch`). The engine here is the real one; `whatItTakesSync` is only spied on.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DocumentPreview } from "./document-preview";
import { DocumentsHistoryModal } from "./documents-history-modal";
import { ExportExtrasProvider } from "./export-extras-context";
import {
  buildForecastDecisionBase, forecastDecisionSource, once, type ForecastDecisionArgs, type ForecastDecisionHandle,
} from "./forecast-decision";
import { whatItTakesSync } from "./forecast-levers";
import type { ProjectDocument } from "./document-model";
import type { DocVersion } from "./document-versions";
import { emptyWorkspace } from "./workspace";
import { decisionInput } from "../test/forecast-decision-fixture";

vi.mock("./forecast-levers", async (importOriginal) => {
  const real = await importOriginal<typeof import("./forecast-levers")>();
  return { ...real, whatItTakesSync: vi.fn(real.whatItTakesSync) };
});
vi.mock("./document-assets-store", () => ({
  loadAssetData: vi.fn(), saveAssetData: vi.fn(), deleteAssetData: vi.fn(), loadAssetDataIds: vi.fn(async () => []),
}));

const NOW = "2026-10-14T00:00:00.000Z";
const DOC: ProjectDocument = {
  id: 1, title: "Steering", createdAt: NOW, updatedAt: NOW, blocks: [{ type: "dataSection", key: "forecastDecision" }],
};
const SEARCH_TIMEOUT_MS = 20000;

function handle(): ForecastDecisionHandle {
  const input = decisionInput();
  const args = (): ForecastDecisionArgs => ({ simulationActive: true, input, scenarios: [], settingsOverrides: undefined });
  return { source: forecastDecisionSource(args), live: { goal: 80, input: () => input, base: once(() => buildForecastDecisionBase(args())) } };
}

afterEach(() => {
  cleanup();
  vi.mocked(whatItTakesSync).mockClear();
});

describe("DocumentPreview — forecastDecision block (§502 part 4)", () => {
  it("renders 'Working it out…' without a synchronous lever search, then the levers once the search settles", async () => {
    render(
      <ExportExtrasProvider forecast={null} forecastDecision={handle()}>
        <DocumentPreview lang="en-GB" doc={DOC} ws={emptyWorkspace()} />
      </ExportExtrasProvider>,
    );
    expect(whatItTakesSync).not.toHaveBeenCalled();
    expect(screen.getByText(/Below target: Beta/)).toBeTruthy();
    expect(screen.getAllByText(/Working it out…/).length).toBeGreaterThan(0);

    await waitFor(() => expect(screen.queryByText(/Working it out…/)).toBeNull(), { timeout: SEARCH_TIMEOUT_MS });
    const beta = screen.getByText(/Below target: Beta/).closest("tr");
    expect(beta?.textContent).toMatch(/to reach 80%|no single lever reaches 80%/);
    expect(whatItTakesSync).not.toHaveBeenCalled();
  }, SEARCH_TIMEOUT_MS + 5000);

  it("searches nothing for a document without the block", () => {
    const plain: ProjectDocument = { ...DOC, blocks: [{ type: "heading", level: 1, text: "Hi" }] };
    render(
      <ExportExtrasProvider forecast={null} forecastDecision={handle()}>
        <DocumentPreview lang="en-GB" doc={plain} ws={emptyWorkspace()} />
      </ExportExtrasProvider>,
    );
    expect(screen.queryByText(/Below target/)).toBeNull();
    expect(whatItTakesSync).not.toHaveBeenCalled();
  });
});

describe("DocumentsHistoryModal — a version's forecastDecision block (§502 part 4)", () => {
  it("previews it, once opened, without a synchronous lever search", async () => {
    const version: DocVersion = { id: 7, documentId: 1, title: "Steering", blocks: DOC.blocks, savedAt: NOW, source: "user", op: "update" };
    render(
      <ExportExtrasProvider forecast={null} forecastDecision={handle()}>
        <DocumentsHistoryModal lang="en-GB" open doc={DOC} versions={[version]} onClose={vi.fn()} onRestore={vi.fn()} ws={emptyWorkspace()} />
      </ExportExtrasProvider>,
    );
    expect(whatItTakesSync).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: /preview/i })[0]);
    await waitFor(() => expect(screen.getByText(/Below target: Beta/)).toBeTruthy());
    expect(whatItTakesSync).not.toHaveBeenCalled();
  });
});
