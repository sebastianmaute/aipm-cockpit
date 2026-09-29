import { describe, expect, it, vi } from "vitest";
import { handOverRevision } from "./storage-handover";
import type { StorageBackend } from "./workspace";

class FakeA {
  kind = "browser" as const;
  load = vi.fn();
  save = vi.fn();
  isReady = vi.fn();
  adoptFrom = vi.fn();
  adoptRevision = vi.fn();
  constructor(private rev: string | null = "7") {}
  revision() { return this.rev; }
}
class FakeB extends FakeA {}

const asBackend = (b: FakeA) => b as unknown as StorageBackend;

describe("handOverRevision (§4 §645)", () => {
  it("uses adoptFrom between two instances of the same class", () => {
    const live = new FakeA(null);
    const from = new FakeA("7");
    handOverRevision(asBackend(live), asBackend(from));
    expect(live.adoptFrom).toHaveBeenCalledWith(from);
    expect(live.adoptRevision).not.toHaveBeenCalled();
  });

  it("falls back to the revision alone across classes", () => {
    const live = new FakeA(null);
    handOverRevision(asBackend(live), asBackend(new FakeB("9")));
    expect(live.adoptFrom).not.toHaveBeenCalled();
    expect(live.adoptRevision).toHaveBeenCalledWith("9");
  });

  it("falls back to the revision alone when the live instance has no adoptFrom", () => {
    const live = { kind: "browser", load: vi.fn(), save: vi.fn(), isReady: vi.fn(), adoptRevision: vi.fn() };
    handOverRevision(live as unknown as StorageBackend, asBackend(new FakeA("3")));
    expect(live.adoptRevision).toHaveBeenCalledWith("3");
  });

  it("leaves an unknown revision unknown", () => {
    const live = new FakeA(null);
    handOverRevision(asBackend(live), asBackend(new FakeB(null)));
    handOverRevision(asBackend(live), { kind: "turso" } as unknown as StorageBackend); // no revision API at all
    expect(live.adoptRevision).not.toHaveBeenCalled();
  });

  it("does nothing when both are the same instance", () => {
    const live = new FakeA("1");
    handOverRevision(asBackend(live), asBackend(live));
    expect(live.adoptFrom).not.toHaveBeenCalled();
    expect(live.adoptRevision).not.toHaveBeenCalled();
  });
});
