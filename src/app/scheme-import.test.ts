import { beforeEach, describe, expect, test, vi } from "vitest";
import { importSchemeText } from "./scheme-import";
import { loadSchemes, addScheme } from "./color-schemes";

vi.mock("./color-schemes-store", () => ({
  upsertSchemeAsync: vi.fn(async () => {}),
}));
import { upsertSchemeAsync } from "./color-schemes-store";

const FULL_THEME = JSON.stringify({
  name: "Portable",
  supportsDark: true,
  light: { "--ui-dark-blue": "#004159", "--surface": "#ffffff" },
  dark: { "--ui-dark-blue": "#8fd3ea", "--surface": "#121619" },
  structural: { "--shadow-card": "none" },
  branding: {},
});

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("importSchemeText", () => {
  test("carries dark, supportsDark AND structural onto the created scheme", async () => {
    // Headline claim FIRST — this is the exact degradation the editor shipped.
    const id = await importSchemeText(FULL_THEME, null);
    expect(id).not.toBeNull();
    const created = loadSchemes().schemes.find((s) => s.id === id);
    expect(created?.supportsDark).toBe(true);
    expect(created?.dark?.["--surface"]).toBe("#121619");
    expect(created?.structural?.["--shadow-card"]).toBe("none");
  });

  test("a second import of the same name activates the existing scheme instead of duplicating", async () => {
    const first = await importSchemeText(FULL_THEME, null);
    const second = await importSchemeText(FULL_THEME, null);
    expect(second).toBe(first);
    expect(loadSchemes().schemes.filter((s) => s.name === "Portable")).toHaveLength(1);
  });

  test("malformed JSON returns null and writes nothing", async () => {
    const before = loadSchemes().schemes.length;
    expect(await importSchemeText("{ not json", null)).toBeNull();
    expect(loadSchemes().schemes).toHaveLength(before);
  });

  test("a light-only theme imports without a dark map", async () => {
    const id = await importSchemeText(
      JSON.stringify({ name: "LightOnly", supportsDark: false, light: { "--surface": "#ffffff" }, branding: {} }),
      null,
    );
    const created = loadSchemes().schemes.find((s) => s.id === id);
    expect(created?.supportsDark).toBe(false);
    expect(created?.dark).toBeUndefined();
  });

  test("passes the created scheme to the Turso upsert", async () => {
    const cfg = { httpUrl: "https://db.example", authToken: "tok" } as never;
    const id = await importSchemeText(FULL_THEME, cfg);
    expect(upsertSchemeAsync).toHaveBeenCalledWith(cfg, expect.objectContaining({ id }));
  });

  test("dedup also re-upserts, so a file-mode import survives a later Turso connect", async () => {
    await importSchemeText(FULL_THEME, null);
    vi.clearAllMocks();
    const cfg = { httpUrl: "https://db.example", authToken: "tok" } as never;
    await importSchemeText(FULL_THEME, cfg);
    expect(upsertSchemeAsync).toHaveBeenCalledTimes(1);
  });

  test("a scheme created in the editor is not treated as a duplicate of a different name", async () => {
    addScheme("Handmade", { "--surface": "#ffffff" }, {});
    const id = await importSchemeText(FULL_THEME, null);
    expect(loadSchemes().schemes).toHaveLength(2);
    expect(id).not.toBeNull();
  });
});
