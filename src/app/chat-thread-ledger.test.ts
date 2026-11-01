import { describe, it, expect } from "vitest";
import { createChatThreadLedger } from "./chat-thread-ledger";

const A = "https://a.example";
const B = "https://b.example";

describe("createChatThreadLedger", () => {
  it("knows nothing at first", () => {
    const ledger = createChatThreadLedger();
    expect(ledger.isStored(A, "t1")).toBe(false);
    expect(ledger.isGone(A, "t1")).toBe(false);
    expect(ledger.cameFrom(A, "t1")).toBe(false);
    expect(ledger.sourceOf("t1")).toBeNull();
  });

  it("a load marks each thread stored in, and coming from, the database it read", () => {
    const ledger = createChatThreadLedger();
    ledger.recordLoaded(A, ["t1", "t2"]);
    expect(ledger.isStored(A, "t1")).toBe(true);
    expect(ledger.isStored(A, "t2")).toBe(true);
    expect(ledger.cameFrom(A, "t2")).toBe(true);
    expect(ledger.sourceOf("t1")).toBe(A);
    expect(ledger.isStored(B, "t1")).toBe(false);
    expect(ledger.cameFrom(B, "t1")).toBe(false);
  });

  it("stored and gone are kept per database", () => {
    const ledger = createChatThreadLedger();
    ledger.markStored(A, "t1");
    ledger.markGone(B, "t1");
    expect(ledger.isStored(A, "t1")).toBe(true);
    expect(ledger.isStored(B, "t1")).toBe(false);
    expect(ledger.isGone(B, "t1")).toBe(true);
    expect(ledger.isGone(A, "t1")).toBe(false);
  });

  it("marking a thread stored does not record where the in-memory copy came from", () => {
    const ledger = createChatThreadLedger();
    ledger.markStored(A, "t1");
    expect(ledger.sourceOf("t1")).toBeNull();
  });

  it("an id has one source: recording another database replaces the first", () => {
    const ledger = createChatThreadLedger();
    ledger.recordSource(A, "t1");
    ledger.recordLoaded(B, ["t1"]);
    expect(ledger.sourceOf("t1")).toBe(B);
    expect(ledger.cameFrom(B, "t1")).toBe(true);
    expect(ledger.cameFrom(A, "t1")).toBe(false);
    // Replacing the source leaves the other facts of the first database alone.
    ledger.markStored(A, "t1");
    ledger.recordSource(B, "t1");
    expect(ledger.isStored(A, "t1")).toBe(true);
  });

  it("an empty database URL is a database like any other", () => {
    const ledger = createChatThreadLedger();
    ledger.recordSource("", "t1");
    expect(ledger.cameFrom("", "t1")).toBe(true);
    expect(ledger.sourceOf("t1")).toBe("");
    expect(ledger.cameFrom(A, "t1")).toBe(false);
  });
});
