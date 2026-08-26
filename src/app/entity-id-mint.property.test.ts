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

// `idArb` tops out at 30 and `rowsArb` caps at 8 rows, so 31 is free in EVERY
// draw and `freeIds` always returns at least 23 members — the constructions
// below can therefore always find a genuinely-free id, including for an empty
// row list where every id is free.
const FREE_ID_CEILING = 31;

const freeIds = (rows: readonly Row[]): number[] => {
  const taken = new Set(rows.map((r) => r.id));
  const free: number[] = [];
  for (let id = 1; id <= FREE_ID_CEILING; id++) if (!taken.has(id)) free.push(id);
  return free;
};

type Branch = "contended" | "uncontended" | "update";

const branchArb = fc.constantFrom<Branch>("contended", "uncontended", "update");

// ★★★ BRANCH-TAGGED, AND THAT IS WHAT MAKES THE THREE-BRANCH FLOORS SAFE. That
// test used to rely on `caseArb`'s collision bias to visit all three branches by
// luck: `uncontended` needs a FREE id AND an intent that means create, p ≈ 0.145,
// mean ≈ 7 over 50 runs — and it drew ZERO in 0.058% of suite runs (measured,
// 40,000 pooled trials). That is what took the 0.259.0 release pipeline red, on a
// BLOCKING gate, on a tree that could not have caused it.
//
// Drawing the branch FIRST and constructing a case to match makes each branch
// p = 1/3 by construction, so P(a branch is never visited in 50 runs) is
// (2/3)^50 = 1.6e-9. The floor is then a fact about this arbitrary rather than a
// bet on the generator — the cure `sanitize-core.property.test.ts`'s
// `midPairCutArb` already applies.
//
// ★ The rows, ids and (where more than one qualifies) the intent inside each
// branch are still drawn randomly, so this NARROWS nothing: it fixes WHICH
// branch a draw lands in, not what the branch contains. Every (rows, itemId,
// isNew) combination the old `contendedCase` × `isNewArb` pair could produce is
// still reachable here, and the uncontended branch is WIDER than before — it now
// always gets a genuinely free id, which the old generator reached only by
// chance.
//
// ★★ `isNew: undefined` on a TAKEN id is an UPDATE, not a contended create
// (`create = isNew ?? !taken`), so it belongs on the update branch and the
// contended branch pins `isNew: true`. Admitting `undefined` there instead would
// send half that branch's draws to `updates` and drop p(contended) to 1/6 —
// P(zero in 50) = 1.1e-4, WORSE than the floor it is meant to secure.
//
// ★ `branch` is carried on the record though no assertion reads it: it is what
// makes a shrunk counterexample legible for a branch-tagged arbitrary.
const taggedCase = rowsArb(1).chain((rows) => {
  const takenIds = rows.map((r) => r.id);
  const free = freeIds(rows);
  return branchArb.chain((branch) => {
    const tag = { rows: fc.constant(rows), branch: fc.constant<Branch>(branch) };
    if (branch === "contended") {
      // A create whose open-time id was committed by someone else since.
      return fc.record({
        ...tag,
        itemId: fc.constantFrom(...takenIds),
        isNew: fc.constant<boolean | undefined>(true),
      });
    }
    if (branch === "uncontended") {
      // A create whose open-time id is still free — reached by BOTH intents
      // that mean create, since the legacy rule creates on a free id too.
      return fc.record({
        ...tag,
        itemId: fc.constantFrom(...free),
        isNew: fc.constantFrom<boolean | undefined>(true, undefined),
      });
    }
    // Every way to reach an update: an explicit `false` at ANY id, free or
    // taken, plus the legacy `undefined` at a taken one.
    return fc.oneof(
      fc.record({
        ...tag,
        itemId: fc.constantFrom(...takenIds, ...free),
        isNew: fc.constant<boolean | undefined>(false),
      }),
      fc.record({
        ...tag,
        itemId: fc.constantFrom(...takenIds),
        isNew: fc.constant<boolean | undefined>(undefined),
      }),
    );
  });
});

type Existence = "taken" | "free";

// ★★★ THE SAME CURE FOR THE TWO `free > 5` FLOORS, WEIGHTED RATHER THAN EVEN.
// Both tests below split on whether `itemId` is already taken and floor each
// side. Under `anyCase` those counters rode the same 3:1 collision bias: `free`
// had mean 15.70 and landed at or below its floor of 5 in 0.028% of suite runs
// (measured, 40,000 pooled trials). Drawing the existence FIRST removes the bet.
//
// ★★ THE WEIGHTS ARE 11:9 AND THAT IS ARITHMETIC, NOT TASTE. The two floors are
// ASYMMETRIC — `taken > 10` and `free > 5` — so with `taken + free === 50` the
// safe window is 11 ≤ taken ≤ 44, whose centre is 27.5, i.e. p(taken) = 0.55.
// An even 1:1 split would centre `taken` at 25 and push P(taken ≤ 10) to
// 1.2e-5, DEGRADING a floor that measured 0/20000 today, to buy a `free` floor
// far tighter than it needs. At 11:9 both tails are tiny: P(taken ≤ 10) =
// 4.3e-7 and P(free ≤ 5) = 9.3e-8 (exact binomial, n = 50).
//
// ★ It narrows nothing. The taken branch needs a non-empty list to draw a taken
// id FROM, but an empty list can only ever yield a free id anyway, so the free
// branch keeps `rowsArb(0)` and with it every empty-list case `anyCase` covered.
// The support is a strict SUPERSET of `anyCase`'s: any (rows, itemId) pair it
// could draw is reachable through exactly one of these two branches, and the
// free branch additionally reaches id 31.
const existenceCase = fc
  .oneof(
    { arbitrary: fc.constant<Existence>("taken"), weight: 11 },
    { arbitrary: fc.constant<Existence>("free"), weight: 9 },
  )
  .chain((existence) =>
    (existence === "taken" ? rowsArb(1) : rowsArb(0)).chain((rows) =>
      fc.record({
        rows: fc.constant(rows),
        existence: fc.constant<Existence>(existence),
        itemId:
          existence === "taken"
            ? fc.constantFrom(...rows.map((r) => r.id))
            : fc.constantFrom(...freeIds(rows)),
      }),
    ),
  );

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
    //
    // ★ This one deliberately KEEPS the unconstructed `anyCase` × `isNewArb`
    // pair: it carries no anti-vacuity floor, so nothing here is a bet, and it
    // is the breadth companion to the constructed arbitraries above — the same
    // arrangement `sanitize-core.property.test.ts` keeps beside `midPairCutArb`.
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
      fc.property(existenceCase, ({ rows, itemId }) => {
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
    //
    // ★★ THESE ARE NOW CONSTRUCTED FACTS, NOT BETS. `existenceCase` draws the
    // existence FIRST at 11:9, so `taken` ~ Binom(50, 0.55) and `free` is its
    // complement: P(taken ≤ 10) = 4.3e-7 and P(free ≤ 5) = 9.3e-8 (exact
    // binomial). Under the old `anyCase` the same `free` floor rode the
    // generator's collision bias — mean 15.70, at or below 5 in 0.028% of suite
    // runs (measured, 40,000 pooled trials), across two blocking jobs per pipeline.
    //
    // ★ Do NOT tighten either floor and do NOT raise numRuns: a bigger sample
    // against an unchanged absolute floor is a WEAKER guard, not a safer run,
    // and raising a floor re-opens the tail this construction just closed. The
    // counting stays CONDITIONAL on the real predicate so that if the arbitrary
    // ever regresses the counter drops and these floors still catch it.
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
      fc.property(existenceCase, ({ rows, itemId }) => {
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

    // Same construction, same guarantee as the test above: `existenceCase`
    // draws the existence FIRST at 11:9, so P(taken ≤ 10) = 4.3e-7 and
    // P(free ≤ 5) = 9.3e-8 (exact binomial, n = 50). Under the old `anyCase`
    // this `free` floor sat at 0.028% per suite run (measured, 40,000 pooled trials).
    // Do NOT tighten either floor and do NOT raise numRuns — a bigger sample
    // against an unchanged absolute floor is a weaker guard, not a safer run.
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
      fc.property(taggedCase, ({ rows, itemId, isNew }) => {
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
    //
    // ★★ THE FLOORS ARE `> 0` AND THAT IS NOW A CONSTRUCTED FACT, NOT A BET.
    // `taggedCase` draws the branch first, so each has p = 1/3 and
    // P(a branch is never visited in 50 runs) = (2/3)^50 = 1.6e-9. Before the
    // branch tag the same floors rode the generator's collision bias:
    // `uncontended` had p ≈ 0.145, mean 7.05, and drew zero in 0.058% of suite
    // runs (measured, 40,000 pooled trials), which is what took a release pipeline red.
    //
    // ★ Do NOT "tighten" these to a larger number and do NOT raise numRuns —
    // a bigger sample against an unchanged absolute floor is a WEAKER guard,
    // not a safer run. Their job is to prove each branch was REACHED, and at
    // 1.6e-9 they do that.
    expect(contended).toBeGreaterThan(0);
    expect(uncontended).toBeGreaterThan(0);
    expect(updates).toBeGreaterThan(0);
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
