// open-followups §790 — the refusal in front of a conversion into Turso, without the hook around it.
// What the check answers is pinned on a real engine (turso-holds-projects.execute.test.ts); what the
// switch does with the answer is pinned at the hook (use-storage-backend.test.tsx). This file pins
// what the user is TOLD, which depends on the answer, the failure and the portfolio flag.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadI18n, t } from "./i18n";
import { StorageNotReadyError } from "./storage";
import type { TursoConfig } from "./turso-config";

vi.mock("./turso-holds-projects", () => ({ tursoDatabaseHoldsProjects: vi.fn() }));
import { tursoDatabaseHoldsProjects } from "./turso-holds-projects";
import { refuseConversionIntoProjects } from "./storage-convert-guard";

const config = { httpUrl: "https://x.turso.io", authToken: "tok" } as unknown as TursoConfig;
const holds = vi.mocked(tursoDatabaseHoldsProjects);

function run(portfolioMode: "file" | "turso", lang: "en-US" | "de" = "en-US") {
  const emitToast = vi.fn<(kind: "info" | "error" | "success", text: string) => void>();
  const refused = refuseConversionIntoProjects(config, "before-confirm", { lang, emitToast, portfolioMode });
  return { refused, emitToast };
}

describe("refuseConversionIntoProjects (open-followups §790)", () => {
  beforeAll(async () => { await loadI18n("de"); });
  afterEach(() => { holds.mockReset(); });

  it("lets the conversion go ahead, silently, when the database holds no project", async () => {
    holds.mockResolvedValue(false);
    const { refused, emitToast } = run("file");
    expect(await refused).toBe(false);
    expect(emitToast).not.toHaveBeenCalled();
  });

  it("refuses and names the Settings route when the portfolio is on File", async () => {
    holds.mockResolvedValue(true);
    const { refused, emitToast } = run("file");
    expect(await refused).toBe(true);
    expect(emitToast).toHaveBeenCalledWith("error", t("en-US", "storageConvertTursoHoldsProjectsRoute"));
  });

  // ★★ An in-place switch away from Turso leaves the flag on "turso" (§791): Portfolio storage
  // already reads Turso there and offers nothing to click, so the route would lead nowhere.
  it("refuses WITHOUT the Settings route when the portfolio flag is already Turso", async () => {
    holds.mockResolvedValue(true);
    const { refused, emitToast } = run("turso");
    expect(await refused).toBe(true);
    expect(emitToast).toHaveBeenCalledWith("error", t("en-US", "storageConvertTursoHoldsProjects"));
    expect(t("en-US", "storageConvertTursoHoldsProjects")).not.toContain("Portfolio storage");
  });

  it("says so in German too, with the German labels", async () => {
    holds.mockResolvedValue(true);
    const { refused, emitToast } = run("file", "de");
    expect(await refused).toBe(true);
    expect(emitToast.mock.calls[0][1]).toContain("Portfolio-Speicher");
    expect(emitToast.mock.calls[0][1]).toContain("Einstellungen → Integrationen");
  });

  it("refuses when the check fails, naming the failure in words and never the raw error", async () => {
    holds.mockRejectedValue(new StorageNotReadyError("storage-unreachable"));
    const { refused, emitToast } = run("file");
    expect(await refused).toBe(true);
    expect(emitToast).toHaveBeenCalledWith("error",
      t("en-US", "storageConvertTursoProbeFailed", t("en-US", "integrationsTursoTestUnreachable")));
    expect(JSON.stringify(emitToast.mock.calls)).not.toContain("storage-unreachable");
  });

  it("gives the generic sentence for an unrecognised failure, never its message", async () => {
    holds.mockRejectedValue(new Error("https://secret-db.turso.io said no"));
    const { refused, emitToast } = run("turso");
    expect(await refused).toBe(true);
    expect(emitToast).toHaveBeenCalledWith("error",
      t("en-US", "storageConvertTursoProbeFailed", t("en-US", "integrationsTursoTestFailGeneric")));
    expect(JSON.stringify(emitToast.mock.calls)).not.toContain("secret-db");
  });
});
