// Where the launch log goes.
//
// ★ "It doesn't open" with no artifact is unsupportable at a distance, so this
// must never throw and never return "". An empty-string env var is treated as
// absent — otherwise the path would be rooted at the filesystem root.
const APP_DIR = "aipm-cockpit";

export function resolveLogDir(env: Record<string, string | undefined>): string {
  const base = firstNonEmpty([env.LOCALAPPDATA, env.TEMP, env.TMP]) ?? ".";
  return `${base}\\${APP_DIR}\\logs`;
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}
