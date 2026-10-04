// src/app/activity-audit-download.ts — wires the internal activity-log download (open-followups §510)
// to its two sources and to the browser download. The payload itself is built by activity-audit.ts.

import { activityAuditFileName, buildActivityAudit, type ActivityAuditScope, type ActivityAuditSource } from "./activity-audit";
import { downloadJson } from "./download-json";
import { readPortfolioActivityLogs } from "./turso-portfolio";
import type { TursoConfig } from "./turso-config";
import { APP_VERSION } from "./version";

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
      const sources = portfolioConfig !== null ? await readPortfolioActivityLogs(portfolioConfig) : [current];
      const now = new Date();
      return downloadJson(activityAuditFileName(now), JSON.stringify(buildActivityAudit(scope, sources, now, APP_VERSION), null, 2));
    },
  };
}
