// The two per-project AI switches: review every AI write, withhold rates. Both are
// stored as `true` and absent otherwise; a deployment can force either on.

import { afterEach, describe, expect, it } from "vitest";
import {
  isRatesWithheld,
  isRatesWithheldForced,
  isReviewAllWrites,
  isReviewAllWritesForced,
  withAiSwitch,
} from "./ai-project-switches";
import { withPeopleAllowed } from "./ai-people-protection";
import { parseDisabledIntegrations, setDisabledIntegrations } from "./integration-switches";
import { sanitizeSettingsOverrides } from "./settings-overrides";

afterEach(() => setDisabledIntegrations([]));

describe("sanitizeSettingsOverrides — ai switches", () => {
  it("keeps each key only when exactly true, independently", () => {
    expect(sanitizeSettingsOverrides({ ai: { reviewAllWrites: true } })).toEqual({ ai: { reviewAllWrites: true } });
    expect(sanitizeSettingsOverrides({ ai: { ratesWithheld: true } })).toEqual({ ai: { ratesWithheld: true } });
    expect(sanitizeSettingsOverrides({ ai: { peopleAllowed: true, ratesWithheld: true, reviewAllWrites: true } })).toEqual({
      ai: { peopleAllowed: true, reviewAllWrites: true, ratesWithheld: true },
    });
    for (const bad of ["true", 1, false]) {
      expect(sanitizeSettingsOverrides({ ai: { reviewAllWrites: bad, ratesWithheld: bad } })).toEqual({});
    }
    expect(sanitizeSettingsOverrides({ ai: { reviewAllWrites: "true", ratesWithheld: true } })).toEqual({
      ai: { ratesWithheld: true },
    });
  });

  it("emits no ai for an empty object", () => {
    expect(sanitizeSettingsOverrides({ ai: {} })).toEqual({});
  });

  it("stays byte-stable for a project that only set peopleAllowed", () => {
    expect(sanitizeSettingsOverrides({ ai: { peopleAllowed: true } })).toEqual({ ai: { peopleAllowed: true } });
  });
});

describe("withPeopleAllowed keeps the other ai switches", () => {
  it("merges and preserves", () => {
    const on = withPeopleAllowed({ ai: { reviewAllWrites: true } }, true);
    expect(on).toEqual({ ai: { reviewAllWrites: true, peopleAllowed: true } });
    expect(withPeopleAllowed(on, false)).toEqual({ ai: { reviewAllWrites: true } });
  });
});

describe("withAiSwitch", () => {
  it("returns undefined when turning off from nothing", () => {
    expect(withAiSwitch(undefined, "ratesWithheld", false)).toBeUndefined();
  });

  it("round-trips on and off to undefined without mutating", () => {
    const base = undefined;
    const on = withAiSwitch(base, "ratesWithheld", true);
    expect(on).toEqual({ ai: { ratesWithheld: true } });
    expect(withAiSwitch(on, "ratesWithheld", false)).toBeUndefined();
  });

  it("keeps the other ai keys and other overrides", () => {
    const base = { forecast: { showSimulation: true }, ai: { peopleAllowed: true as const } };
    const on = withAiSwitch(base, "reviewAllWrites", true);
    expect(on).toEqual({ forecast: { showSimulation: true }, ai: { peopleAllowed: true, reviewAllWrites: true } });
    expect(on).not.toBe(base);
    expect(base.ai).toEqual({ peopleAllowed: true });
    expect(withAiSwitch(on, "reviewAllWrites", false)).toEqual(base);
  });
});

describe("the switches", () => {
  it("are off by default and on when stored", () => {
    expect(isReviewAllWrites(undefined)).toBe(false);
    expect(isRatesWithheld({})).toBe(false);
    expect(isReviewAllWrites({ ai: { reviewAllWrites: true } })).toBe(true);
    expect(isRatesWithheld({ ai: { ratesWithheld: true } })).toBe(true);
  });

  it("are forced by the deployment ids", () => {
    setDisabledIntegrations(["ai-direct-writes"]);
    expect(isReviewAllWritesForced()).toBe(true);
    expect(isReviewAllWrites(undefined)).toBe(true);
    expect(isRatesWithheld(undefined)).toBe(false);
    setDisabledIntegrations(["ai-rates"]);
    expect(isRatesWithheldForced()).toBe(true);
    expect(isRatesWithheld(undefined)).toBe(true);
    expect(isReviewAllWrites(undefined)).toBe(false);
  });

  it("parse from AIPM_DISABLED_INTEGRATIONS", () => {
    expect(parseDisabledIntegrations("ai-rates, ai-direct-writes")).toEqual(
      expect.arrayContaining(["ai-rates", "ai-direct-writes"]),
    );
    expect(parseDisabledIntegrations("ai-rates, ai-direct-writes")).toHaveLength(2);
  });
});

// The in-memory overrides and the reloaded ones must serialise byte for byte the same: the writers emit the `ai`
// object in the sanitiser's canonical order (peopleAllowed, reviewAllWrites, ratesWithheld) whatever order the
// switches were turned on in.
describe("the ai override's key order", () => {
  const roundTrip = (o: unknown) => JSON.stringify(sanitizeSettingsOverrides(JSON.parse(JSON.stringify(o))));
  it("matches the sanitised round trip after toggles in mixed order", () => {
    let o = withAiSwitch({ forecast: { showSimulation: true } }, "ratesWithheld", true);
    o = withPeopleAllowed(o, true);
    o = withAiSwitch(o, "reviewAllWrites", true);
    expect(Object.keys(o!.ai!)).toEqual(["peopleAllowed", "reviewAllWrites", "ratesWithheld"]);
    expect(JSON.stringify(o)).toBe(roundTrip(o));
    o = withAiSwitch(o, "reviewAllWrites", false);
    o = withAiSwitch(o, "reviewAllWrites", true);
    expect(JSON.stringify(o)).toBe(roundTrip(o));
    o = withPeopleAllowed(o, false);
    o = withPeopleAllowed(o, true);
    expect(JSON.stringify(o)).toBe(roundTrip(o));
  });
});
