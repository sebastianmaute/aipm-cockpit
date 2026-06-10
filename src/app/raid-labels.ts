// Translated display labels for RAID category / severity / status values.
// Shared by raid-panel.tsx and raid-edit-modal.tsx; kept in its own module so
// the panel and the modal don't import each other (no value-import cycle).
// Not in raid.ts: that module is pure domain logic and stays i18n-free.

import { type Lang, t, type TranslationKey } from "./i18n";
import type { RaidCategory, RaidSeverity, RaidStatus } from "./types";

export function categoryLabel(c: RaidCategory, lang: Lang): string {
  return t(
    lang,
    c === "R"
      ? "raidCategoryR"
      : c === "A"
        ? "raidCategoryA"
        : c === "I"
          ? "raidCategoryI"
          : "raidCategoryD",
  );
}

export function severityLabel(s: RaidSeverity, lang: Lang): string {
  switch (s) {
    case "Low":
      return t(lang, "raidSeverityLow");
    case "Medium":
      return t(lang, "raidSeverityMedium");
    case "High":
      return t(lang, "raidSeverityHigh");
    case "Critical":
      return t(lang, "raidSeverityCritical");
  }
}

const STATUS_KEY: Record<RaidStatus, TranslationKey> = {
  Open: "raidStatusOpen",
  Mitigated: "raidStatusMitigated",
  Realized: "raidStatusRealized",
  Closed: "raidStatusClosed",
  Pending: "raidStatusPending",
  Validated: "raidStatusValidated",
  Invalidated: "raidStatusInvalidated",
  "In Progress": "raidStatusInProgress",
  Resolved: "raidStatusResolved",
  Delivered: "raidStatusDelivered",
  Blocked: "raidStatusBlocked",
};

export function statusLabel(s: RaidStatus, lang: Lang): string {
  return t(lang, STATUS_KEY[s]);
}
