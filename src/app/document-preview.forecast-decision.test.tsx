// §502 part 4, spec §3.3 — a document PREVIEW never runs a lever search on the render path. A download asks the
// synchronous source (`whatItTakesSync`); the preview shows "Working it out…" and fills each take from its own
// background search (`useLeverSearch`). The engine here is the real one; `whatItTakesSync` is only spied on.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { DocumentPreview } from "./document-preview";
import type { ExportExtras } from "./export-forecast-section";
import { useLeverSearch } from "./use-lever-search";
import { usePreviewExportExtras } from "./use-preview-export-extras";
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
// Call-through spy: the search runs for real; the spy records what each preview asks it for, and what it answers.
vi.mock("./use-lever-search", async (importOriginal) => {
  const real = await importOriginal<typeof import("./use-lever-search")>();
  return { ...real, useLeverSearch: vi.fn(real.useLeverSearch) };
});

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
  vi.useRealTimers();
  vi.mocked(whatItTakesSync).mockClear();
  vi.mocked(useLeverSearch).mockClear();
});

const searchArgs = () => vi.mocked(useLeverSearch).mock.calls.map(([a]) => a);

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

  // Task 11b — while the holiday calendar loads the preview shows the export's one loading row, and searches nothing.
  it("shows the calendar-loading row while the holiday calendar loads, with no search", () => {
    const args = (): ForecastDecisionArgs => ({ simulationActive: true, input: null, scenarios: [], settingsOverrides: undefined });
    const loading: ForecastDecisionHandle = {
      source: forecastDecisionSource(args), live: { goal: 80, input: () => null, base: once(() => buildForecastDecisionBase(args())) },
    };
    render(
      <ExportExtrasProvider forecast={null} forecastDecision={loading}>
        <DocumentPreview lang="en-GB" doc={DOC} ws={emptyWorkspace()} />
      </ExportExtrasProvider>,
    );
    expect(screen.getByText(/the holiday calendar is still loading/)).toBeTruthy();
    expect(searchArgs().every((a) => a.input === null && a.targets.length === 0)).toBe(true);
    expect(whatItTakesSync).not.toHaveBeenCalled();
  });

  it("searches nothing for a document without the block", () => {
    const plain: ProjectDocument = { ...DOC, blocks: [{ type: "heading", level: 1, text: "Hi" }] };
    render(
      <ExportExtrasProvider forecast={null} forecastDecision={handle()}>
        <DocumentPreview lang="en-GB" doc={plain} ws={emptyWorkspace()} />
      </ExportExtrasProvider>,
    );
    expect(screen.queryByText(/Below target/)).toBeNull();
    expect(whatItTakesSync).not.toHaveBeenCalled();
    // N2 — the guard that stops every document preview searching: asked, but never enabled and never given targets.
    expect(searchArgs().length).toBeGreaterThan(0);
    expect(searchArgs().every((a) => !a.enabled && a.input === null && a.targets.length === 0)).toBe(true);
  });

  it("keeps the extras' identity across probes that settle nothing new (N1: no whole-document re-render per probe)", async () => {
    vi.useFakeTimers();
    const h = handle();
    const seen: ExportExtras[] = [];
    function Probe() {
      const extras = usePreviewExportExtras(DOC.blocks);
      useEffect(() => { if (seen.at(-1) !== extras) seen.push(extras); });
      return null;
    }
    render(<ExportExtrasProvider forecast={null} forecastDecision={h}><Probe /></ExportExtrasProvider>);
    for (let i = 0; i < 500 && vi.getTimerCount() > 0; i++) await act(async () => { vi.runOnlyPendingTimers(); });
    expect(vi.getTimerCount()).toBe(0);
    // Positive control: the search answered with many distinct maps (one per probe), so identity could have churned.
    const answers = new Set(vi.mocked(useLeverSearch).mock.results.map((r) => r.value));
    const below = h.live.base();
    const rows = below !== null && !below.insufficient ? below.below.length : 0;
    expect(rows).toBeGreaterThan(0);
    expect(answers.size).toBeGreaterThan(rows + 2);
    // Each below-target row settles once: the initial all-pending extras, then one new identity per settled row.
    expect(seen.length).toBeLessThanOrEqual(rows + 1);
    const last = seen.at(-1)!.forecastDecision!();
    expect(last !== null && !last.insufficient && last.below.every((m) => m.take !== "pending")).toBe(true);
  }, SEARCH_TIMEOUT_MS + 5000);
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
    // N2 — a closed row previews nothing, so it searches nothing: asked, never enabled.
    expect(searchArgs().length).toBeGreaterThan(0);
    expect(searchArgs().every((a) => !a.enabled && a.input === null)).toBe(true);
    fireEvent.click(screen.getAllByRole("button", { name: /preview/i })[0]);
    await waitFor(() => expect(screen.getByText(/Below target: Beta/)).toBeTruthy());
    expect(whatItTakesSync).not.toHaveBeenCalled();
    // Positive control: opened, the same observable reads enabled, so the assertion above can tell the two apart.
    expect(searchArgs().some((a) => a.enabled && a.input !== null)).toBe(true);
  });
});
