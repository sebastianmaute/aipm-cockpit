// Shared SSRF host-classification primitives for the outbound API proxies
// (/api/jira, /api/timelog, /api/confluence). These functions were duplicated
// byte-for-byte in each route's _helpers.ts; consolidating them removes the risk
// of the copies drifting apart (a subtle weakening of one guard going unnoticed).
//
// Provider-specific concerns (which host apex is allowed, Basic vs Bearer auth,
// how the upstream URL is assembled) deliberately stay in each _helpers.ts —
// they genuinely differ, and parameterizing security guards that diverge would
// add config surface where a mistake silently weakens a guard. Only the parts
// that are IDENTICAL live here.

/**
 * Recover the embedded IPv4 from an IPv4-mapped IPv6 suffix (the part after
 * "::ffff:"). The input may be dotted-decimal ("10.0.0.1") OR — because the URL
 * parser canonicalizes mapped addresses to hex — two hex groups ("a00:1").
 * Returns null when the suffix can't be decoded, so callers can fail closed.
 */
export function mappedIpv4ToDotted(suffix: string): string | null {
  if (suffix.includes(".")) return suffix;
  const groups = suffix.split(":");
  if (groups.length !== 2) return null;
  const hi = Number.parseInt(groups[0], 16);
  const lo = Number.parseInt(groups[1], 16);
  if (!Number.isInteger(hi) || !Number.isInteger(lo)) return null;
  if (hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) return null;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * True when `hostname` resolves to (or literally is) an internal/private address
 * range that must never be reachable through an outbound proxy: loopback, RFC1918
 * private, link-local / cloud metadata (169.254.169.254), IPv6 ULA/link-local,
 * NAT64, and IPv4-mapped IPv6. A mapped address that cannot be decoded is treated
 * as private (fail closed). Note: this catches IP LITERALS only — the DNS
 * "resolves-to-internal" vector is closed separately by each route's host
 * allowlist (see isAllowedHostSuffix).
 */
export function isPrivateHost(hostname: string): boolean {
  // Strip IPv6 brackets (e.g. "[::1]" → "::1").
  const h = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  const lower = h.toLowerCase();
  if (lower === "localhost" || lower === "::1" || lower === "::" || lower === "0.0.0.0")
    return true;
  // IPv6 unique-local (fc00::/7) and link-local (fe80::/10) — internal-only ranges.
  if (/^f[cd][0-9a-f]*:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]*:/.test(lower)) return true;
  // NAT64 well-known prefix (64:ff9b::/96, RFC 6052) embeds an IPv4 address in
  // its low 32 bits and can reach internal IPv4 hosts where NAT64 is deployed.
  // No legitimate proxied site is a NAT64 literal — block the prefix.
  if (/^64:ff9b:/.test(lower)) return true;
  // IPv4-mapped IPv6 (e.g. "::ffff:10.0.0.1", which the URL parser canonicalizes
  // to hex "::ffff:a00:1") — recover the embedded IPv4 and re-check it. A mapped
  // address we cannot decode is treated as private (fail closed) — a legitimate
  // proxied site is always a DNS hostname, never an IP literal.
  let ipv4 = h;
  if (lower.startsWith("::ffff:")) {
    const mapped = mappedIpv4ToDotted(lower.slice(7));
    if (mapped === null) return true;
    ipv4 = mapped;
  }
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return false;
  const [a, b] = parts;
  // 127.0.0.0/8 — loopback
  if (a === 127) return true;
  // 10.0.0.0/8 — private
  if (a === 10) return true;
  // 172.16.0.0/12 — private
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 — private
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 — link-local / cloud instance metadata (e.g. 169.254.169.254)
  if (a === 169 && b === 254) return true;
  return false;
}

/**
 * True when `hostname` is exactly `apex` or a subdomain of it. The leading-dot
 * check on the suffix is load-bearing: it rejects lookalikes such as
 * "evil-atlassian.net" and "atlassian.net.attacker.com" while accepting the bare
 * apex and any real "<site>.<apex>" subdomain. Case-insensitive.
 */
export function isAllowedHostSuffix(hostname: string, apex: string): boolean {
  const h = hostname.toLowerCase();
  const a = apex.toLowerCase();
  return h === a || h.endsWith("." + a);
}
