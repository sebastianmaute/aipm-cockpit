// Pure per-device digest config sanitizer. Rides the writeSettings spread (no
// allowlist edit), mirrors dashboardDensity/tasksViewMode.
export interface DigestConfig {
  enabled: boolean;
  cadenceDays: number;
}

export const DEFAULT_DIGEST_CONFIG: DigestConfig = { enabled: false, cadenceDays: 7 };

const MIN_CADENCE = 1;
const MAX_CADENCE = 90;

export function sanitizeDigestConfig(v: unknown): DigestConfig {
  if (typeof v !== "object" || v === null) return { ...DEFAULT_DIGEST_CONFIG };
  const o = v as Record<string, unknown>;
  const enabled = o.enabled === true;
  const raw = typeof o.cadenceDays === "number" && Number.isFinite(o.cadenceDays) ? Math.trunc(o.cadenceDays) : DEFAULT_DIGEST_CONFIG.cadenceDays;
  // Below the minimum falls back to the default cadence; above the maximum clamps to MAX.
  const cadenceDays = raw < MIN_CADENCE ? DEFAULT_DIGEST_CONFIG.cadenceDays : Math.min(MAX_CADENCE, raw);
  return { enabled, cadenceDays };
}
