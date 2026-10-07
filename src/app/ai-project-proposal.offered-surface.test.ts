// src/app/ai-project-proposal.offered-surface.test.ts
//
// ★★★ THE OFFERED-SURFACE RELATION FOR `propose_project` (§445). The register
// tools' sweep (`plan.offered-surface-sweep.test.ts`) takes its axis from
// `TOOL_DEFS`, and `propose_project` is not a member, so that sweep says
// nothing about this write path. This file states the same property against the
// proposal's OWN seed schema, in two halves:
//
//   inert  a key the schema does not offer changes nothing: the seed built from
//          a fully populated row equals the seed built from that row trimmed to
//          the offered keys.
//   live   a key the schema offers is used: removing it from the row changes
//          the seed.
//
// ★★ NO EXEMPTION LIST, ON PURPOSE. "Inert" compares two OUTPUTS of the same
//  builder, so whatever the builder stamps of its own accord (ids, `today`,
//  defaults) appears on both sides and cancels. A key can only make the two
//  differ by being READ.
//
// ★★ A WHOLE-ROW REBUILD, NOT A PATCH. The register tools' `dropUnaccepted*`
//  guards are the wrong instrument here (the entry says why), and this file
//  does not use them: it asks only what the builder's output depends on.
import { describe, expect, it } from "vitest";

import {
  seedGuardedChange,
  seedGuardedMilestone,
  seedGuardedRaid,
  seedGuardedStakeholder,
  seedGuardedTask,
  seedResource,
} from "../test/inline-sweep-fixtures";
import { parseProposal, PROPOSAL_TOOL, proposalToSeed } from "./ai-project-proposal";
import { PRIORITIES } from "./types";

const TODAY = "2026-10-07";
const SEED_SCHEMAS = PROPOSAL_TOOL.input_schema.properties.seed.properties;
type SeedList = keyof typeof SEED_SCHEMAS;
const LISTS = Object.keys(SEED_SCHEMAS).sort() as SeedList[];

/** The keys the schema offers for one list — the axis, read off the tool. */
function offeredKeys(list: SeedList): string[] {
  return Object.keys(SEED_SCHEMAS[list].items.properties).sort();
}

/** A value for every OFFERED key, chosen so removing it is observable: none is
 *  the value the builder would fall back to on its own (`isExternal: true`,
 *  not the default `false`; priority "High", not the default "Medium"; RAID
 *  category "I", not the fallback "R"). The
 *  "names exactly the offered keys" case below keeps this in step with the
 *  schema, so a newly offered key turns this file red until it has a value. */
const OFFERED_SAMPLE: Readonly<Record<SeedList, Readonly<Record<string, unknown>>>> = {
  raid: {
    title: "Vendor slip",
    // Not "R": an omitted category falls back to it, which would hide the key.
    category: "I",
    owner: "Ada Lovelace",
    ownerEmail: "ada.lovelace@contoso.example",
    description: "The vendor may miss the integration window.",
    severity: "High",
  },
  changes: { title: "Extend the pilot", description: "Add two sites to the pilot." },
  milestones: { name: "Go-live", date: "2026-12-01" },
  stakeholders: {
    name: "Ada Lovelace",
    organization: "Contoso AG",
    title: "Head of Operations",
    email: "ada.lovelace@contoso.example",
  },
  tasks: {
    taskName: "Kick-off workshop",
    dueDate: "2026-10-20",
    notes: "Agree the goals.",
    assignee: "Ada Lovelace",
    priority: "High",
    group: "Discovery",
  },
  resources: {
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada.lovelace@contoso.example",
    title: "Head of Operations",
    department: "Operations",
    isExternal: true,
  },
};

/** A fully populated stored row per list — every persisted column with a value
 *  its sanitizer holds — from the sweep's own fixtures, so the two suites agree
 *  on what "fully populated" means. The id is dropped: a proposal item has none,
 *  and the builder mints its own. */
function storedRow(list: SeedList): Record<string, unknown> {
  const rows: Record<SeedList, () => object> = {
    raid: seedGuardedRaid,
    changes: seedGuardedChange,
    milestones: seedGuardedMilestone,
    stakeholders: seedGuardedStakeholder,
    tasks: seedGuardedTask,
    resources: seedResource,
  };
  const { id: _id, ...rest } = rows[list]() as Record<string, unknown>;
  void _id;
  return rest;
}

/** The populated row with every offered key set to its sample. */
function fullItem(list: SeedList): Record<string, unknown> {
  return { ...storedRow(list), ...OFFERED_SAMPLE[list] };
}

function pick(item: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(item).filter(([k]) => keys.includes(k)));
}

/** The seed one item produces, through the same two calls the wizard makes. */
function seedFrom(list: SeedList, item: Record<string, unknown>) {
  const proposal = parseProposal({ meta: { name: "x" }, features: [], seed: { [list]: [item] } });
  if (!proposal) throw new Error("parseProposal refused the envelope — the relation would compare nothing");
  return proposalToSeed(proposal, TODAY);
}

describe("propose_project's offered surface (§445)", () => {
  it("has a sample for exactly the keys each list offers", () => {
    for (const list of LISTS) {
      expect(Object.keys(OFFERED_SAMPLE[list]).sort(), `${list}: OFFERED_SAMPLE`).toEqual(offeredKeys(list));
    }
  });

  // ★ The schema writes the priority enum out as a literal (the tool object is
  //  `as const`); this keeps it from drifting off the app's own list.
  it("offers exactly the app's task priorities", () => {
    expect(SEED_SCHEMAS.tasks.items.properties.priority.enum).toEqual(PRIORITIES);
  });

  // ★★ The floor that keeps "inert" from passing over nothing: each list must
  //  send keys the schema does not offer, or the comparison below is between
  //  two identical inputs. Six lists, so a new one with no fixture fails here.
  it.each(LISTS)("%s: the populated row carries keys the schema does not offer", (list) => {
    const unoffered = Object.keys(fullItem(list)).filter((k) => !offeredKeys(list).includes(k));
    expect(unoffered.length, `${list}: no unoffered key to send`).toBeGreaterThanOrEqual(3);
  });

  it.each(LISTS)("%s inert: a key the schema does not offer changes nothing", (list) => {
    const full = fullItem(list);
    const trimmed = pick(full, offeredKeys(list));
    const fromTrimmed = seedFrom(list, trimmed);
    // Positive observable: the trimmed row is a valid item, so the comparison
    // below is between two real seeds and not two `undefined`s.
    expect(fromTrimmed?.[list], `${list}: the offered keys alone build no row`).toHaveLength(1);
    expect(seedFrom(list, full), `${list}: an unoffered key reached the seed`).toEqual(fromTrimmed);
  });

  it.each(LISTS)("%s live: every offered key is used", (list) => {
    const full = pick(fullItem(list), offeredKeys(list));
    const base = seedFrom(list, full);
    const unused = offeredKeys(list).filter((key) => {
      const { [key]: _gone, ...without } = full;
      void _gone;
      return JSON.stringify(seedFrom(list, without)) === JSON.stringify(base);
    });
    expect(unused, `${list}: offered keys the seed does not depend on`).toEqual([]);
  });
});
