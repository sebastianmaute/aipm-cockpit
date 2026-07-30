// Pure, i18n-free engine for "Suggest RACI". No clock, no network, no DOM —
// mirrors alloc-plan/alloc-plan.ts. The model's output is UNTRUSTED and is
// re-grounded against the live stakeholders/milestones before anything can be
// shown or applied.
import { RACI_ROLES, type Milestone, type RaciRole, type Stakeholder } from "../types";

export const MAX_RACI_CELLS = 200;
export const MAX_CONTEXT_STAKEHOLDERS = 120;
export const MAX_CONTEXT_MILESTONES = 60;

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
}

export type SkipReason =
  | "unknown-stakeholder"
  | "unknown-milestone"
  | "invalid-role"
  | "duplicate-accountable";

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
): { cells: GroundedRaciCell[]; skipped: SkippedRaciCell[]; truncated: boolean } {
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

  const cells: GroundedRaciCell[] = [];
  const skipped: SkippedRaciCell[] = [];
  const seen = new Set<string>();

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
      // Accountable is exactly-one-per-milestone. A proposal may re-assert the
      // CURRENT holder — that is a deliberate confirmation, not a mistake, so
      // (unlike R/C/I below) it is NOT filtered out as a no-op — but it must
      // never mint a second holder for someone else.
      const holder = accountableHolder.get(c.milestoneId);
      if (holder !== undefined && holder !== c.stakeholderId) {
        skipped.push({ ...c, reason: "duplicate-accountable" });
        continue;
      }
      // Claim it so a second proposed A for the same milestone is refused too.
      accountableHolder.set(c.milestoneId, c.stakeholderId);
    } else if (currentRole === c.role) {
      // Nothing to change for R/C/I — not an error, just not worth showing.
      continue;
    }

    cells.push({
      ...c,
      stakeholderName: s.name,
      milestoneName: m.name,
      currentRole,
    });
  }

  return { cells, skipped, truncated: proposed.length > MAX_RACI_CELLS };
}

/** Compact English digest for the model. Capped, and reports the cap — a silent
 *  truncation reads as "covered everything". */
export function buildRaciContext(
  stakeholders: readonly Stakeholder[],
  milestones: readonly Milestone[],
): { text: string; truncated: boolean } {
  const s = stakeholders.slice(0, MAX_CONTEXT_STAKEHOLDERS);
  const m = milestones.slice(0, MAX_CONTEXT_MILESTONES);
  const lines: string[] = ["STAKEHOLDERS (id | name | title | organization | category | influence | interest)"];
  for (const p of s) {
    lines.push(
      [p.id, p.name, p.title ?? "", p.organization ?? "", p.category, p.influence, p.interest].join(" | "),
    );
  }
  lines.push("", "MILESTONES (id | name | date | description)");
  for (const x of m) {
    lines.push([x.id, x.name, x.date ?? "", x.description ?? ""].join(" | "));
  }
  lines.push("", "EXISTING ASSIGNMENTS (stakeholderId | milestoneId | role)");
  for (const p of s) {
    for (const [key, role] of Object.entries(p.raci)) {
      lines.push([p.id, key, role].join(" | "));
    }
  }
  return {
    text: lines.join("\n"),
    truncated:
      stakeholders.length > MAX_CONTEXT_STAKEHOLDERS ||
      milestones.length > MAX_CONTEXT_MILESTONES,
  };
}

export const RACI_SUGGEST_TOOL = {
  name: "propose_raci",
  description:
    "Propose RACI assignments for stakeholders across project milestones. " +
    "R = Responsible (does the work), A = Accountable (exactly ONE per milestone, owns the outcome), " +
    "C = Consulted (two-way input), I = Informed (one-way updates). " +
    "Only propose assignments you are confident about; omit a cell rather than guess. " +
    "Never propose a second Accountable for a milestone that already has one.",
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
