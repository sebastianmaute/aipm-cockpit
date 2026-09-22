import { describe, expect, it } from "vitest";
import { buildPatterns } from "./identifier-leak-lib.mjs";
import {
  countHitLines,
  countTrailerLines,
  identityVerdict,
  judge,
} from "./verify-rewrite.mjs";

// Fictional stand-ins only — never a real identifier in tracked text.
const patterns = buildPatterns(["@employer-name word:Globex", "@employer-domain globex.example"]);

describe("blob scan (countHitLines)", () => {
  it("counts every line carrying a planted identifier", () => {
    const text = "one Globex line\nclean line\nmail at x@globex.example\n";
    expect(countHitLines(text, patterns)).toBe(2);
  });

  it("returns zero for clean text", () => {
    expect(countHitLines("nothing here\nat all\n", patterns)).toBe(0);
  });

  it("honours the word boundary, so a longer word does not count", () => {
    expect(countHitLines("Globexian is not a hit", patterns)).toBe(0);
  });
});

describe("message scan (countTrailerLines)", () => {
  it("counts the session trailer and the assistant co-author line by KEY", () => {
    const msg = "feat: x\n\nbody\n\nClaude-Session: https://example.invalid/s\nCo-Authored-By: Claude Opus 5 <a@b.c>\n";
    expect(countTrailerLines(msg)).toBe(2);
  });

  it("does not count a message that merely names the assistant", () => {
    expect(countTrailerLines("feat: the Claude panel gets a new button\n")).toBe(0);
  });

  it("does not count a human co-author", () => {
    expect(countTrailerLines("Co-Authored-By: Jane Example <jane@example.com>\n")).toBe(0);
  });
});

describe("identity scan (identityVerdict)", () => {
  it("passes on exact set equality, ignoring case and angle brackets", () => {
    const v = identityVerdict(new Set(["<Me@Example.com>", "ci@x.invalid"]), ["me@example.com", "ci@x.invalid", ""]);
    expect(v).toEqual({ distinct: 2, unexpected: 0, missing: 0, equal: true });
  });

  it("fails on an identity nobody predicted", () => {
    const v = identityVerdict(new Set(["me@example.com", "planted@globex.example"]), ["me@example.com"]);
    expect(v.equal).toBe(false);
    expect(v.unexpected).toBe(1);
  });

  it("fails when an allowed identity is absent", () => {
    const v = identityVerdict(new Set(["me@example.com"]), ["me@example.com", "ci@x.invalid"]);
    expect(v.equal).toBe(false);
    expect(v.missing).toBe(1);
  });
});

describe("judge", () => {
  const eq = { equal: true };
  it("clean passes only when every substrate is empty and identities match", () => {
    expect(judge("clean", { blobHits: 0, messageHits: 0, trailerLines: 0, identities: eq })).toBe(true);
    expect(judge("clean", { blobHits: 1, messageHits: 0, trailerLines: 0, identities: eq })).toBe(false);
    expect(judge("clean", { blobHits: 0, messageHits: 1, trailerLines: 0, identities: eq })).toBe(false);
    expect(judge("clean", { blobHits: 0, messageHits: 0, trailerLines: 1, identities: eq })).toBe(false);
    expect(judge("clean", { blobHits: 0, messageHits: 0, trailerLines: 0, identities: { equal: false } })).toBe(false);
  });

  it("dirty (the positive control) needs nonzero blob AND message hits", () => {
    expect(judge("dirty", { blobHits: 3, messageHits: 2 })).toBe(true);
    expect(judge("dirty", { blobHits: 0, messageHits: 2 })).toBe(false);
    expect(judge("dirty", { blobHits: 3, messageHits: 0 })).toBe(false);
  });
});
