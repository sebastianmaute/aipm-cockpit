import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CSP_SHAREPOINT_HOSTS_ENV,
  CSP_TURSO_HOSTS_ENV,
  parseCspHostList,
  readCspHostSettings,
} from "./csp-host-settings";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("parseCspHostList — turso", () => {
  it("unset or blank → null (the wildcards stay)", () => {
    expect(parseCspHostList("turso", undefined)).toBeNull();
    expect(parseCspHostList("turso", "")).toBeNull();
    expect(parseCspHostList("turso", "  ")).toBeNull();
  });

  it("a Turso database host becomes an https source, a loopback host:port an http one", () => {
    expect(parseCspHostList("turso", "mydb-myorg.aws-eu-west-1.turso.io")).toEqual({
      sources: ["https://mydb-myorg.aws-eu-west-1.turso.io"],
    });
    expect(parseCspHostList("turso", "localhost:8080, 127.0.0.1:8081")).toEqual({
      sources: ["http://localhost:8080", "http://127.0.0.1:8081"],
    });
  });

  it("trims, lower-cases, drops empty entries and duplicates, keeping the given order", () => {
    expect(parseCspHostList("turso", " B-Org.turso.io ,a-org.turso.io,, b-org.turso.io ")).toEqual({
      sources: ["https://b-org.turso.io", "https://a-org.turso.io"],
    });
  });

  // One bad entry makes the whole setting invalid: a partial list would block databases the operator meant to allow.
  it.each([
    ["a scheme", "https://mydb.turso.io"],
    ["a wildcard", "*.turso.io"],
    ["the bare apex", "turso.io"],
    ["another provider", "mydb.example.com"],
    ["a lookalike", "mydb.turso.io.evil.com"],
    ["a path", "mydb.turso.io/v2"],
    ["a port on a Turso host", "mydb.turso.io:443"],
    ["a CSP injection", "mydb.turso.io; script-src *"],
    ["a loopback host without a port", "localhost"],
    ["a loopback port out of range", "localhost:70000"],
    ["port zero", "127.0.0.1:0"],
    ["only commas", ",,"],
    ["one good and one bad entry", "mydb.turso.io, *.turso.io"],
  ])("%s is invalid", (_label, raw) => {
    expect(parseCspHostList("turso", raw)).toEqual({ invalid: true });
  });
});

describe("parseCspHostList — sharepoint", () => {
  it("SharePoint and OneDrive file hosts become https sources", () => {
    expect(parseCspHostList("sharepoint", "contoso.sharepoint.com, contoso-my.sharepoint.com, public.files.1drv.com")).toEqual({
      sources: ["https://contoso.sharepoint.com", "https://contoso-my.sharepoint.com", "https://public.files.1drv.com"],
    });
  });

  it.each([
    ["a Turso host", "mydb.turso.io"],
    ["loopback", "localhost:8080"],
    ["the bare apex", "sharepoint.com"],
    ["a wildcard", "*.sharepoint.com"],
    ["a lookalike", "contoso.sharepoint.com.evil.com"],
  ])("%s is invalid", (_label, raw) => {
    expect(parseCspHostList("sharepoint", raw)).toEqual({ invalid: true });
  });
});

describe("readCspHostSettings", () => {
  it("reads both settings, each independently", () => {
    expect(readCspHostSettings({ [CSP_TURSO_HOSTS_ENV]: "a-org.turso.io" })).toEqual({
      turso: ["https://a-org.turso.io"],
      sharepoint: null,
    });
    expect(readCspHostSettings({ [CSP_SHAREPOINT_HOSTS_ENV]: "contoso.sharepoint.com" })).toEqual({
      turso: null,
      sharepoint: ["https://contoso.sharepoint.com"],
    });
  });

  // The once-per-process record is module state, so each logging test gets a fresh module: in shuffled order the
  // other one would otherwise have reported the setting already.
  async function freshRead() {
    vi.resetModules();
    return (await import("./csp-host-settings")).readCspHostSettings;
  }

  it("an invalid setting keeps its wildcards (null) and is logged once, naming the setting, never its value", async () => {
    const readCspHostSettings = await freshRead();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { [CSP_TURSO_HOSTS_ENV]: "secret-ish.example.com" };
    expect(readCspHostSettings(env).turso).toBeNull();
    expect(readCspHostSettings(env).turso).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(CSP_TURSO_HOSTS_ENV);
    expect(String(warn.mock.calls[0][0])).not.toContain("secret-ish");
  });

  // Mutation: keying the once-only set on a constant turns this red: the second setting is never reported.
  it("each invalid setting is logged once under its own name", async () => {
    const readCspHostSettings = await freshRead();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { [CSP_TURSO_HOSTS_ENV]: "bad", [CSP_SHAREPOINT_HOSTS_ENV]: "also-bad" };
    readCspHostSettings(env);
    readCspHostSettings(env);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.filter((m) => m.includes(CSP_SHAREPOINT_HOSTS_ENV))).toHaveLength(1);
    expect(messages.filter((m) => m.endsWith(CSP_TURSO_HOSTS_ENV))).toHaveLength(1);
  });

  it("the setting names are the documented ones", () => {
    expect(CSP_TURSO_HOSTS_ENV).toBe("AIPM_CSP_TURSO_HOSTS");
    expect(CSP_SHAREPOINT_HOSTS_ENV).toBe("AIPM_CSP_SHAREPOINT_HOSTS");
  });
});
