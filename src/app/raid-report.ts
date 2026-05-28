// src/app/raid-report.ts
//
// Pure compute for the RAID Report popout. Mirrors the resource-report.ts
// shape: input = items + today; output = tiles + group rows + topOpen +
// fullDetail. Presentation layer maps the UNASSIGNED_OWNER sentinel to the
// i18n string.

import {
  RAID_CATEGORIES,
  RAID_SEVERITIES,
  type RaidCategory,
  type RaidItem,
  type RaidSeverity,
  type RaidStatus,
} from "./types";

export const UNASSIGNED_OWNER = "__unassigned__";

const TERMINAL_STATUSES_BY_CATEGORY: Record<RaidCategory, ReadonlySet<RaidStatus>> = {
  R: new Set(["Closed", "Mitigated", "Realized"]),
  A: new Set(["Validated", "Invalidated"]),
  I: new Set(["Resolved", "Closed"]),
  D: new Set(["Delivered", "Closed"]),
};

const SEVERITY_RANK: Record<RaidSeverity | "Unrated", number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
  Unrated: 0,
};

export type RaidTiles = {
  openR: number;
  openA: number;
  openI: number;
  openD: number;
};

export type RaidSeverityRow = {
  severity: RaidSeverity | "Unrated";
  risks: number;
  assumptions: number;
  issues: number;
  dependencies: number;
  total: number;
};

export type RaidStatusRow = {
  status: RaidStatus;
  count: number;
};

export type RaidOwnerRow = {
  owner: string;
  openR: number;
  openA: number;
  openI: number;
  openD: number;
  total: number;
};

export type RaidCategoryRow = {
  category: RaidCategory;
  open: number;
  closed: number;
  overdue: number;
};

export type RaidAgingRow = {
  bucket: "le30" | "31_60" | "61_90" | "gt90";
  open: number;
};

export type RaidTopRow = {
  id: number;
  category: RaidCategory;
  title: string;
  severity?: RaidSeverity;
  owner: string;
  ageDays: number;
  status: RaidStatus;
  targetDate?: string;
  overdue: boolean;
};

export type RaidDetailRow = {
  id: number;
  category: RaidCategory;
  title: string;
  severity?: RaidSeverity;
  status: RaidStatus;
  owner: string;
  raisedDate: string;
  targetDate?: string;
  closedDate?: string;
  ageDays: number;
  linkedTaskCount: number;
  overdue: boolean;
};

export type RaidReport = {
  tiles: RaidTiles;
  bySeverity: RaidSeverityRow[];
  byStatus: RaidStatusRow[];
  byOwner: RaidOwnerRow[];
  byCategory: RaidCategoryRow[];
  byAging: RaidAgingRow[];
  topOpen: RaidTopRow[];
  fullDetail: RaidDetailRow[];
};

function isOpen(it: RaidItem): boolean {
  return !TERMINAL_STATUSES_BY_CATEGORY[it.category].has(it.status);
}

function normalizeOwner(raw: string | undefined): string {
  const t = (raw ?? "").trim();
  return t === "" ? UNASSIGNED_OWNER : t;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + "T00:00:00Z").getTime();
  const b = new Date(toIso + "T00:00:00Z").getTime();
  return Math.max(0, Math.round((b - a) / (24 * 60 * 60 * 1000)));
}

function categoryRank(c: RaidCategory): number {
  return RAID_CATEGORIES.indexOf(c);
}

export function computeRaidReport(
  items: readonly RaidItem[],
  today: string,
): RaidReport {
  const tiles: RaidTiles = { openR: 0, openA: 0, openI: 0, openD: 0 };
  const sevMap = new Map<RaidSeverity | "Unrated", RaidSeverityRow>();
  const statusCount = new Map<RaidStatus, number>();
  const ownerMap = new Map<string, RaidOwnerRow>();
  const catMap = new Map<RaidCategory, RaidCategoryRow>();
  for (const c of RAID_CATEGORIES) {
    catMap.set(c, { category: c, open: 0, closed: 0, overdue: 0 });
  }
  const aging: RaidAgingRow[] = [
    { bucket: "le30", open: 0 },
    { bucket: "31_60", open: 0 },
    { bucket: "61_90", open: 0 },
    { bucket: "gt90", open: 0 },
  ];
  const topCandidates: RaidTopRow[] = [];
  const fullDetail: RaidDetailRow[] = [];

  let anyUnrated = false;

  for (const it of items) {
    const open = isOpen(it);
    const overdue = open && !!it.targetDate && it.targetDate < today;
    const ageDays = daysBetween(it.raisedDate, today);
    const owner = normalizeOwner(it.owner);

    if (open) {
      if (it.category === "R") tiles.openR++;
      else if (it.category === "A") tiles.openA++;
      else if (it.category === "I") tiles.openI++;
      else if (it.category === "D") tiles.openD++;
    }
    const cRow = catMap.get(it.category)!;
    if (open) cRow.open++;
    else cRow.closed++;
    if (overdue) cRow.overdue++;

    const sevKey: RaidSeverity | "Unrated" = it.severity ?? "Unrated";
    if (!it.severity) anyUnrated = true;
    let sevRow = sevMap.get(sevKey);
    if (!sevRow) {
      sevRow = { severity: sevKey, risks: 0, assumptions: 0, issues: 0, dependencies: 0, total: 0 };
      sevMap.set(sevKey, sevRow);
    }
    if (it.category === "R") sevRow.risks++;
    else if (it.category === "A") sevRow.assumptions++;
    else if (it.category === "I") sevRow.issues++;
    else if (it.category === "D") sevRow.dependencies++;
    sevRow.total++;

    if (open) {
      statusCount.set(it.status, (statusCount.get(it.status) ?? 0) + 1);
    }

    if (open) {
      let oRow = ownerMap.get(owner);
      if (!oRow) {
        oRow = { owner, openR: 0, openA: 0, openI: 0, openD: 0, total: 0 };
        ownerMap.set(owner, oRow);
      }
      if (it.category === "R") oRow.openR++;
      else if (it.category === "A") oRow.openA++;
      else if (it.category === "I") oRow.openI++;
      else if (it.category === "D") oRow.openD++;
      oRow.total++;
    }

    if (open) {
      const b: RaidAgingRow["bucket"] =
        ageDays <= 30 ? "le30" :
        ageDays <= 60 ? "31_60" :
        ageDays <= 90 ? "61_90" : "gt90";
      aging.find((row) => row.bucket === b)!.open++;
    }

    if (open) {
      topCandidates.push({
        id: it.id,
        category: it.category,
        title: it.title,
        severity: it.severity,
        owner,
        ageDays,
        status: it.status,
        targetDate: it.targetDate,
        overdue,
      });
    }

    fullDetail.push({
      id: it.id,
      category: it.category,
      title: it.title,
      severity: it.severity,
      status: it.status,
      owner,
      raisedDate: it.raisedDate,
      targetDate: it.targetDate,
      closedDate: it.closedDate,
      ageDays,
      linkedTaskCount: it.linkedTaskIds.length,
      overdue,
    });
  }

  const bySeverity: RaidSeverityRow[] = [];
  for (const sev of RAID_SEVERITIES) {
    const row = sevMap.get(sev);
    if (row) bySeverity.push(row);
  }
  if (anyUnrated) {
    const row = sevMap.get("Unrated");
    if (row) bySeverity.push(row);
  }

  const byStatus: RaidStatusRow[] = Array.from(statusCount.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  const byOwner: RaidOwnerRow[] = Array.from(ownerMap.values())
    .sort((a, b) => b.total - a.total || a.owner.localeCompare(b.owner));

  const byCategory: RaidCategoryRow[] = RAID_CATEGORIES.map((c) => catMap.get(c)!);

  const topOpen = topCandidates
    .sort((a, b) => {
      const sa = SEVERITY_RANK[a.severity ?? "Unrated"];
      const sb = SEVERITY_RANK[b.severity ?? "Unrated"];
      if (sa !== sb) return sb - sa;
      if (a.ageDays !== b.ageDays) return b.ageDays - a.ageDays;
      return a.id - b.id;
    })
    .slice(0, 10);

  fullDetail.sort((a, b) => {
    const c = categoryRank(a.category) - categoryRank(b.category);
    return c !== 0 ? c : a.id - b.id;
  });

  return { tiles, bySeverity, byStatus, byOwner, byCategory, byAging: aging, topOpen, fullDetail };
}
