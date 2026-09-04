// src/app/timelog-sanitize.ts
// Pure, i18n-free validators. Never throw; coerce/drop bad input.
import {
  type TimelogLinks, type TimelogUserLink, type TimelogProjectLink,
  type TimelogConfig, type TimelogScopeMode, defaultTimelogConfig,
  TIMELOG_RULE_IDS, type TimelogPolicy,
} from "./timelog-types";
import { MAX_HOURS_PER_DAY } from "./types";

/** A `timelogLinks` blob with nothing in it. Exported so the settings surface
 *  has ONE stable identity to hand `TimelogSettings` when the workspace carries
 *  no blob yet, rather than minting a fresh object every render. */
export const EMPTY_TIMELOG_LINKS: TimelogLinks = { userLinks: [], projectLinks: [] };

/** True when the blob carries nothing worth persisting.
 *  ★★ THE OUTER HALF OF THE BYTE-STABILITY RULE, and it is a genuinely separate
 *  one: `sanitizeTimelogPolicy` below drops an empty `policy` key, but
 *  `workspaceToJson` emits a `timelogLinks` key for ANY truthy blob, so writing
 *  `{userLinks: [], projectLinks: []}` back where the workspace previously had
 *  `undefined` puts a new key into the exported artifact. That is what a user
 *  who switches a guardrail on and straight back off would otherwise leave
 *  behind. A writer that can go back to empty must route through this. */
export function isBlankTimelogLinks(links: TimelogLinks): boolean {
  return (
    links.userLinks.length === 0 &&
    links.projectLinks.length === 0 &&
    links.customerId === undefined &&
    (links.projectIds?.length ?? 0) === 0 &&
    (links.policy === undefined || Object.keys(links.policy).length === 0)
  );
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function dedupeLast<T>(items: T[], key: (t: T) => number): T[] {
  const m = new Map<number, T>();
  for (const it of items) m.set(key(it), it);
  return [...m.values()];
}

// Guardrail policy. Mirrors the customerId/projectIds treatment below:
// an unconfigured rule contributes NO key, and an entirely unconfigured policy
// contributes no `policy` key at all, so a blob that predates this feature
// serialises byte-identically through the whole-blob JSON.stringify in
// timelogLinksToCsv/timelogLinksToMarkdown — which is why this field needs no
// codec code on any of the six write paths.
// ★★ golden-workspace.test does NOT pin this, and believing it does is the
// trap: the sample master carries no `timelogLinks` at all, so that suite never
// reaches this function and stays green either way (measured — the
// `policy: policy ?? {}` mutant left all 5 of its cases passing). The ONLY
// detectors are in timelog-sanitize.test.ts: the two "omits the policy key"
// cases, plus the two pre-existing whole-object toEqual link cases.
function sanitizeTimelogPolicy(raw: unknown): TimelogPolicy | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: TimelogPolicy = {};
  for (const rule of TIMELOG_RULE_IDS) {
    const v = r[rule];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const threshold =
      isNum(o.threshold) && o.threshold > 0 && o.threshold <= MAX_HOURS_PER_DAY
        ? o.threshold
        : undefined;
    out[rule] = {
      enabled: Boolean(o.enabled),
      ...(threshold !== undefined ? { threshold } : {}),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function sanitizeTimelogLinks(raw: unknown): TimelogLinks | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const rawUsers = Array.isArray(r.userLinks) ? r.userLinks : [];
  const rawProjects = Array.isArray(r.projectLinks) ? r.projectLinks : [];
  const userLinks: TimelogUserLink[] = dedupeLast(
    rawUsers
      .map((u): TimelogUserLink | null => {
        const o = (u && typeof u === "object" ? u : {}) as Record<string, unknown>;
        if (!isNum(o.timelogUserId) || !isNum(o.resourceId)) return null;
        return { timelogUserId: o.timelogUserId, resourceId: o.resourceId, manual: Boolean(o.manual) };
      })
      .filter((x): x is TimelogUserLink => x !== null),
    (u) => u.timelogUserId,
  );
  const projectLinks: TimelogProjectLink[] = dedupeLast(
    rawProjects
      .map((p): TimelogProjectLink | null => {
        const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
        if (!isNum(o.timelogProjectId)) return null;
        const bucketId = isNum(o.bucketId) ? o.bucketId : null;
        return { timelogProjectId: o.timelogProjectId, bucketId, manual: Boolean(o.manual) };
      })
      .filter((x): x is TimelogProjectLink => x !== null),
    (p) => p.timelogProjectId,
  );
  // Project→customer scope: keep only a positive integer CustomerID; drop the
  // key otherwise so an unscoped blob stays byte-stable.
  const customerId =
    isNum(r.customerId) && Number.isInteger(r.customerId) && r.customerId > 0
      ? r.customerId
      : undefined;
  // Selected projects for the scoped fetch: positive ints, deduped, capped.
  // Drop the key when empty so an unscoped blob stays byte-stable.
  const projectIds = Array.isArray(r.projectIds)
    ? [...new Set(r.projectIds.filter((v): v is number => isNum(v) && Number.isInteger(v) && v > 0))].slice(0, 200)
    : [];
  const policy = sanitizeTimelogPolicy(r.policy);
  return {
    userLinks,
    projectLinks,
    ...(customerId !== undefined ? { customerId } : {}),
    ...(projectIds.length > 0 ? { projectIds } : {}),
    ...(policy !== undefined ? { policy } : {}),
  };
}

const SCOPES: readonly TimelogScopeMode[] = ["auto", "self", "org"];
export function sanitizeTimelogConfig(raw: unknown): TimelogConfig {
  if (!raw || typeof raw !== "object") return { ...defaultTimelogConfig };
  const o = raw as Record<string, unknown>;
  const scopeMode = SCOPES.includes(o.scopeMode as TimelogScopeMode)
    ? (o.scopeMode as TimelogScopeMode)
    : "auto";
  return {
    enabled: o.enabled === true,
    host: str(o.host) || defaultTimelogConfig.host,
    tenant: str(o.tenant) || defaultTimelogConfig.tenant,
    email: str(o.email),
    apiToken: typeof o.apiToken === "string" ? o.apiToken : "",
    scopeMode,
    tokenInvalidAt: typeof o.tokenInvalidAt === "string" ? o.tokenInvalidAt : undefined,
  };
}
