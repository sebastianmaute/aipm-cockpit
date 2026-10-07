// The one diagnostics line for a broken RAID cause loop (§674), shared by the
// `setRaid` guard (workspace-context.tsx) and the load paths, so a loop
// removed on load is reported the same way as one refused on a write.
//
// ★★ A load has no before-image, so `repairLoadedRaid` breaks a loop by
// ascending item id; a write refuses its own new link instead (see
// `breakCauseCycles`). Repair BEFORE the array is marked as loaded or handed to
// the setter: the setter then finds nothing to drop, which is why the load
// must log here, not rely on the setter's log.
import { logDiag } from "./diagnostics";
import { breakCauseCycles, type CauseCycleBreak } from "./raid";
import type { RaidItem } from "./types";

export const CAUSE_CYCLE_DIAG_CODE = "raid.causeCycleBroken";

/** `logDiag` keeps scalar fields only, so the links travel as one string. */
export function formatCauseLinks(dropped: CauseCycleBreak["dropped"]): string {
  return dropped.map((d) => `${d.childId} caused by ${d.parentId}`).join(", ");
}

/** Logs the dropped links, if any. `on` says whether a write was refused or a load repaired. */
export function logCauseCycleBreak(dropped: CauseCycleBreak["dropped"], on: "write" | "load"): void {
  if (dropped.length === 0) return;
  logDiag("warn", CAUSE_CYCLE_DIAG_CODE, { count: dropped.length, links: formatCauseLinks(dropped), on });
}

/** A loaded RAID array with any cause loop removed and logged. Same array when there was none. */
export function repairLoadedRaid(raid: readonly RaidItem[]): readonly RaidItem[] {
  const { items, dropped } = breakCauseCycles(raid);
  logCauseCycleBreak(dropped, "load");
  return items;
}
