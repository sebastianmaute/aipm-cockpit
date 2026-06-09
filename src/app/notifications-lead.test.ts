import { describe, expect, it } from "vitest";
import { effectiveLeadDays } from "./notifications-lead";
import type { NotificationsConfig } from "./settings-types";

function makeCfg(overrides: Partial<NotificationsConfig> = {}): NotificationsConfig {
  return {
    reminderLeadDays: 7,
    useGlobalLeadDays: true,
    banner: { enabled: true },
    toast: { enabled: true },
    popup: { enabled: true },
    birthday: { enabled: true },
    raidReview: { enabled: true },
    raidReviewIntervalDays: 14,
    stakeholderComms: { enabled: true },
    jiraTokenError: { enabled: true },
    ...overrides,
  };
}

describe("effectiveLeadDays", () => {
  it("global on → returns reminderLeadDays even when channel has leadDays", () => {
    const cfg = makeCfg({
      useGlobalLeadDays: true,
      reminderLeadDays: 7,
      banner: { enabled: true, leadDays: 3 },
    });
    expect(effectiveLeadDays(cfg, "banner")).toBe(7);
  });

  it("global off → returns channel leadDays when set", () => {
    const cfg = makeCfg({
      useGlobalLeadDays: false,
      reminderLeadDays: 7,
      toast: { enabled: true, leadDays: 14 },
    });
    expect(effectiveLeadDays(cfg, "toast")).toBe(14);
  });

  it("global off + channel has no leadDays → falls back to reminderLeadDays", () => {
    const cfg = makeCfg({
      useGlobalLeadDays: false,
      reminderLeadDays: 7,
      popup: { enabled: true },
    });
    expect(effectiveLeadDays(cfg, "popup")).toBe(7);
  });

  it("global on → returns reminderLeadDays for all channels regardless of per-channel overrides", () => {
    const cfg = makeCfg({
      useGlobalLeadDays: true,
      reminderLeadDays: 10,
      birthday: { enabled: true, leadDays: 2 },
    });
    expect(effectiveLeadDays(cfg, "birthday")).toBe(10);
  });
});
