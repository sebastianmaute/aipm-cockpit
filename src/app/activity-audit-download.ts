// src/app/activity-audit-download.ts — wires the internal activity-log download (open-followups §510)
// to its two sources and to the browser download. The payload itself is built by activity-audit.ts.

import { activityAuditFileName, buildActivityAudit, type ActivityAuditScope, type ActivityAuditSource } from "./activity-audit";
import { downloadJson } from "./download-json";
import { readPortfolioActivityLogs } from "./turso-portfolio";
import type { TursoConfig } from "./turso-config";
import { APP_VERSION } from "./version";

/** task-manager's id for "no project open" (`portfolioCurrentId ?? "default"`). */
const NO_PROJECT_ID = "default";

export interface ActivityAuditDownloader {
  /** Known BEFORE the download, so the Settings control can say what the file will cover. */
  scope: ActivityAuditScope;
  /** False when the browser refused the download; rejects when the portfolio read fails. */
  download: () => Promise<boolean>;
}

/** `portfolioConfig` is the multi-project Turso database's config, or null for any other storage
 *  (file, IndexedDB, single-project Turso), where only the project open now can be covered. ONE value
 *  decides both the announced scope and what is read, so the two cannot disagree. */
export function activityAuditDownloader(portfolioConfig: TursoConfig | null, current: ActivityAuditSource): ActivityAuditDownloader {
  const scope: ActivityAuditScope = portfolioConfig !== null ? "portfolio" : "current";
  return {
    scope,
    download: async () => {
      // The project open now contributes its LIVE log on both scopes: the stored one can lag the newest
      // entries until the next save, and an auditor reading the file would miss them. Its stored-log
      // flags stay (the live log began from that stored one). Not yet in the projects table (never
      // saved there): it is added, not left out — unless no portfolio project is open at all, where
      // task-manager's id is the "default" sentinel and there is no project to add.
      const stored = portfolioConfig !== null ? await readPortfolioActivityLogs(portfolioConfig) : null;
      const sources = stored === null
        ? [current]
        : stored.some((s) => s.id === current.id)
          ? stored.map((s) => (s.id === current.id ? { ...s, log: current.log } : s))
          : current.id === NO_PROJECT_ID ? stored : [...stored, current];
      const now = new Date();
      return downloadJson(activityAuditFileName(now), JSON.stringify(buildActivityAudit(scope, sources, now, APP_VERSION), null, 2));
    },
  };
}
