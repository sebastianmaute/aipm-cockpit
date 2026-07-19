// Pure i18n-free helper: group entities that carry a `linkedTaskIds` array into
// a Map keyed by task id. Shared by the RAID and Change registers, which both
// index their items by the tasks they link to (buildRaidByTaskIndex /
// buildChangeByTaskIndex were byte-identical before this extraction).

export function groupByLinkedTaskIds<T extends { linkedTaskIds: readonly number[] }>(
  items: readonly T[],
): Map<number, T[]> {
  const idx = new Map<number, T[]>();
  for (const item of items) {
    for (const tid of item.linkedTaskIds) {
      const list = idx.get(tid);
      if (list) list.push(item);
      else idx.set(tid, [item]);
    }
  }
  return idx;
}
