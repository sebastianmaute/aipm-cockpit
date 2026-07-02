// Direct unit tests for the shared SSRF host-classification primitives.
//
// The per-route _helpers tests exercise these only THROUGH the host allowlist,
// which short-circuits before isPrivateHost for any IP literal (an IP is never a
// *.atlassian.net / *.timelog.com host). So isPrivateHost/mappedIpv4ToDotted are
// defense-in-depth code that the integration paths never reach. Testing them
// directly is the only way to lock down the exact range boundaries + fail-closed
// behavior — the highest-value thing to pin for an SSRF guard.
import { describe, expect, it } from "vitest";
import { isPrivateHost, mappedIpv4ToDotted, isAllowedHostSuffix } from "./proxy-ssrf";

describe("mappedIpv4ToDotted", () => {
  it("passes a dotted-decimal suffix through unchanged", () => {
    expect(mappedIpv4ToDotted("10.0.0.1")).toBe("10.0.0.1");
  });
  it("decodes two hex groups to dotted IPv4", () => {
    // a00:1 == 0x0a00 / 0x0001 == 10.0.0.1
    expect(mappedIpv4ToDotted("a00:1")).toBe("10.0.0.1");
    expect(mappedIpv4ToDotted("ffff:ffff")).toBe("255.255.255.255");
  });
  it("returns null for the wrong group count", () => {
    expect(mappedIpv4ToDotted("a00")).toBeNull();
    expect(mappedIpv4ToDotted("a:b:c")).toBeNull();
  });
  it("returns null for non-hex groups", () => {
    expect(mappedIpv4ToDotted("zz:1")).toBeNull();
    expect(mappedIpv4ToDotted("1:zz")).toBeNull();
  });
});

describe("isPrivateHost", () => {
  it.each([
    ["localhost", "localhost"],
    ["IPv6 loopback ::1", "::1"],
    ["unspecified ::", "::"],
    ["0.0.0.0", "0.0.0.0"],
    ["IPv6 ULA fc00", "fc00::1"],
    ["IPv6 ULA fd12", "fd12::1"],
    ["IPv6 link-local fe80", "fe80::1"],
    ["IPv6 link-local feb0", "feb0::1"],
    ["NAT64 64:ff9b", "64:ff9b::a00:1"],
    ["bracketed ::1", "[::1]"],
    ["loopback 127.0.0.1", "127.0.0.1"],
    ["loopback 127.255.255.255", "127.255.255.255"],
    ["private 10.x", "10.1.2.3"],
    ["private 172.16", "172.16.0.1"],
    ["private 172.31", "172.31.255.255"],
    ["private 192.168", "192.168.1.1"],
    ["link-local/metadata 169.254", "169.254.169.254"],
    ["IPv4-mapped dotted private", "::ffff:10.0.0.1"],
    ["IPv4-mapped hex private (canonicalized)", "::ffff:a00:1"],
    ["IPv4-mapped undecodable -> fail closed", "::ffff:a:b:c"],
  ])("flags %s as private", (_label, host) => {
    expect(isPrivateHost(host)).toBe(true);
  });

  it.each([
    ["public 8.8.8.8", "8.8.8.8"],
    ["just below the 172.16 range (172.15)", "172.15.0.1"],
    ["just above the 172.31 range (172.32)", "172.32.0.1"],
    ["public 1.2.3.4", "1.2.3.4"],
    ["a non-IP DNS hostname", "acme.atlassian.net"],
  ])("does NOT flag %s as private", (_label, host) => {
    expect(isPrivateHost(host)).toBe(false);
  });
});

describe("isAllowedHostSuffix", () => {
  it("accepts the bare apex and any subdomain", () => {
    expect(isAllowedHostSuffix("atlassian.net", "atlassian.net")).toBe(true);
    expect(isAllowedHostSuffix("team.atlassian.net", "atlassian.net")).toBe(true);
    expect(isAllowedHostSuffix("a.b.timelog.com", "timelog.com")).toBe(true);
  });
  it("rejects lookalikes and embedded/suffix attacks (leading dot is load-bearing)", () => {
    expect(isAllowedHostSuffix("evil-atlassian.net", "atlassian.net")).toBe(false);
    expect(isAllowedHostSuffix("atlassian.net.attacker.com", "atlassian.net")).toBe(false);
    expect(isAllowedHostSuffix("eviltimelog.com", "timelog.com")).toBe(false);
  });
  it("is case-insensitive on host and apex", () => {
    expect(isAllowedHostSuffix("TEAM.Atlassian.NET", "atlassian.net")).toBe(true);
    expect(isAllowedHostSuffix("team.atlassian.net", "ATLASSIAN.NET")).toBe(true);
  });
});
