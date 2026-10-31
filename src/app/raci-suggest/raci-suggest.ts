// Pure, i18n-free engine for "Suggest RACI". No clock, no network, no DOM —
// mirrors alloc-plan/alloc-plan.ts. The model's output is UNTRUSTED and is
// re-grounded against the live stakeholders/milestones before anything can be
// shown or applied.
import { RACI_ROLES, type Milestone, type RaciRole, type Stakeholder } from "../types";

export const MAX_RACI_CELLS = 200;
export {
  buildRaciContext,
  MAX_CONTEXT_STAKEHOLDERS,
  MAX_CONTEXT_MILESTONES,
  RACI_CONTEXT_DESCRIPTION_CHARS,
  MAX_EVIDENCE_LINES,
  MAX_DOC_TITLES_PER_MILESTONE,
  DOC_TITLE_CHARS,
  RACI_REQUEST_MAX_CHARS,
  type RaciContextInput,
} from "./raci-context";

export interface ProposedCell {
  stakeholderId: number;
  milestoneId: number;
  role: RaciRole;
}

export interface GroundedRaciCell extends ProposedCell {
  stakeholderName: string;
  milestoneName: string;
  /** The role stored today, or null when the cell is empty. */
  currentRole: RaciRole | null;
  /** `handover:<milestoneId>` on BOTH cells of an accepted Accountable handover
   *  (the new holder's A and the old holder's demotion); absent otherwise. */
  pairKey?: string;
}

export type SkipReason =
  | "unknown-stakeholder"
  | "unknown-milestone"
  | "invalid-role"
  | "duplicate-accountable"
  /** A new Accountable on a milestone with exactly ONE stored holder, when the
   *  proposal gives that holder no valid non-A role: the A could only be
   *  accepted by minting a second one (§771). */
  | "accountable-needs-demotion";

export interface SkippedRaciCell {
  stakeholderId: number;
  milestoneId: number;
  reason: SkipReason;
}

export function cellKey(c: { stakeholderId: number; milestoneId: number }): string {
  return `${c.stakeholderId}:${c.milestoneId}`;
}

function isRaciRole(v: unknown): v is RaciRole {
  return typeof v === "string" && (RACI_ROLES as readonly string[]).includes(v);
}

/** Validate the model's raw tool input. Never throws; a malformed payload
 *  yields zero cells rather than a crash. */
export function parseRaciProposal(
  raw: unknown,
): { cells: ProposedCell[]; truncated: boolean } {
  const cellsRaw = (raw as { cells?: unknown } | null)?.cells;
  if (!Array.isArray(cellsRaw)) return { cells: [], truncated: false };
  const cells: ProposedCell[] = [];
  for (const entry of cellsRaw) {
    if (cells.length >= MAX_RACI_CELLS) break;
    const e = entry as Partial<ProposedCell> | null;
    if (!e || typeof e !== "object") continue;
    if (!Number.isFinite(e.stakeholderId) || !Number.isFinite(e.milestoneId)) continue;
    if (!isRaciRole(e.role)) continue;
    cells.push({
      stakeholderId: Number(e.stakeholderId),
      milestoneId: Number(e.milestoneId),
      role: e.role,
    });
  }
  return { cells, truncated: cellsRaw.length > MAX_RACI_CELLS };
}

/** Re-ground UNTRUSTED cells against the live workspace. */
export function groundRaciCells(
  proposed: readonly ProposedCell[],
  stakeholders: readonly Stakeholder[],
  milestones: readonly Milestone[],
): { cells: GroundedRaciCell[]; skipped: SkippedRaciCell[]; truncated: boolean; noOp: number } {
  const byStakeholder = new Map(stakeholders.map((s) => [s.id, s]));
  const byMilestone = new Map(milestones.map((m) => [m.id, m]));

  // Who already holds Accountable for each milestone. A proposal may re-assert
  // the CURRENT holder (kept as a cell — see the no-op exemption below) but
  // must never mint a second one — the panel already warns on that state and
  // the model must not manufacture it.
  const accountableHolder = new Map<number, number>();
  for (const s of stakeholders) {
    for (const [key, role] of Object.entries(s.raci)) {
      if (role === "A") accountableHolder.set(Number(key), s.id);
    }
  }

  // Milestones whose STORED Accountable this proposal demotes (a valid non-A
  // role for that holder). A second A proposed for such a milestone is a
  // HANDOVER, and it is still refused rather than accepted: `onConfirm` applies
  // whatever subset the user ticks and does not re-check uniqueness, so a user
  // who unticked the demotion and kept the promotion would write TWO
  // Accountables. Only the explanation changes (§43). First occurrence per cell
  // only, matching the `seen` dedupe below.
  const storedHolders = new Map<number, number[]>();
  for (const s of stakeholders) {
    for (const [key, role] of Object.entries(s.raci)) {
      if (role === "A") storedHolders.set(Number(key), [...(storedHolders.get(Number(key)) ?? []), s.id]);
    }
  }
  const pairedMilestones = new Set<number>();
  const demotedHolder = new Set<number>();
  const preSeen = new Set<string>();
  for (const c of proposed) {
    const key = cellKey(c);
    if (preSeen.has(key)) continue;
    preSeen.add(key);
    if (!isRaciRole(c.role) || c.role === "A") continue;
    if (accountableHolder.get(c.milestoneId) === c.stakeholderId) demotedHolder.add(c.milestoneId);
  }

  const cells: GroundedRaciCell[] = [];
  const skipped: SkippedRaciCell[] = [];
  const seen = new Set<string>();
  // Cells dropped because the role proposed is the role already stored. They
  // are neither shown nor refused, so without a count the caller cannot tell
  // "the model proposed nothing" from "the model proposed things you already
  // have" — and told the user the former, which is false and far more
  // reachable: re-running against an already-populated matrix is the norm.
  let noOp = 0;

  for (const c of proposed) {
    if (cells.length >= MAX_RACI_CELLS) break;
    const key = cellKey(c);
    if (seen.has(key)) continue;
    seen.add(key);

    const s = byStakeholder.get(c.stakeholderId);
    if (!s) { skipped.push({ ...c, reason: "unknown-stakeholder" }); continue; }
    const m = byMilestone.get(c.milestoneId);
    if (!m) { skipped.push({ ...c, reason: "unknown-milestone" }); continue; }
    if (!isRaciRole(c.role)) { skipped.push({ ...c, reason: "invalid-role" }); continue; }

    const currentRole = s.raci[String(c.milestoneId)] ?? null;

    if (c.role === "A") {
      // Accountable is exactly-one-per-milestone. Re-asserting the CURRENT
      // holder is legal (it is not a duplicate); minting a second holder for
      // someone else is not.
      const holder = accountableHolder.get(c.milestoneId);
      if (holder !== undefined && holder !== c.stakeholderId) {
        // A handover needs exactly ONE stored holder (still unclaimed in the
        // map) whom the proposal demotes. Everything else stays a duplicate.
        const stored = storedHolders.get(c.milestoneId) ?? [];
        const unclaimed = stored.length === 1 && stored[0] === holder;
        if (!unclaimed) {
          skipped.push({ ...c, reason: "duplicate-accountable" });
          continue;
        }
        if (!demotedHolder.has(c.milestoneId)) {
          skipped.push({ ...c, reason: "accountable-needs-demotion" });
          continue;
        }
        pairedMilestones.add(c.milestoneId);
      }
      // Claim it BEFORE the no-op check below, so that a later proposed A for a
      // DIFFERENT stakeholder on this milestone is still refused even when this
      // cell is about to be dropped as a no-op.
      accountableHolder.set(c.milestoneId, c.stakeholderId);
    }

    // A cell that proposes the role already stored changes nothing. Dropping it
    // is uniform across all four roles on purpose: the review modal asks the
    // user to confirm each cell, and a row reading "current A -> proposed A" is
    // a decision with no consequence. Legality (above) and worth-showing (here)
    // are separate questions — an Accountable re-assertion is legal AND a no-op.
    if (currentRole === c.role) {
      noOp += 1;
      continue;
    }

    cells.push({
      ...c,
      stakeholderName: s.name,
      milestoneName: m.name,
      currentRole,
    });
  }

  return { cells: markHandoverPairs(cells, pairedMilestones, storedHolders), skipped, truncated: proposed.length > MAX_RACI_CELLS, noOp };
}

/** Stamp `pairKey` on both cells of each handover. A new A whose demotion was
 *  cut by the cell cap is dropped: it would mint a second Accountable alone. */
function markHandoverPairs(
  cells: GroundedRaciCell[],
  paired: ReadonlySet<number>,
  storedHolders: ReadonlyMap<number, number[]>,
): GroundedRaciCell[] {
  if (paired.size === 0) return cells;
  const hasDemotion = (m: number) =>
    cells.some((c) => c.milestoneId === m && c.stakeholderId === storedHolders.get(m)?.[0] && c.role !== "A");
  return cells.flatMap((c) => {
    if (!paired.has(c.milestoneId)) return [c];
    const isDemotion = c.stakeholderId === storedHolders.get(c.milestoneId)?.[0];
    if (!isDemotion && c.role === "A" && !hasDemotion(c.milestoneId)) return [];
    if (isDemotion || c.role === "A") return [{ ...c, pairKey: `handover:${c.milestoneId}` }];
    return [c];
  });
}

export const RACI_SUGGEST_TOOL = {
  name: "propose_raci",
  description:
    "Propose RACI assignments for stakeholders across project milestones. " +
    "R = Responsible (does the work), A = Accountable (exactly ONE per milestone, owns the outcome), " +
    "C = Consulted (two-way input), I = Informed (one-way updates). " +
    "Only propose assignments you are confident about; omit a cell rather than guess. " +
    "To move Accountable from its current holder to someone else, propose the new holder's A and a new role for the current holder in the same call; " +
    "otherwise never propose a second Accountable for a milestone that already has one.",
  input_schema: {
    type: "object" as const,
    properties: {
      cells: {
        type: "array" as const,
        items: {
          type: "object" as const,
          properties: {
            stakeholderId: { type: "number" as const, description: "id from the STAKEHOLDERS list" },
            milestoneId: { type: "number" as const, description: "id from the MILESTONES list" },
            role: { type: "string" as const, enum: [...RACI_ROLES] },
          },
          required: ["stakeholderId", "milestoneId", "role"],
        },
      },
    },
    required: ["cells"],
  },
} as const;
