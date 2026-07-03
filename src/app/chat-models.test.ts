import { describe, expect, it } from "vitest";
import { buildModelOptions, isValidAnthropicApiKey, type LiveModel } from "./chat-models";

const REG = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
] as const;

describe("buildModelOptions", () => {
  it("maps live models, newest first, using display_name", () => {
    const live: LiveModel[] = [
      { id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2026-01-01T00:00:00Z" },
      { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6", created_at: "2025-06-01T00:00:00Z" },
    ];
    const opts = buildModelOptions(REG, live, "claude-sonnet-4-6");
    expect(opts.map((o) => o.id)).toEqual(["claude-opus-4-8", "claude-sonnet-4-6"]);
    expect(opts[0].label).toBe("Claude Opus 4.8");
  });

  it("falls back to label=id when display_name missing", () => {
    const opts = buildModelOptions(REG, [{ id: "claude-x", created_at: "2026-01-01T00:00:00Z" }], "claude-x");
    expect(opts[0]).toEqual({ id: "claude-x", label: "claude-x" });
  });

  it("filters out non-claude ids", () => {
    const live: LiveModel[] = [
      { id: "gpt-4", display_name: "GPT 4", created_at: "2026-01-01T00:00:00Z" },
      { id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2025-01-01T00:00:00Z" },
    ];
    const opts = buildModelOptions(REG, live, "claude-opus-4-8");
    expect(opts.map((o) => o.id)).toEqual(["claude-opus-4-8"]);
  });

  it("uses the registry when the live list is empty", () => {
    const opts = buildModelOptions(REG, [], "claude-sonnet-4-6");
    expect(opts.map((o) => o.id)).toEqual(["claude-sonnet-4-6", "claude-opus-4-8"]);
  });

  it("registryAsBase:false — returns ONLY the current selection when live is empty (no pre-fill)", () => {
    const opts = buildModelOptions(REG, [], "claude-sonnet-4-6", { registryAsBase: false });
    expect(opts).toEqual([{ id: "claude-sonnet-4-6", label: expect.any(String) }]);
  });

  it("registryAsBase:false — still uses live models when present", () => {
    const live: LiveModel[] = [{ id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2026-01-01T00:00:00Z" }];
    const opts = buildModelOptions(REG, live, "claude-opus-4-8", { registryAsBase: false });
    expect(opts.map((o) => o.id)).toEqual(["claude-opus-4-8"]);
  });

  it("always includes currentId, prepended when absent from live", () => {
    const live: LiveModel[] = [{ id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2026-01-01T00:00:00Z" }];
    const opts = buildModelOptions(REG, live, "claude-legacy-9");
    expect(opts[0]).toEqual({ id: "claude-legacy-9", label: "claude-legacy-9" });
    expect(opts.some((o) => o.id === "claude-opus-4-8")).toBe(true);
  });

  it("does not duplicate currentId when already present", () => {
    const live: LiveModel[] = [{ id: "claude-opus-4-8", display_name: "Claude Opus 4.8", created_at: "2026-01-01T00:00:00Z" }];
    const opts = buildModelOptions(REG, live, "claude-opus-4-8");
    expect(opts.filter((o) => o.id === "claude-opus-4-8")).toHaveLength(1);
  });

  it("ignores an empty currentId", () => {
    const opts = buildModelOptions(REG, [], "");
    expect(opts.every((o) => o.id !== "")).toBe(true);
  });
});

describe("isValidAnthropicApiKey", () => {
  it("accepts a well-formed sk-ant key", () => {
    expect(isValidAnthropicApiKey("sk-ant-api03-AbC123_def-456GHI789jkl")).toBe(true);
  });
  it("trims surrounding whitespace before validating", () => {
    expect(isValidAnthropicApiKey("  sk-ant-api03-AbC123_def-456GHI789jkl  ")).toBe(true);
  });
  it("rejects empty / whitespace", () => {
    expect(isValidAnthropicApiKey("")).toBe(false);
    expect(isValidAnthropicApiKey("   ")).toBe(false);
  });
  it("rejects the wrong prefix", () => {
    expect(isValidAnthropicApiKey("sk-1234567890123456")).toBe(false);
  });
  it("rejects too-short keys", () => {
    expect(isValidAnthropicApiKey("sk-ant-short")).toBe(false);
  });
  it("rejects illegal characters", () => {
    expect(isValidAnthropicApiKey("sk-ant-aaaaaaaaaaaaaaaa!@#$")).toBe(false);
  });
});
