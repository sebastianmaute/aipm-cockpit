// open-followups §790 — the refusal in front of a conversion INTO Turso (Settings → Storage).
//
// ★★★ The conversion's target is a SINGLE-project TursoBackend, whose forced rewrite sends an
// unscoped `DELETE FROM` every workspace table; in a database holding projects that deletes them
// all. So `onRequestStorageSwitch` (use-storage-file-ops.ts) asks this before its confirm and again
// after it, and stops when it answers true. What "holds projects" means, and why a malformed answer
// counts as unread, is in turso-holds-projects.ts.
//
// ★★ The refusal's wording depends on the portfolio flag. On File, the way to those projects is
// Settings → Integrations → Portfolio storage. When the flag already says Turso — what an in-place
// switch away from Turso leaves behind (§791) — that control already reads Turso and offers nothing
// to click, so the text names no route rather than one that leads nowhere.
import { logDiag } from "./diagnostics";
import type { Lang } from "./i18n";
import { t } from "./i18n";
import type { PortfolioMode } from "./portfolio-mode";
import { TURSO_TEST_FAIL_KEYS, tursoErrorKind } from "./storage-error";
import type { TursoConfig } from "./turso-config";
import { tursoDatabaseHoldsProjects } from "./turso-holds-projects";

export type ConvertCheckStage = "before-confirm" | "after-confirm";

export interface ConvertGuardDeps {
  lang: Lang;
  emitToast: (kind: "info" | "error" | "success", text: string) => void;
  portfolioMode: PortfolioMode;
}

/** True when the conversion must stop (the user has been told why); false when it may go on. */
export async function refuseConversionIntoProjects(
  config: TursoConfig,
  stage: ConvertCheckStage,
  deps: ConvertGuardDeps,
): Promise<boolean> {
  let held: boolean;
  try {
    held = await tursoDatabaseHoldsProjects(config);
  } catch (err) {
    // An unreadable database is not an empty one. The failure is named by its kind in a translated
    // sentence, never by the raw message: that may be an internal code or carry the database URL.
    logDiag("warn", "storage.convertRefused", { reason: "probe-failed", stage });
    const why = t(deps.lang, TURSO_TEST_FAIL_KEYS[tursoErrorKind(err) ?? "generic"]);
    deps.emitToast("error", t(deps.lang, "storageConvertTursoProbeFailed", why));
    return true;
  }
  if (!held) return false;
  logDiag("warn", "storage.convertRefused", { reason: "turso-holds-projects", stage });
  const key = deps.portfolioMode === "turso" ? "storageConvertTursoHoldsProjects" : "storageConvertTursoHoldsProjectsRoute";
  deps.emitToast("error", t(deps.lang, key));
  return true;
}
