import { describe, it, expect, vi } from "vitest";
import { resolveEntitySave } from "./entity-id-mint";

type Row = { id: number };
const rows = (...ids: number[]): Row[] => ids.map((id) => ({ id }));

describe("resolveEntitySave", () => {
  it("known-create with a FREE id keeps the id and never mints", () => {
    const mint = vi.fn(() => 99);
    expect(resolveEntitySave(rows(1, 2), 5, true, mint)).toEqual({ create: true, id: 5 });
    expect(mint).not.toHaveBeenCalled();
  });

  it("known-create with a TAKEN id RE-MINTS so the append can't clobber the colliding row", () => {
    const mint = vi.fn(() => 6);
    // id 5 was committed by a concurrent writer since the modal opened.
    expect(resolveEntitySave(rows(1, 5), 5, true, mint)).toEqual({ create: true, id: 6 });
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("known-update keeps the id and never mints (even though the id exists)", () => {
    const mint = vi.fn(() => 99);
    expect(resolveEntitySave(rows(1, 5), 5, false, mint)).toEqual({ create: false, id: 5 });
    expect(mint).not.toHaveBeenCalled();
  });

  it("known-update of a MISSING id stays an update (trust the caller's intent)", () => {
    const mint = vi.fn(() => 99);
    expect(resolveEntitySave(rows(1, 2), 5, false, mint)).toEqual({ create: false, id: 5 });
    expect(mint).not.toHaveBeenCalled();
  });

  it("unknown intent falls back to id-existence: absent id => create", () => {
    const mint = vi.fn(() => 99);
    expect(resolveEntitySave(rows(1, 2), 5, undefined, mint)).toEqual({ create: true, id: 5 });
    expect(mint).not.toHaveBeenCalled();
  });

  it("unknown intent falls back to id-existence: present id => update (bulk/non-modal callers)", () => {
    const mint = vi.fn(() => 99);
    expect(resolveEntitySave(rows(1, 5), 5, undefined, mint)).toEqual({ create: false, id: 5 });
    expect(mint).not.toHaveBeenCalled();
  });
});
