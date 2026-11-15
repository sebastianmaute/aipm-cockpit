// SERVER-ONLY (read by `src/proxy.ts`). §800: a deployment may name the exact hosts its browsers connect to, and the
// page's Content Security Policy then lists those in place of the provider-wide wildcards:
//   AIPM_CSP_TURSO_HOSTS        Turso database hosts (`<db>-<org>.<region>.turso.io`, sent as https) and local libSQL
//                               servers (`localhost:PORT`, `127.0.0.1:PORT`, sent as http); replaces `*.turso.io` and
//                               the two loopback wildcards.
//   AIPM_CSP_SHAREPOINT_HOSTS   SharePoint and OneDrive file hosts (`*.sharepoint.com`, `*.files.1drv.com`, each named
//                               exactly); replaces those two wildcards.
// Both are comma-separated. Read per request. Unset keeps the wildcards. A value with any entry that is not such a
// host keeps the wildcards too, so a typo cannot cut the browser off from storage, and is logged on the server once
// per process, naming the setting only, never its value.

export const CSP_TURSO_HOSTS_ENV = "AIPM_CSP_TURSO_HOSTS";
export const CSP_SHAREPOINT_HOSTS_ENV = "AIPM_CSP_SHAREPOINT_HOSTS";

/** The wildcard families a setting can replace. */
export type CspHostGroup = "turso" | "sharepoint";

type Env = Record<string, string | undefined>;

const LABELS = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*";
const TURSO_HOST = new RegExp(`^${LABELS}\\.turso\\.io$`);
const LOOPBACK = /^(localhost|127\.0\.0\.1):([0-9]{1,5})$/;
const SHAREPOINT_HOST = new RegExp(`^${LABELS}\\.(?:sharepoint\\.com|files\\.1drv\\.com)$`);

/** One entry as a CSP source, or null when it is not a host this group accepts. */
function toSource(group: CspHostGroup, entry: string): string | null {
  if (group === "sharepoint") return SHAREPOINT_HOST.test(entry) ? `https://${entry}` : null;
  if (TURSO_HOST.test(entry)) return `https://${entry}`;
  const loopback = LOOPBACK.exec(entry);
  if (!loopback) return null;
  const port = Number(loopback[2]);
  return port >= 1 && port <= 65535 ? `http://${loopback[1]}:${port}` : null;
}

/** The sources a raw setting names, with no side effect: null while unset, `invalid` when any entry is unusable. */
export function parseCspHostList(group: CspHostGroup, raw: string | undefined): { sources: string[] } | { invalid: true } | null {
  const entries = (raw ?? "").split(",").map((e) => e.trim().toLowerCase());
  if (entries.every((e) => e === "")) return raw === undefined || raw.trim() === "" ? null : { invalid: true };
  const sources: string[] = [];
  for (const entry of entries) {
    if (entry === "") continue;
    const source = toSource(group, entry);
    if (source === null) return { invalid: true };
    if (!sources.includes(source)) sources.push(source);
  }
  return { sources };
}

const ENV_BY_GROUP: Readonly<Record<CspHostGroup, string>> = {
  turso: CSP_TURSO_HOSTS_ENV,
  sharepoint: CSP_SHAREPOINT_HOSTS_ENV,
};

/** Settings already reported by this server process: each is logged once, not on every request. Mutable module
 *  state on purpose: "once per process" needs memory that outlives a call. */
const reported = new Set<string>();

/** Each group's named sources, or null where the wildcards stay (unset or invalid); an invalid setting tells the
 *  operator once per process. */
export function readCspHostSettings(env: Env): Readonly<Record<CspHostGroup, readonly string[] | null>> {
  const read = (group: CspHostGroup): readonly string[] | null => {
    const name = ENV_BY_GROUP[group];
    const parsed = parseCspHostList(group, env[name]);
    if (parsed === null) return null;
    if ("invalid" in parsed) {
      if (!reported.has(name)) {
        reported.add(name);
        console.warn(`content security policy host setting invalid, keeping the wildcards: ${name}`);
      }
      return null;
    }
    return parsed.sources;
  };
  return { turso: read("turso"), sharepoint: read("sharepoint") };
}
