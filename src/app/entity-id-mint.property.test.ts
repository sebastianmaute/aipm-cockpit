import { describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { resolveEntitySave } from "./entity-id-mint";

// `resolveEntitySave` guards the CLOBBER RACE fixed in 0.170.2: every register
// modal mints the new row's id at OPEN; between open and save a concurrent
// writer (the AI `create_*` tool, a second tab, a bulk op) can commit that id.
// A handler deciding create-vs-update by id-EXISTENCE then takes the REPLACE
// branch and map-replace silently destroys the concurrent row.
//
// The example suite in `entity-id-mint.test.ts` pins six hand-picked shapes.
// These properties cover the input SPACE those cannot: arbitrary list contents,
// arbitrary open-time ids, and — crucially — a MINTER that behaves like the real
// `nextId(list)` (max + 1) rather than a constant the assertion could not
// distinguish from a broken implementation.

type Row = { id: number };

// A deliberately NARROW id pool: with ids spread over a large range a randomly
// drawn `itemId` would essentially never collide with `existing`, and every
// collision-sensitive property below would pass vacuously.
const idArb = fc.integer({ min: 1, max: 30 });

const rowsArb = (minLength: number) =>
  fc
    .uniqueArray(idArb, { minLength, maxLength: 8 })
    .map((ids) => ids.map((id): Row => ({ id })));

// The generator is COLLISION-BIASED on purpose: 3 of every 4 non-empty cases
// draw `itemId` straight out of the list, so the contended path — the only one
// where the fix does any work — is exercised on most runs. The remaining draws
// come from the free pool (and may still collide by chance), keeping the
// uncontended path covered too.
const caseArb = (minLength: number) =>
  rowsArb(minLength).chain((rows) =>
    fc.record({
      rows: fc.constant(rows),
      itemId:
        rows.length === 0
          ? idArb
          : fc.oneof(
              { arbitrary: fc.constantFrom(...rows.map((r) => r.id)), weight: 3 },
              { arbitrary: idArb, weight: 1 },
            ),
    }),
  );

const anyCase = caseArb(0);
const contendedCase = caseArb(1);

const isNewArb = fc.constantFrom<boolean | undefined>(true, false, undefined);

// Models the REAL minter (`nextId(list)` = max id + 1), which is guaranteed
// free in `existing`. A constant minter would satisfy the safety property by
// luck on most inputs and would let a broken implementation slip through.
const makeMinter = (rows: readonly Row[]) => {
  let next = rows.reduce((max, r) => Math.max(max, r.id), 0) + 1;
  return vi.fn(() => next++);
};

const isTaken = (rows: readonly Row[], id: number) => rows.some((r) => r.id === id);

describe("entity-id-mint — properties", () => {
  it("SAFETY: a known-create never returns an id that already exists", () => {
    // THE property. This is what the 0.170.2 bug violated: the create was
    // routed onto a taken id, and the caller's map-replace then overwrote the
    // row the concurrent writer had just committed. Nothing else in this file
    // would catch a regression to that behaviour.
    let contended = 0;
    fc.assert(
      fc.property(contendedCase, ({ rows, itemId }) => {
        const mint = makeMinter(rows);
        const result = resolveEntitySave(rows, itemId, true, mint);

        expect(result.create).toBe(true);
        expect(isTaken(rows, result.id)).toBe(false);

        if (isTaken(rows, itemId)) {
          // The open-time id was taken since, so the returned id must be a
          // DIFFERENT, freshly minted one — not merely "some free id".
          expect(result.id).not.toBe(itemId);
          contended++;
        } else {
          expect(result.id).toBe(itemId);
        }
        return true;
      }),
      { numRuns: 50 },
    );

    // Vacuity guard: without collisions the assertion above is trivially true
    // for the buggy `return { create: true, id: itemId }` form as well.
    expect(contended).toBeGreaterThan(20);
  });

  it("an update always preserves the caller's id, whatever the intent", () => {
    // Callers replace the row AT this id. Re-minting on an update would move
    // the edit onto a row the user never opened.
    fc.assert(
      fc.property(anyCase, isNewArb, ({ rows, itemId }, isNew) => {
        const mint = makeMinter(rows);
        const result = resolveEntitySave(rows, itemId, isNew, mint);
        if (result.create) return true;
        expect(result.id).toBe(itemId);
        return true;
      }),
      { numRuns: 50 },
    );
  });

  it("INTENT DOMINATES: an explicit isNew decides create-vs-update, id-existence never does", () => {
    // The whole point of the fix. A modal knows whether it is creating; the
    // list state is a race-prone proxy for that and must not override it.
    let taken = 0;
    let free = 0;
    fc.assert(
      fc.property(anyCase, ({ rows, itemId }) => {
        expect(resolveEntitySave(rows, itemId, true, makeMinter(rows)).create).toBe(true);
        expect(resolveEntitySave(rows, itemId, false, makeMinter(rows)).create).toBe(false);
        if (isTaken(rows, itemId)) taken++;
        else free++;
        return true;
      }),
      { numRuns: 50 },
    );

    // Both sides of the id-existence split must be seen, or "existence never
    // decides" is only asserted over one of the two cases it has to cover.
    expect(taken).toBeGreaterThan(10);
    expect(free).toBeGreaterThan(5);
  });

  it("an absent isNew reproduces the legacy id-existence rule exactly", () => {
    // Bulk edit and other non-modal callers deliberately pass `undefined` and
    // depend on the pre-fix behaviour being byte-for-byte unchanged — they never
    // precompute an id, so there is no open-time id to be raced.
    let taken = 0;
    let free = 0;
    fc.assert(
      fc.property(anyCase, ({ rows, itemId }) => {
        const mint = makeMinter(rows);
        const result = resolveEntitySave(rows, itemId, undefined, mint);
        const legacyCreate = !isTaken(rows, itemId);
        expect(result.create).toBe(legacyCreate);
        // Legacy callers also never saw a re-mint: the id passes through
        // untouched on both branches (a create only reaches the minter when the
        // id was taken, which under this rule means it was an update).
        expect(result.id).toBe(itemId);
        expect(mint).not.toHaveBeenCalled();
        if (legacyCreate) free++;
        else taken++;
        return true;
      }),
      { numRuns: 50 },
    );

    expect(taken).toBeGreaterThan(10);
    expect(free).toBeGreaterThan(5);
  });

  it("mintId is called exactly once on a contended create and never otherwise", () => {
    // The minter has side effects in real callers (it advances the id counter
    // derived from live state), so a speculative call burns an id. It must fire
    // on the contended-create path and on no other.
    let contended = 0;
    let uncontended = 0;
    let updates = 0;
    fc.assert(
      fc.property(contendedCase, isNewArb, ({ rows, itemId }, isNew) => {
        const mint = makeMinter(rows);
        const result = resolveEntitySave(rows, itemId, isNew, mint);
        const wasTaken = isTaken(rows, itemId);

        if (result.create && wasTaken) {
          expect(mint).toHaveBeenCalledTimes(1);
          contended++;
        } else {
          expect(mint).not.toHaveBeenCalled();
          if (result.create) uncontended++;
          else updates++;
        }
        return true;
      }),
      { numRuns: 50 },
    );

    // All three branches must actually be visited or the "never otherwise" half
    // of this property is asserted over nothing.
    expect(contended).toBeGreaterThan(5);
    expect(uncontended).toBeGreaterThan(2);
    expect(updates).toBeGreaterThan(5);
  });

  it("an empty list always creates under the fallback and passes the id through", () => {
    // A fresh project. Nothing can be taken, so no intent, id or minter can
    // produce an update — and the freshly minted open-time id must survive.
    fc.assert(
      fc.property(idArb, (itemId) => {
        const mint = makeMinter([]);
        const undecided = resolveEntitySave<Row>([], itemId, undefined, mint);
        expect(undecided).toEqual({ create: true, id: itemId });

        const known = resolveEntitySave<Row>([], itemId, true, mint);
        expect(known).toEqual({ create: true, id: itemId });

        expect(mint).not.toHaveBeenCalled();
        return true;
      }),
      { numRuns: 50 },
    );
  });
});
