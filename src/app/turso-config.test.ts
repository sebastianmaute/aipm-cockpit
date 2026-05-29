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
});
