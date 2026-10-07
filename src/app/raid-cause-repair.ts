// The one diagnostics line for a broken RAID cause loop (§674), shared by the
// `setRaid` guard (workspace-context.tsx), the AI create and update tools
// (use-register-tools.ts), the load paths (use-storage-backend.ts,
// use-storage-file-ops.ts) and the version restore (use-version-history.ts),
// so a loop removed on load is reported the same way as one refused on a write.
// ★ The AI tools log from the tool body, outside a React updater, so the
// setter's StrictMode dedupe does not cover them. Nothing re-runs a tool body
// today; a dispatcher that ever did would log a refusal twice.
//
// ★★ Whoever breaks a loop BEFORE calling `setRaid` must log it here: the
// setter then finds nothing to drop and logs nothing. That is every caller of
// `guardRaidWrite` and `repairLoadedRaid` below.
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

/** A written RAID array with any link that closes a loop against `prior`
 *  refused and logged as a write. For a writer that needs the stored result
 *  before `setRaid` runs, such as an AI tool reporting back in the same turn. */
export function guardRaidWrite(next: readonly RaidItem[], prior: readonly RaidItem[]): readonly RaidItem[] {
  const { items, dropped } = breakCauseCycles(next, prior);
  logCauseCycleBreak(dropped, "write");
  return items;
}

/** A loaded RAID array with any cause loop removed and logged. Same array when there was none. */
export function repairLoadedRaid(raid: readonly RaidItem[]): readonly RaidItem[] {
  const { items, dropped } = breakCauseCycles(raid);
  logCauseCycleBreak(dropped, "load");
  return items;
}
