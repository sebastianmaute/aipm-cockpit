// Direct unit tests for describeUpstreamError (§566/§607). Every call site
// (Jira, Timelog, ECB) exercises this only through its own console.error site,
// so those tests pin the SHAPE of what gets logged but not every branch of the
// function itself (an err that isn't an Error instance, a cause with a
// non-string `.code`, a cause that isn't an Error). Testing it directly here is
// the only way to pin those branches.
import { describe, expect, it } from "vitest";
import { describeUpstreamError } from "./upstream-error";

describe("describeUpstreamError", () => {
  it("returns just the message for an Error with no cause", () => {
    expect(describeUpstreamError(new Error("boom"))).toEqual({ message: "boom" });
  });

  it("extracts an Error cause's message and omits code when the cause carries none", () => {
    const err = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED") });
    const out = describeUpstreamError(err);
    // toStrictEqual (not toEqual): toEqual ignores keys whose value is `undefined`, so it cannot
    // tell "no `code` key" from "a `code: undefined` key" — a mutant that always spread `{ code }`
    // instead of the conditional `...(code ? { code } : {})` would pass a toEqual assertion here.
    expect(out).toStrictEqual({ message: "fetch failed", cause: "connect ECONNREFUSED" });
    expect("code" in out).toBe(false);
  });

  it("extracts an Error cause's message AND a string .code when both are present", () => {
    const cause = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const err = new TypeError("fetch failed", { cause });
    expect(describeUpstreamError(err)).toEqual({
      message: "fetch failed",
      cause: "connect ECONNREFUSED",
      code: "ECONNREFUSED",
    });
  });

  it("coerces a non-Error cause with String() and omits code", () => {
    const err = new TypeError("fetch failed", { cause: "socket hang up" });
    const out = describeUpstreamError(err);
    // toStrictEqual, not toEqual — see the comment on the analogous test above.
    expect(out).toStrictEqual({ message: "fetch failed", cause: "socket hang up" });
    expect("code" in out).toBe(false);
  });

  it("ignores a non-string .code on a non-Error cause", () => {
    const err = new TypeError("fetch failed", { cause: { code: 500 } });
    const out = describeUpstreamError(err);
    expect(out.code).toBeUndefined();
    expect(out.cause).toBe(String({ code: 500 }));
  });

  it("coerces a non-Error err with String()", () => {
    expect(describeUpstreamError("plain string rejection")).toEqual({
      message: "plain string rejection",
    });
    expect(describeUpstreamError(404)).toEqual({ message: "404" });
  });

  it("never returns the raw error instance", () => {
    const out = describeUpstreamError(new Error("boom"));
    expect(out).not.toBeInstanceOf(Error);
  });
});
