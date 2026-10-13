// src/app/timelog-address.ts
// Pure, i18n-free: reads the Timelog host and tenant out of an address the
// user pasted from their browser's address bar (§704).
//
// ★ The host rules MIRROR `normalizeHost` in `api/timelog/_helpers.ts` (the
//   server-side guard) and are deliberately never looser: https only, no "@"
//   (userinfo) and no ":" (port) in the authority, and the host is `timelog.com`
//   or ends in `.timelog.com` (the leading dot rejects "eviltimelog.com" and
//   "timelog.com.attacker.com"). Server code is not imported into the client;
//   if the guard ever changes, this must change with it.

const TIMELOG_APEX = "timelog.com";
// Scheme, then the authority up to the first "/", "?" or "#", then the path up
// to the first "?" or "#" (query and fragment are ignored).
const ADDRESS_RE = /^https:\/\/([^/?#]*)([^?#]*)/i;
// A bare DNS name; stricter than the server guard on purpose (it also keeps
// whitespace and other junk out of the stored host).
const HOSTNAME_RE = /^[a-z0-9.-]+$/;

export type TimelogAddress = { host: string; tenant: string };

export function parseTimelogAddress(raw: string): TimelogAddress | null {
  const match = ADDRESS_RE.exec(raw.trim());
  if (!match) return null;
  const authority = match[1];
  if (authority.includes("@") || authority.includes(":")) return null;
  const host = authority.toLowerCase();
  if (!HOSTNAME_RE.test(host)) return null;
  if (host !== TIMELOG_APEX && !host.endsWith(`.${TIMELOG_APEX}`)) return null;

  const segment = match[2].split("/").find((part) => part !== "");
  if (segment === undefined) return null;
  let tenant: string;
  try {
    tenant = decodeURIComponent(segment);
  } catch {
    return null;
  }
  if (tenant.trim() === "") return null;
  return { host, tenant };
}
