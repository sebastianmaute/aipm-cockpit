// open-followups §545 — `exportWorkspace` must hand its `ExportExtras` to
// every path that builds sections: the PDF print tab, the popup-blocked HTML
// fallback, and the three OOXML builders. Each path builds its sections
// separately, so dropping `extras` from one exports no forecast from that
// format while every other test stays green.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ooxml = vi.hoisted(() => ({ sections: [] as { key: string }[][] }));
vi.mock("./export-ooxml", () => {
  const capture = (sections: { key: string }[]) => {
    ooxml.sections.push(sections);
    return new Blob(["x"]);
  };
  return { buildDocx: capture, buildXlsx: capture, buildPptx: capture };
});

import { exportWorkspace } from "./export";
import { EXPORT_SECTION_KEYS, type ExportConfig } from "./settings-types";
import { emptyWorkspace } from "./workspace";
import { forecastBundleFixture } from "../test/forecast-bundle-fixture";

const ONLY_FORECAST = Object.fromEntries(EXPORT_SECTION_KEYS.map((k) => [k, k === "budgetForecast"])) as ExportConfig;
const EXTRAS = { budgetForecast: forecastBundleFixture() };

function fakeTab() {
  const state = { html: "" };
  const win = { document: { open: () => { state.html = ""; }, write: (c: string) => { state.html += c; }, close: () => {} } } as unknown as Window;
  return { win, get html() { return state.html; } };
}

describe("exportWorkspace hands the budget forecast to every format (§545)", () => {
  beforeEach(() => {
    ooxml.sections.length = 0;
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Chrome/140");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("PDF: the print tab carries the section", async () => {
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab.win));
    await exportWorkspace(emptyWorkspace(), "pdf", ONLY_FORECAST, "en-US", undefined, EXTRAS);
    expect(tab.html).toContain("Budget forecast");
    expect(tab.html).toContain("EAC at current pace");
  });

  it("PDF: the popup-blocked fallback file carries it too", async () => {
    vi.stubGlobal("open", vi.fn(() => null));
    const blobs: Blob[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((b) => { blobs.push(b as Blob); return "blob:x"; });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await exportWorkspace(emptyWorkspace(), "pdf", ONLY_FORECAST, "en-US", undefined, EXTRAS);
    expect(blobs).toHaveLength(1);
    expect(await blobs[0].text()).toContain("Budget forecast");
  });

  it.each(["docx", "xlsx", "pptx"] as const)("%s: the OOXML builder receives the section", async (format) => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await exportWorkspace(emptyWorkspace(), format, ONLY_FORECAST, "en-US", undefined, EXTRAS);
    expect(ooxml.sections.at(-1)?.map((s) => s.key)).toEqual(["budgetForecast"]);
  });

  it("without extras, no format gets the section", async () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    await exportWorkspace(emptyWorkspace(), "xlsx", ONLY_FORECAST, "en-US");
    expect(ooxml.sections.at(-1)).toEqual([]);
  });
});
