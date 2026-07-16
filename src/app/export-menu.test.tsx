import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ExportMenu } from "./export-menu";
import { ToastProvider } from "./toast-context";
import { readDiagLog, clearDiagLog } from "./diagnostics";
import { exportWorkspace } from "./export";
import type { ResourcePlan } from "./types";

// exportWorkspace is async and can throw (e.g. a dynamic export-ooxml chunk
// load failure). The menu's `void exportWorkspace(...)` must not swallow that
// silently — a `.catch` should log + toast via reportSilentFailure.
vi.mock("./export", () => ({
  exportWorkspace: vi.fn(),
}));

// Source-assertion guard (mirrors the table-head-sweep idiom): the export
// dropdown must stack above the Gantt sticky date row (z-20) and its frozen
// left column (z-30), so it uses z-40.
const src = readFileSync(
  join(process.cwd(), "src", "app", "export-menu.tsx"),
  "utf8",
);

describe("export menu stacking", () => {
  it("renders its dropdown above the gantt sticky header (z-40, not z-20)", () => {
    expect(src).toContain("top-full z-40 mt-2 w-72");
    expect(src).not.toContain("top-full z-20 mt-2 w-72");
  });
});

const PLAN: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };

function renderMenu(showToastSpy: (kind: "info" | "error" | "success", text: string) => void) {
  return render(
    <ToastProvider value={{ showToast: showToastSpy, showToastAction: showToastSpy }}>
      <ExportMenu
        lang="en-US"
        tasks={[]}
        raid={[]}
        absences={[]}
        shifts={[]}
        resources={[]}
        roles={[]}
        disciplines={[]}
        grades={[]}
        plan={PLAN}
        budgets={[]}
        fxRates={null}
      />
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
