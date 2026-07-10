import { describe, it, expect } from "vitest";
import { sanitizeDigestConfig, DEFAULT_DIGEST_CONFIG } from "./digest-config";

describe("sanitizeDigestConfig", () => {
  it("defaults to disabled, 7-day cadence", () => {
    expect(sanitizeDigestConfig(undefined)).toEqual(DEFAULT_DIGEST_CONFIG);
    expect(DEFAULT_DIGEST_CONFIG).toEqual({ enabled: false, cadenceDays: 7 });
  });
  it("enabled only when strictly true; cadence clamped int 1..90", () => {
    expect(sanitizeDigestConfig({ enabled: true, cadenceDays: 14 })).toEqual({ enabled: true, cadenceDays: 14 });
    expect(sanitizeDigestConfig({ enabled: "yes", cadenceDays: 0 })).toEqual({ enabled: false, cadenceDays: 7 });
    expect(sanitizeDigestConfig({ enabled: true, cadenceDays: 999 })).toEqual({ enabled: true, cadenceDays: 90 });
    expect(sanitizeDigestConfig({ enabled: true, cadenceDays: 3.7 })).toEqual({ enabled: true, cadenceDays: 3 });
  });
});
