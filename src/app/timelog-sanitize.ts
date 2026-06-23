// src/app/timelog-sanitize.ts
// Pure, i18n-free validators. Never throw; coerce/drop bad input.
import {
  type TimelogLinks, type TimelogUserLink, type TimelogProjectLink,
  type TimelogConfig, type TimelogScopeMode, defaultTimelogConfig,
} from "./timelog-types";

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function dedupeLast<T>(items: T[], key: (t: T) => number): T[] {
  const m = new Map<number, T>();
  for (const it of items) m.set(key(it), it);
  return [...m.values()];
}

export function sanitizeTimelogLinks(raw: unknown): TimelogLinks | undefined {
  if (!raw || typeof raw !== "object") return undefined;
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
        const bucketId = isNum(o.bucketId) ? o.bucketId : o.bucketId === null ? null : null;
        return { timelogProjectId: o.timelogProjectId, bucketId, manual: Boolean(o.manual) };
      })
      .filter((x): x is TimelogProjectLink => x !== null),
    (p) => p.timelogProjectId,
  );
  return { userLinks, projectLinks };
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
