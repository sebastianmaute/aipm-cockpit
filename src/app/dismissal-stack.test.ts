import { beforeEach, describe, expect, it } from "vitest";
import {
  claimsEscape,
  escapeOwner,
  isTopmostOfKind,
  popDismissal,
  pushDismissal,
  resetDismissalStack,
} from "./dismissal-stack";

/** A KeyboardEvent stand-in. The module reads five fields and nothing else, so
 *  a cast object is honest here and keeps these tests DOM-free. */
function esc(over: Partial<KeyboardEvent> = {}): KeyboardEvent {
  return {
    key: "Escape",
    defaultPrevented: false,
    isComposing: false,
    keyCode: 27,
    ...over,
  } as KeyboardEvent;
}

describe("dismissal-stack", () => {
  beforeEach(() => resetDismissalStack());

  it("has no owner when empty", () => {
    expect(escapeOwner()).toBeNull();
  });

  it("gives Escape to the last-pushed entry", () => {
    const outer = Symbol("outer");
    const inner = Symbol("inner");
    pushDismissal(outer, "modal");
    pushDismissal(inner, "layer");
    expect(escapeOwner()).toBe(inner);
  });

  it("returns ownership to the layer beneath when the top pops", () => {
    const outer = Symbol("outer");
    const inner = Symbol("inner");
    pushDismissal(outer, "modal");
    pushDismissal(inner, "layer");
    popDismissal(inner);
    expect(escapeOwner()).toBe(outer);
  });

  it("removes only the last occurrence of a token", () => {
    const token = Symbol("dup");
    const other = Symbol("other");
    pushDismissal(token, "layer");
    pushDismissal(other, "layer");
    pushDismissal(token, "layer");
    popDismissal(token);
    // The earlier push survives, so `other` is not yet on top.
    expect(escapeOwner()).toBe(other);
  });

  it("ignores a pop for a token that was never pushed", () => {
    const live = Symbol("live");
    pushDismissal(live, "layer");
    popDismissal(Symbol("ghost"));
    expect(escapeOwner()).toBe(live);
  });

  it("walks past an entry that declines", () => {
    const modal = Symbol("modal");
    const panel = Symbol("panel");
    pushDismissal(modal, "modal");
    pushDismissal(panel, "layer", () => false);
    expect(escapeOwner()).toBe(modal);
  });

  it("has no owner when every entry declines", () => {
    pushDismissal(Symbol("a"), "layer", () => false);
    pushDismissal(Symbol("b"), "layer", () => false);
    expect(escapeOwner()).toBeNull();
  });

  it("treats a throwing predicate as declining rather than fatal", () => {
    const modal = Symbol("modal");
    pushDismissal(modal, "modal");
    pushDismissal(Symbol("broken"), "layer", () => {
      throw new Error("predicate blew up");
    });
    expect(escapeOwner()).toBe(modal);
  });

  it("asks a kind-scoped question for Tab containment", () => {
    const modal = Symbol("modal");
    const popover = Symbol("popover");
    pushDismissal(modal, "modal");
    pushDismissal(popover, "layer");
    // A popover above the modal owns Escape but must NOT take Tab containment.
    expect(escapeOwner()).toBe(popover);
    expect(isTopmostOfKind(modal, "modal")).toBe(true);
    expect(isTopmostOfKind(popover, "modal")).toBe(false);
  });

  it("reports no topmost of a kind that is absent", () => {
    const popover = Symbol("popover");
    pushDismissal(popover, "layer");
    expect(isTopmostOfKind(popover, "modal")).toBe(false);
  });

  describe("claimsEscape", () => {
    let token: symbol;
    beforeEach(() => {
      token = Symbol("token");
      pushDismissal(token, "layer");
    });

    it("claims a plain Escape for the owner", () => {
      expect(claimsEscape(esc(), token)).toBe(true);
    });

    it("declines for a non-owner", () => {
      expect(claimsEscape(esc(), Symbol("someone else"))).toBe(false);
    });

    it("declines a key that is not Escape", () => {
      expect(claimsEscape(esc({ key: "Tab" }), token)).toBe(false);
    });

    it("declines an Escape an element-scoped handler already took", () => {
      expect(claimsEscape(esc({ defaultPrevented: true }), token)).toBe(false);
    });

    it("declines while an IME composition owns the key", () => {
      expect(claimsEscape(esc({ isComposing: true }), token)).toBe(false);
    });

    it("declines on the legacy IME keyCode 229", () => {
      expect(claimsEscape(esc({ keyCode: 229 }), token)).toBe(false);
    });
  });
});
