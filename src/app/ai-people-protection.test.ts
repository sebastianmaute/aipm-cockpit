// The per-project "AI may see people" switch. Protected is the default and the
// stored form of "allowed" is `ai.peopleAllowed: true`; "protected" is absence.

import { afterEach, describe, expect, it } from "vitest";
import {
  isPeopleAiAllowedRaw,
  isPeopleProtected,
  isPeopleProtectionForced,
  withPeopleAllowed,
} from "./ai-people-protection";
import { parseDisabledIntegrations, setDisabledIntegrations } from "./integration-switches";
import { sanitizeSettingsOverrides } from "./settings-overrides";

afterEach(() => setDisabledIntegrations([]));

describe("isPeopleProtected", () => {
  it("is true by default", () => {
    expect(isPeopleProtected(undefined)).toBe(true);
    expect(isPeopleProtected({})).toBe(true);
  });

  it("is false once the project allows it", () => {
    expect(isPeopleProtected(withPeopleAllowed(undefined, true))).toBe(false);
    expect(isPeopleAiAllowedRaw(withPeopleAllowed(undefined, true))).toBe(true);
  });

  it("stays true when the deployment forces protection, whatever is stored", () => {
    setDisabledIntegrations(["ai-people"]);
    expect(isPeopleProtectionForced()).toBe(true);
    expect(isPeopleProtected(withPeopleAllowed(undefined, true))).toBe(true);
    expect(isPeopleAiAllowedRaw(withPeopleAllowed(undefined, true))).toBe(true);
  });
});

describe("withPeopleAllowed", () => {
  it("folds to undefined when turned back off", () => {
    expect(withPeopleAllowed(withPeopleAllowed(undefined, true), false)).toBeUndefined();
  });

  it("keeps other overrides and drops only ai", () => {
    const base = { forecast: { showSimulation: true } };
    const on = withPeopleAllowed(base, true);
    expect(on).toEqual({ forecast: { showSimulation: true }, ai: { peopleAllowed: true } });
    expect(withPeopleAllowed(on, false)).toEqual(base);
    expect(on).not.toBe(base);
  });
});

describe("sanitizeSettingsOverrides — ai", () => {
  it("drops a non-true peopleAllowed", () => {
    expect(sanitizeSettingsOverrides({ ai: { peopleAllowed: "yes" } })).toEqual({});
    expect(sanitizeSettingsOverrides({ ai: { peopleAllowed: false } })).toEqual({});
  });

  it("keeps peopleAllowed: true", () => {
    expect(sanitizeSettingsOverrides({ ai: { peopleAllowed: true } })).toEqual({ ai: { peopleAllowed: true } });
  });
});

describe("the ai-people deployment switch", () => {
  it("is a known integration id", () => {
    expect(parseDisabledIntegrations("ai-people")).toEqual(["ai-people"]);
  });
});
