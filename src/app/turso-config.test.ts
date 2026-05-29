import { describe, it, expect, afterEach, vi } from "vitest";
import { getTursoConfig } from "./turso-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getTursoConfig", () => {
  it("returns null when neither env nor settings provide a URL/token", () => {
    expect(getTursoConfig()).toBeNull();
    expect(getTursoConfig("libsql://x.turso.io")).toBeNull(); // no token
    expect(getTursoConfig(undefined, "tok")).toBeNull(); // no url
  });

  it("uses settings values when env is absent", () => {
    expect(getTursoConfig("libsql://x.turso.io", "tok")).toEqual({
      httpUrl: "https://x.turso.io",
      authToken: "tok",
    });
  });

  it("env vars win over settings", () => {
    vi.stubEnv("NEXT_PUBLIC_TURSO_DATABASE_URL", "libsql://env-db.turso.io");
    vi.stubEnv("NEXT_PUBLIC_TURSO_AUTH_TOKEN", "env-tok");
    expect(getTursoConfig("libsql://settings.turso.io", "settings-tok")).toEqual({
      httpUrl: "https://env-db.turso.io",
      authToken: "env-tok",
    });
  });

  it("normalizes libsql:// to https:// and strips trailing slash", () => {
    expect(getTursoConfig("libsql://x.turso.io/", "tok")?.httpUrl).toBe("https://x.turso.io");
    expect(getTursoConfig("https://x.turso.io", "tok")?.httpUrl).toBe("https://x.turso.io");
  });

  it("rejects unusable URL schemes", () => {
    expect(getTursoConfig("http://insecure.example", "tok")).toBeNull();
    expect(getTursoConfig("not a url", "tok")).toBeNull();
  });

  it("rejects empty-host and non-https schemes", () => {
    expect(getTursoConfig("https://", "tok")).toBeNull();
    expect(getTursoConfig("libsql://", "tok")).toBeNull();
    expect(getTursoConfig("ftp://x.turso.io", "tok")).toBeNull();
  });

  it("allows plaintext http only for loopback hosts (local tursodb), token optional", () => {
    expect(getTursoConfig("http://127.0.0.1:8080", "")).toEqual({
      httpUrl: "http://127.0.0.1:8080",
      authToken: "",
    });
    expect(getTursoConfig("http://localhost:8080")).toEqual({
      httpUrl: "http://localhost:8080",
      authToken: "",
    });
    // A token is still accepted (and forwarded) for a local server if provided.
    expect(getTursoConfig("http://localhost:9000", "local-tok")).toEqual({
      httpUrl: "http://localhost:9000",
      authToken: "local-tok",
    });
  });

  it("rejects plaintext http for non-loopback hosts (incl. loopback-lookalikes)", () => {
    expect(getTursoConfig("http://db.example.com", "tok")).toBeNull();
    expect(getTursoConfig("http://127.0.0.1.evil.com", "tok")).toBeNull();
    expect(getTursoConfig("http://localhost.evil.com", "tok")).toBeNull();
    expect(getTursoConfig("http://localhost.", "tok")).toBeNull();
  });

  it("treats an uppercased loopback host as loopback (URL lowercases the hostname)", () => {
    expect(getTursoConfig("http://LOCALHOST:8080", "")).toEqual({
      httpUrl: "http://localhost:8080",
      authToken: "",
    });
  });

  it("still requires a token for remote https / libsql endpoints", () => {
    expect(getTursoConfig("https://x.turso.io")).toBeNull();
    expect(getTursoConfig("libsql://x.turso.io")).toBeNull();
  });
});
