import type { Workspace } from "./workspace";

/**
 * Session-scoped monotonic id minter. Entity ids are never reused WITHIN a
 * session: deleting the current max-id row does not free its id for the next
 * create, because the high-water mark only ever rises.
 *
 * Pure logic except for the single intentional module-level `highWater` Map,
 * which holds the per-kind session state. No `Date`/`Math.random`.
 */

export type MintKind =
  | "task"
  | "raid"
  | "change"
  | "stakeholder"
  | "milestone"
  | "resource"
  | "role"
  | "discipline"
  | "grade"
  | "absence"
  | "shift"
  | "budgetBucket"
  | "calendarEvent"
  | "document"
  | "documentVersion";

/** Minimal shape every mintable entity satisfies. */
type HasId = { id: number };

/** Per-kind highest id handed out (or seeded) this session. */
const highWater = new Map<MintKind, number>();

/** Largest id present in a list, or 0 when empty. */
function maxIdOf(list: readonly HasId[]): number {
  return list.reduce((m, item) => Math.max(m, item.id), 0);
}

/**
 * Mint one fresh id for `kind`. The result is strictly greater than BOTH the
 * list's current max id and every id previously minted/seeded this session, so
 * a deleted max-id row can never have its id reused.
 */
export function mintId(kind: MintKind, list: readonly HasId[]): number {
  const listMax = maxIdOf(list);
  const next = Math.max(highWater.get(kind) ?? 0, listMax) + 1;
  highWater.set(kind, next);
  return next;
}

/**
 * Reserve `count` sequential ids for `kind`, all above the current mark and the
 * list max. Advances the mark to the last reserved id. A non-positive `count`
 * returns `[]` and leaves the session state untouched.
 */
export function mintIds(kind: MintKind, list: readonly HasId[], count: number): number[] {
  if (count <= 0) return [];
  const base = Math.max(highWater.get(kind) ?? 0, maxIdOf(list));
  const ids: number[] = [];
  for (let i = 1; i <= count; i++) {
    ids.push(base + i);
  }
  highWater.set(kind, base + count);
  return ids;
}

/**
 * Peek the id the next `mintId(kind, list)` would return WITHOUT advancing the
 * mark. Display-only (e.g. the "#next id" preview in a create form) — never
 * consume a slot just by rendering.
 */
export function peekMintId(kind: MintKind, list: readonly HasId[]): number {
  return Math.max(highWater.get(kind) ?? 0, maxIdOf(list)) + 1;
}

/**
 * Seed the high-water mark for `kind` from `list`.
 * - `"reset"`: set the mark to the list's max id (0 when empty).
 * - `"raise"`: lift the mark to `max(currentMark, listMax)` — never lowers it.
 */
export function seedMintKind(kind: MintKind, list: readonly HasId[], mode: "reset" | "raise"): void {
  const listMax = maxIdOf(list);
  if (mode === "reset") {
    highWater.set(kind, listMax);
    return;
  }
  highWater.set(kind, Math.max(highWater.get(kind) ?? 0, listMax));
}

/**
 * Collect every budget bucket carrying an `id`. `Workspace.budgets` is a FLAT
 * `BudgetBucket[]` today (the buckets ARE the budget entries), but this also
 * defensively flat-maps a hypothetical nested `.buckets` array so the seed
 * stays correct if the shape ever grows a grouping layer.
 */
function collectBudgetBuckets(budgets: Workspace["budgets"]): readonly HasId[] {
  const out: HasId[] = [];
  for (const entry of budgets ?? []) {
    if (!entry || typeof entry !== "object") continue;
    const nested = (entry as { buckets?: unknown }).buckets;
    if (Array.isArray(nested)) {
      for (const bucket of nested) {
        if (bucket && typeof bucket === "object" && typeof (bucket as HasId).id === "number") {
          out.push({ id: (bucket as HasId).id });
        }
      }
    } else if (typeof (entry as HasId).id === "number") {
      out.push({ id: (entry as HasId).id });
    }
  }
  return out;
}

/**
 * Seed all 12 mint kinds from a workspace (guarding every array with `?? []`),
 * plus `budgetBucket` from the (optionally nested) budget buckets.
 */
export function seedMintFromWorkspace(
  ws: Partial<Workspace>,
  mode: "reset" | "raise",
): void {
  seedMintKind("task", ws.tasks ?? [], mode);
  seedMintKind("raid", ws.raid ?? [], mode);
  seedMintKind("change", ws.changes ?? [], mode);
  seedMintKind("stakeholder", ws.stakeholders ?? [], mode);
  seedMintKind("milestone", ws.milestones ?? [], mode);
  seedMintKind("resource", ws.resources ?? [], mode);
  seedMintKind("role", ws.roles ?? [], mode);
  seedMintKind("discipline", ws.disciplines ?? [], mode);
  seedMintKind("grade", ws.grades ?? [], mode);
  seedMintKind("absence", ws.absences ?? [], mode);
  seedMintKind("shift", ws.shifts ?? [], mode);
  seedMintKind("budgetBucket", collectBudgetBuckets(ws.budgets), mode);
  seedMintKind("calendarEvent", ws.calendarEvents ?? [], mode);
  seedMintKind("document", ws.documents ?? [], mode);
  // "documentVersion" is seeded once `Workspace.documentVersions` exists (Task 3).
}

/**
 * Clear all session high-water state, so the next mint for every kind starts
 * fresh from its list max. Used when BUILDING a brand-new project (its ids
 * should start at #1 regardless of prior session work in another project) —
 * the subsequent `applyWorkspace(ws, "reset")` reseeds from the built data.
 *
 * ★ A new-project build can FAIL after this reset but before applyWorkspace
 * reseeds (e.g. the user cancels the save-file picker, or a Turso save throws),
 * leaving the STILL-ACTIVE old project with wiped marks. Callers that reset for
 * a build MUST `snapshotMintState()` first and `restoreMintState(snap)` in
 * their failure path so the old project's marks survive an aborted create.
 */
export function resetMintState(): void {
  highWater.clear();
}

/** Copy the current per-kind high-water state — restore point for a reset that
 *  may be rolled back (see {@link resetMintState}). */
export function snapshotMintState(): Map<MintKind, number> {
  return new Map(highWater);
}

/** Replace the high-water state with a snapshot (from {@link snapshotMintState}). */
export function restoreMintState(snap: ReadonlyMap<MintKind, number>): void {
  highWater.clear();
  for (const [kind, mark] of snap) highWater.set(kind, mark);
}

/** Test-only alias for {@link resetMintState}. */
export function __resetMintStateForTests(): void {
  resetMintState();
}
