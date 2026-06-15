import type { RaidItem } from "./types";

/** Pure: set owner/ownerEmail/ownerResourceId on the RAID item with `id`.
 *  Returns the SAME array reference (no write) when no item matches `id`. */
export function applyOwnerAssignment(
  raid: readonly RaidItem[],
  id: number,
  value: { name: string; email: string; resourceId: number | null },
): readonly RaidItem[] {
  if (!raid.some((r) => r.id === id)) return raid;
  return raid.map((r) =>
    r.id === id
      ? { ...r, owner: value.name || undefined, ownerEmail: value.email || undefined, ownerResourceId: value.resourceId }
      : r,
  );
}
