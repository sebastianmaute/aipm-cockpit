// Pure, i18n-free. Decides create-vs-update for an entity save so a create can
// never silently overwrite (clobber) a row committed since the modal opened.
//
// THE RACE: every register panel mints the new row's id at modal-OPEN
// (`nextId(list)`). Between open and save a concurrent writer — the AI
// `create_*` tool, another browser tab, a bulk op — can commit that same id.
// The save handlers decide create-vs-update by id-existence
// (`findIndex(id) < 0 ? append : replace`), so the create now finds the id and
// takes the REPLACE branch, clobbering the concurrent row. (Resources already
// fixed this in `use-resource-planner.ts`; this is the shared core of that fix.)
//
// THE FIX: decide by the KNOWN modal intent (`isNew`), not id-existence, and
// for a create RE-MINT the id when the open-time id was taken since — so the
// append lands on a fresh unique id instead of colliding. Non-modal callers
// (bulk edit, edit-from-anywhere) pass `isNew: undefined` and fall back to
// id-existence, preserving their prior behavior.
export function resolveEntitySave<T extends { id: number }>(
  existing: readonly T[],
  itemId: number,
  isNew: boolean | undefined,
  mintId: () => number,
): { create: boolean; id: number } {
  const taken = existing.some((e) => e.id === itemId);
  const create = isNew ?? !taken;
  if (!create) return { create: false, id: itemId };
  return { create: true, id: taken ? mintId() : itemId };
}
