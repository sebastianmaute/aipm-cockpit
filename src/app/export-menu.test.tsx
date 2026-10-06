import React from "react";
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExportMenu } from "./export-menu";
import { ToastProvider } from "./toast-context";
import { readDiagLog, clearDiagLog } from "./diagnostics";
import { exportWorkspace } from "./export";
import { emptyWorkspace } from "./workspace";
import type { ResourcePlan } from "./types";
import type { ForecastBundle } from "./budget-forecast-bundle";
import type { ExportExtras } from "./export-forecast-section";
import { loadI18n, t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

// exportWorkspace is async and can throw (e.g. a dynamic export-ooxml chunk
// load failure). The menu's `void exportWorkspace(...)` must not swallow that
// silently — a `.catch` should log + toast via reportSilentFailure.
vi.mock("./export", () => ({
  exportWorkspace: vi.fn(),
}));

// Source-assertion guard (mirrors the table-head-sweep idiom): the export
// dropdown must stack above the Gantt sticky date row (z-20) and its frozen
// left column (z-30). It now renders via the shared `PopoverPanel`, which
// portals to document.body at z-[100] — above any in-flow sticky header — so
// the guard just pins the portal primitive + forbids a regression to a low z.
const src = readFileSync(
  join(process.cwd(), "src", "app", "export-menu.tsx"),
  "utf8",
);

describe("export menu stacking", () => {
  it("renders its dropdown via the PopoverPanel portal (above sticky headers)", () => {
    expect(src).toContain("PopoverPanel");
    expect(src).not.toContain("top-full z-20");
    expect(src).not.toContain("top-full z-40");
  });
});

const PLAN: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const WS = { ...emptyWorkspace(), plan: PLAN };

function renderMenu(showToastSpy: (kind: "info" | "error" | "success", text: string) => void) {
  return render(
    <ToastProvider value={{ showToast: showToastSpy, showToastAction: showToastSpy }}>
      <ExportMenu lang="en-US" workspace={WS} />
    </ToastProvider>,
  );
}

describe("export menu — silent failure guard", () => {
  const showToastSpy = vi.fn();

  beforeEach(() => {
    clearDiagLog();
    showToastSpy.mockClear();
    vi.mocked(exportWorkspace).mockReset();
  });

  it("logs + toasts when exportWorkspace rejects (e.g. a chunk-load failure), instead of silently dropping the download", async () => {
    vi.mocked(exportWorkspace).mockRejectedValueOnce(new Error("chunk load failed"));
    renderMenu(showToastSpy);

    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByText("CSV"));

    await waitFor(() => {
      expect(readDiagLog().some((ev) => ev.code === "export.failed")).toBe(true);
    });
    expect(showToastSpy).toHaveBeenCalledWith("error", expect.any(String));
  });
});

describe("export menu — footer", () => {
  beforeEach(() => vi.mocked(exportWorkspace).mockReset().mockResolvedValue(undefined));

  it("hands the configured footer to exportWorkspace", async () => {
    render(
      <ToastProvider value={{ showToast: vi.fn(), showToastAction: vi.fn() }}>
        <ExportMenu lang="en-US" workspace={WS} exportFooter="Acme GmbH" />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByText("CSV"));
    await waitFor(() => expect(exportWorkspace).toHaveBeenCalled());
    expect(vi.mocked(exportWorkspace).mock.calls[0][4]).toBe("Acme GmbH");
    // The menu must export the workspace it was handed, not rebuild one.
    expect(vi.mocked(exportWorkspace).mock.calls[0][0]).toBe(WS);
  });

  // §545 — the derived Budget forecast section needs the dashboard model's
  // bundle, which only the caller has.
  it("hands the budget forecast to exportWorkspace as an extra, and null when none was given", async () => {
    const forecast = { marker: "bundle" } as unknown as ForecastBundle;
    const { unmount } = render(
      <ToastProvider value={{ showToast: vi.fn(), showToastAction: vi.fn() }}>
        <ExportMenu lang="en-US" workspace={WS} exportForecast={forecast} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByText("CSV"));
    await waitFor(() => expect(exportWorkspace).toHaveBeenCalledTimes(1));
    const extras: ExportExtras | undefined = vi.mocked(exportWorkspace).mock.calls[0][5];
    expect(extras?.budgetForecast).toBe(forecast);
    unmount();

    render(
      <ToastProvider value={{ showToast: vi.fn(), showToastAction: vi.fn() }}>
        <ExportMenu lang="en-US" workspace={WS} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    fireEvent.click(screen.getByText("CSV"));
    await waitFor(() => expect(exportWorkspace).toHaveBeenCalledTimes(2));
    const noForecast: ExportExtras | undefined = vi.mocked(exportWorkspace).mock.calls[1][5];
    expect(noForecast?.budgetForecast).toBeNull();
  });
});

describe("export menu — every format button has its own name (§245)", () => {
  beforeAll(() => loadI18n("de"));

  // Each format button is named by its visible label and hint, so two formats worded alike would
  // sound identical.
  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  it("renders real German for the de case", () => {
    expect(t("de", "exportTitle")).not.toBe(t("en-US", "exportTitle"));
  });

  it.each(["en-US", "de"] as const)("names every format option distinctly in %s", (lang) => {
    render(
      <ToastProvider value={{ showToast: vi.fn(), showToastAction: vi.fn() }}>
        <ExportMenu lang={lang} workspace={WS} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: t(lang, "exportTitle") }));
    expectRowUniqueNames({ minControls: 6, scope: screen.getByRole("dialog") });
  });
});
