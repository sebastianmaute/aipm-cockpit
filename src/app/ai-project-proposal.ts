// Pure, i18n-free contract for the "Use AI" project-creation fast-path.
// Defines the proposal shape Claude returns (via a forced tool call) and the
// transforms that turn it into wizard inputs. No React, no fetch, no i18n.

import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import type { ProjectFormDraft } from "./project-form-fields";
import type { TemplateSeed } from "./templates";
import type { Resource, Task } from "./types";
import { isSafeHttpUrl } from "./document-link";
import {
  sanitizeRaidItem,
  sanitizeModelChangeItem,
  sanitizeMilestone,
  sanitizeStakeholder,
  sanitizeTaskName,
  sanitizeAssignee,
  sanitizeIsoDate,
  sanitizePriority,
  sanitizeGroup,
  sanitizeResource,
} from "./sanitize";
import { sanitizeAiRichText } from "./ai-rich-text";

export const SEED_CAP_PER_ENTITY = 8;

const MODULE_ID_SET = new Set<string>(ALL_MODULE_IDS);

/** The metadata fields Claude can reasonably infer from a free-text brief.
 *  Everything here maps onto a ProjectFormDraft patch — the user completes the
 *  remaining required fields (code, NACE, deployment, …) in the Step-1 form. */
export interface ProposalMeta {
  name: string;
  customer?: string;
  projectManager?: string;
  products?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  jiraUrl?: string;
}

/** Raw, unvalidated seed lists straight off the model. Each list is validated
 *  + capped in proposalToSeed; here they are deliberately loose. */
export interface ProposalSeed {
  raid?: unknown[];
  changes?: unknown[];
  milestones?: unknown[];
  stakeholders?: unknown[];
  tasks?: unknown[];
  resources?: unknown[];
}

export interface ProjectProposal {
  meta: ProposalMeta;
  features: FeatureModuleId[];
  seed?: ProposalSeed;
}

/** Anthropic tool definition. Invoked with tool_choice forcing this single tool
 *  so the model always emits one structured tool_use block (no JSON-from-text). */
export const PROPOSAL_TOOL = {
  name: "propose_project",
  description:
    "Propose the setup for a new project from the user's description. Call this exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      meta: {
        type: "object",
        properties: {
          name: { type: "string", description: "Concise project name." },
          customer: { type: "string" },
          projectManager: { type: "string" },
          products: { type: "string", description: "Products/services involved." },
          startDate: { type: "string", description: "ISO date YYYY-MM-DD." },
          endDate: { type: "string", description: "ISO date YYYY-MM-DD." },
          description: { type: "string" },
          jiraUrl: { type: "string" },
        },
        required: ["name"],
      },
      features: {
        type: "array",
        description: "Feature modules to enable.",
        items: { type: "string", enum: [...ALL_MODULE_IDS] },
      },
      seed: {
        type: "object",
        description: "Optional starter content. Omit any list you have nothing for.",
        properties: {
          raid: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                category: { type: "string", enum: ["R", "A", "I", "D"] },
                description: { type: "string" },
                severity: { type: "string", enum: ["Low", "Medium", "High", "Critical"] },
                // ★★★ DECLARED SO THE SEED FILTER PERMITS IT. `buildProposalSystemPrompt`
                //  asks the model to put an owner's exact name on any risk they own, and
                //  `remapSeed` links that name to the seeded directory row
                //  (`linkResource(r.owner, r.ownerEmail)`, `template-apply.ts`). While this
                //  was undeclared the filter stripped it and `ownerResourceId` was
                //  permanently `null` for every AI seed — the prompt asked for something the
                //  allowlist then threw away. Tasks kept `assignee` through the same prompt
                //  sentence only because `buildSeedTask` reads named fields and never spreads.
                // ★★ `ownerEmail` IS DECLARED TOO, and it is not redundant with `owner`:
                //  `linkResource` tries the EMAIL leg FIRST, so the address is the only
                //  thing that can pick between two seeded people who share a display
                //  name. The reasoning — and the wrong-link it prevents — lives above
                //  `SEED_OFFERED_KEYS`; do not restate it here.
                owner: {
                  type: "string",
                  description:
                    "Exact name of the team member who owns this, when the source names one — matching a name in the resources list. Do not invent one.",
                },
                ownerEmail: {
                  type: "string",
                  description:
                    "That owner's email address, when the source gives one — matching the email on their resources entry, and used to tell apart two people with the same name. Do not invent one.",
                },
              },
              required: ["title", "category"],
            },
          },
          changes: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" }, description: { type: "string" } },
              required: ["title"],
            },
          },
          milestones: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, date: { type: "string", description: "ISO date YYYY-MM-DD." } },
              required: ["name", "date"],
            },
          },
          stakeholders: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, organization: { type: "string" }, title: { type: "string" } },
              required: ["name"],
            },
          },
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: { taskName: { type: "string" }, dueDate: { type: "string" }, notes: { type: "string" } },
              required: ["taskName"],
            },
          },
          resources: {
            type: "array",
            description:
              "Named team members mentioned in the source. Use each person's exact name as the assignee/owner on any task/risk they own so they link to this directory entry.",
            items: {
              type: "object",
              properties: {
                firstName: { type: "string" },
                lastName: { type: "string" },
                email: { type: "string" },
                title: { type: "string" },
                department: { type: "string" },
                isExternal: { type: "boolean", description: "True for external/contractor resources." },
              },
              required: ["firstName", "lastName"],
            },
          },
        },
      },
    },
    required: ["meta", "features"],
  },
} as const;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** ★★★ THE SEED LISTS' ALLOWLIST, READ OFF `PROPOSAL_TOOL` ITSELF. The four
 *  `buildList` lists hand the model's raw item to their entity's LOAD sanitizer,
 *  and those sanitizers preserve far more than this tool ever declares — so
 *  before this filter a forced `propose_project` call could set ANY persisted
 *  column on a seeded row: `outlookEventId` (forging a calendar link),
 *  `localModifiedAt` (fabricating sync provenance), `inquiriesSent`, and a
 *  change's `decisionDate` on a pending `status`, which is precisely the pair
 *  `applyChangeStatus` exists to hold and which never runs on this path.
 *
 *  ★★ DERIVED, NEVER RETYPED, and that is the whole design. The axis is what the
 *  model is OFFERED, so a property added to a schema above is permitted the same
 *  day and one never offered can never arrive — a second hand-written list would
 *  drift from the schema silently, which is the defect class this closes.
 *
 *  ★ It is an ALLOWLIST over the keys the model SENDS, not a denylist of stored
 *  column names. The entity sanitizers read `knowledgeLinks ?? documentLinks`,
 *  so the input spelling and the stored spelling differ and a denylist naming
 *  stored columns would miss the alias. It also cannot miss a column nobody
 *  thought to name — `status`, `targetDate` and `type` are all undeclared too.
 *
 *  ★★★ THE COST OF THAT PROPERTY IS THAT A FIELD THE PROMPT ASKS FOR MUST BE
 *  DECLARED, AND ONE WAS NOT. `buildProposalSystemPrompt` tells the model to put
 *  an owner's exact name on any risk they own so `remapSeed` can link it to the
 *  seeded directory; `raid.owner` was undeclared, so this filter stripped it and
 *  `ownerResourceId` came out `null` on every AI seed. Declaring it (above) is
 *  the fix, and it is the design working — the axis is the schema, so the schema
 *  is where a wanted field is added. Before adding a list to `SEED_SCHEMAS` or a
 *  sentence to the prompt, check the other half agrees.
 *  ★★★ `raid.ownerEmail` IS DECLARED, and the argument that kept it out for a
 *  release was FALSE. It read that a declared email "would buy no link the name
 *  leg does not already make" and that "an email could not have disambiguated
 *  them" — both wrong, because `linkResource(name, email)` tries the EMAIL leg
 *  FIRST. `remapSeed` indexes `resByName` FIRST-WINS, so two seeded people
 *  sharing a display name collapse to whichever the model listed first:
 *  withholding the address did not leave the link ABSENT, it left it WRONG.
 *  `resolveRaidOwnerEmail` (`raid-inquiry.ts`) then prefers the LINKED row's
 *  address over the item's own, so "Send inquiry" mails risk detail to a person
 *  the source never named for that item — which is why this is a correctness
 *  fix and not a convenience. Pinned where it manifests, by "links a seeded RAID
 *  owner by EMAIL when two directory rows share a name".
 *  ★ Withholding it bought no safety either: `raidFields` (`chat-tool-defs.ts`)
 *  ALREADY offers `owner` and `ownerEmail` together on `create_raid_item` /
 *  `update_raid_item`, landing in the same `sanitizeRaidItem`. The seed path was
 *  the only place the pair was split.
 *  ★★ THE SURVIVING TRUE PART of the old paragraph: with no email supplied,
 *  linking is by NAME ONLY, and same-named rows still resolve first-wins by
 *  declaration order.
 *  ★★ `sanitizeEmail` is `sanitizeText(…, EMAIL_MAX)` — it trims and caps at 320
 *  and validates NOTHING, so this stores whatever string the model sent. The
 *  prompt's "Do not invent owners or emails" is the only thing asking for a real
 *  address, and the schema's own description repeats it. Do not read the
 *  sanitizer as a validator.
 *  ★★ `stakeholders.email` stays UNDECLARED — but NOT because the name leg
 *  suffices there. `linkResource(s.name, s.email)` gives the stakeholder leg the
 *  identical first-wins wrong-link exposure; it is simply outside this change.
 *
 *  ★★ Do NOT name the plain change sanitizer in this file, in a comment or
 *  otherwise: `sanitize-model-change-wiring.test.ts` asserts its bare name
 *  occurs here ZERO times, as the control for the repairing wrapper's count.
 *
 *  ★ CONSEQUENCE worth knowing before "simplifying" the changes call site: the
 *  repairing change sanitizer used there can no longer see `scheduleImpactDays`
 *  or `costImpact`, because the seed schema offers neither — so its numeric
 *  repair is now inert on THIS path. Keep the wrapper anyway: it is the correct
 *  sanitizer for model input and goes live the day the schema offers a number.
 *
 *  ★ `tasks` and `resources` are deliberately absent from the CALL SITES below
 *  (though present in this map): `buildSeedTask` / `buildSeedResource` assemble
 *  an object literal from named fields and never spread, so they are immune by
 *  construction and need no filter. */
const SEED_SCHEMAS = PROPOSAL_TOOL.input_schema.properties.seed.properties;
type SeedList = keyof typeof SEED_SCHEMAS;

/** ★★ BUILT BY REDUCE, NOT `Object.fromEntries`, AND THAT IS NOT A STYLE CHOICE.
 *  `Object.fromEntries` is typed to return `{ [k: string]: T }` whatever its
 *  input tuples say, and casting that to a Record over the KEY UNION is a
 *  TS2352 "neither type sufficiently overlaps" error — the compiler is right,
 *  the index signature guarantees none of the six keys. The advertised escape,
 *  `as unknown as`, silences it by throwing the check away.
 *  ★★ The union is worth keeping rather than widening to `Record<string, …>`,
 *  but NOT because a typo would fail OPEN — an earlier revision of this
 *  paragraph said it would turn the filter "OFF on that list, silently", and
 *  that is invented. What actually happens, measured: `tsconfig.json` sets
 *  `"strict": true`, and the upstream TS option `noUncheckedIndexedAccess` does not exist in it
 *  (`grep -c noUncheckedIndexedAccess tsconfig.json` → 0), so
 *  `SEED_OFFERED_KEYS.typo` on a string-keyed
 *  Record compiles as a NON-OPTIONAL `ReadonlySet<string>` and is `undefined` at
 *  runtime; `pickOfferedFields` then calls `offered.has(k)` with no guard, so the
 *  FIRST key of the first item throws a TypeError. Every seed item schema has a
 *  required property, so any non-empty item reaches one. That throw leaves
 *  `proposalToSeed`, so `runIngest` (`create-project-wizard.tsx`) never reaches
 *  its `setStep(1)` — a dead ingest, which is loud, and the OPPOSITE of a
 *  silently permissive filter. Only a zero-key item would quietly yield `{}`.
 *  The union is worth keeping because it turns that runtime throw into a COMPILE
 *  error, so the typo never ships — not because the runtime would be lenient. */
const SEED_OFFERED_KEYS = (Object.keys(SEED_SCHEMAS) as SeedList[]).reduce((acc, list) => {
  acc[list] = new Set<string>(Object.keys(SEED_SCHEMAS[list].items.properties));
  return acc;
}, {} as Record<SeedList, ReadonlySet<string>>);

/** Keep only the properties the tool offered for this list. Iterates the ITEM
 *  and keeps guarded keys — the shape `dropUnacceptedAbsenceFields` uses, not the
 *  iterate-the-guard-table shape, which by construction cannot see a key the
 *  table never registered. */
function pickOfferedFields(
  item: Record<string, unknown>, offered: ReadonlySet<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) if (offered.has(k)) out[k] = v;
  return out;
}

/** Narrow raw tool_use.input into a ProjectProposal. Requires a non-empty
 *  meta.name; drops unknown feature ids; passes seed lists through untouched
 *  (validation happens in proposalToSeed). Returns null when unusable. */
export function parseProposal(input: unknown): ProjectProposal | null {
  if (!isObj(input)) return null;
  const metaRaw = input.meta;
  if (!isObj(metaRaw)) return null;
  const name = typeof metaRaw.name === "string" ? metaRaw.name.trim() : "";
  if (!name) return null;

  const meta: ProposalMeta = { name };
  for (const k of ["customer", "projectManager", "products", "startDate", "endDate", "description", "jiraUrl"] as const) {
    const v = metaRaw[k];
    if (typeof v === "string" && v.trim()) meta[k] = v.trim();
  }

  const features = Array.isArray(input.features)
    ? (input.features.filter((f): f is FeatureModuleId => typeof f === "string" && MODULE_ID_SET.has(f)))
    : [];

  const seedRaw = isObj(input.seed) ? input.seed : undefined;
  const seed: ProposalSeed | undefined = seedRaw
    ? {
        raid: Array.isArray(seedRaw.raid) ? seedRaw.raid : undefined,
        changes: Array.isArray(seedRaw.changes) ? seedRaw.changes : undefined,
        milestones: Array.isArray(seedRaw.milestones) ? seedRaw.milestones : undefined,
        stakeholders: Array.isArray(seedRaw.stakeholders) ? seedRaw.stakeholders : undefined,
        tasks: Array.isArray(seedRaw.tasks) ? seedRaw.tasks : undefined,
        resources: Array.isArray(seedRaw.resources) ? seedRaw.resources : undefined,
      }
    : undefined;

  return { meta, features, seed };
}

/** Map the proposal's meta onto the Step-1 form draft. Only sets fields the
 *  model supplied; the form keeps its blank defaults for the rest and its own
 *  validation forces the user to complete required fields. */
export function proposalToDraftPatch(p: ProjectProposal): Partial<ProjectFormDraft> {
  const m = p.meta;
  const patch: Partial<ProjectFormDraft> = {};
  if (m.name) patch.name = m.name;
  if (m.customer) patch.customer = m.customer;
  if (m.projectManager) patch.projectManager = m.projectManager;
  if (m.products) patch.products = m.products;
  if (m.startDate) patch.startDate = m.startDate;
  if (m.endDate) patch.endDate = m.endDate;
  if (m.description) patch.description = m.description;
  // Defense-in-depth: model output is attacker-influenceable — reject a
  // javascript:/data: URL before it ever reaches the form field.
  if (m.jiraUrl && isSafeHttpUrl(m.jiraUrl)) patch.jiraUrl = m.jiraUrl;
  return patch;
}

/** Validate one raw list: cap to SEED_CAP_PER_ENTITY, drop every property the
 *  tool did not offer, assign 1-based temp ids, run each record through its
 *  sanitizer, drop failures.
 *
 *  ★★ ORDER: filter FIRST, stamp `id` after. `id` is not in any seed item schema
 *  — filtering a stamped record would strip it and every sanitizer would then
 *  refuse the row (they all require a positive id), emptying the seed. A model's
 *  own `id` is dropped by the filter and replaced here, as before. */
function buildList<T>(
  raw: unknown[] | undefined, offered: ReadonlySet<string>, sanitize: (x: unknown) => T | null,
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  raw.slice(0, SEED_CAP_PER_ENTITY).forEach((item, i) => {
    const withId = isObj(item) ? { ...pickOfferedFields(item, offered), id: i + 1 } : item;
    const s = sanitize(withId);
    if (s) out.push(s);
  });
  return out;
}

function buildSeedTask(raw: unknown, id: number, today: string): Task | null {
  if (!isObj(raw)) return null;
  const taskName = sanitizeTaskName(raw.taskName ?? raw.name);
  if (!taskName) return null;
  return {
    id,
    taskName,
    assignee: sanitizeAssignee(raw.assignee),
    assigneeEmail: "",
    dueDate: sanitizeIsoDate(raw.dueDate),
    lastUpdateDate: today,
    priority: sanitizePriority(raw.priority),
    status: "To Do",
    blockers: "",
    // ★★★ Upgrade-aware, NOT plainToHtml. This is the most attacker-influenceable
    // input in the app — the model's propose_project output, fed from a
    // user-uploaded PDF / SharePoint file / Confluence page — and plainToHtml
    // escapes & < >, so any HTML the model emits stored as visible tags.
    // ★ `notes` is correct HERE: PROPOSAL_TOOL's task schema advertises `notes`,
    // so that is the key the model is asked for. See AGENTS.md, rich-text bullet.
    description: sanitizeAiRichText(raw.notes),
    inquiriesSent: 0,
    group: sanitizeGroup(raw.group),
    labels: [],
  };
}

/** Bound free-form model strings that the resource sanitizer stores uncapped
 *  (title/department go through the length-less optText path). */
function clipSeedText(v: unknown): string | undefined {
  return typeof v === "string" ? v.slice(0, 200) : undefined;
}

function buildSeedResource(raw: unknown, id: number): Resource | null {
  if (!isObj(raw)) return null;
  return sanitizeResource({
    id,
    firstName: raw.firstName,
    lastName: raw.lastName,
    email: raw.email,
    title: clipSeedText(raw.title),
    department: clipSeedText(raw.department),
    isExternal: raw.isExternal,
    // A fresh project has no rate card yet, so a role can't be assigned here.
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
  });
}

/** Turn the proposal's seed into a validated TemplateSeed (or undefined when no
 *  usable content). Seeded resources let remapSeed link task/RAID owners +
 *  stakeholders to the directory by name; unmatched owners stay plain strings.
 *  ★ BY NAME ONLY, and that is a property of THIS producer, not of `remapSeed`:
 *  `linkResource` also takes an email, but no seed item schema declares one
 *  (`raid.ownerEmail`, `stakeholders.email` — see the `SEED_OFFERED_KEYS` note),
 *  so the filter drops it and only the name leg can ever fire on this path. */
export function proposalToSeed(p: ProjectProposal, today: string): TemplateSeed | undefined {
  const s = p.seed;
  if (!s) return undefined;
  const raid = buildList(s.raid, SEED_OFFERED_KEYS.raid, sanitizeRaidItem);
  // ★ The MODEL-input sanitizer, not the plain one: this seed is model-authored,
  //  so a `1.5` day count is repaired to 2 rather than stored verbatim (which is
  //  what the plain sanitizer now does, correctly, for a LOAD).
  const changes = buildList(s.changes, SEED_OFFERED_KEYS.changes, sanitizeModelChangeItem);
  const milestones = buildList(s.milestones, SEED_OFFERED_KEYS.milestones, sanitizeMilestone);
  const stakeholders = buildList(s.stakeholders, SEED_OFFERED_KEYS.stakeholders, sanitizeStakeholder);
  const resources: Resource[] = Array.isArray(s.resources)
    ? s.resources
        .slice(0, SEED_CAP_PER_ENTITY)
        .map((r, i) => buildSeedResource(r, i + 1))
        .filter((r): r is Resource => r !== null)
    : [];
  const tasks: Task[] = Array.isArray(s.tasks)
    ? s.tasks
        .slice(0, SEED_CAP_PER_ENTITY)
        .map((t, i) => buildSeedTask(t, i + 1, today))
        .filter((t): t is Task => t !== null)
    : [];

  const seed: TemplateSeed = {};
  if (raid.length) seed.raid = raid;
  if (changes.length) seed.changes = changes;
  if (milestones.length) seed.milestones = milestones;
  if (stakeholders.length) seed.stakeholders = stakeholders;
  if (resources.length) seed.resources = resources;
  if (tasks.length) seed.tasks = tasks;
  return seedHasContent(seed) ? seed : undefined;
}

/** True when a seed carries at least one row in any list. */
export function seedHasContent(seed: TemplateSeed | undefined): boolean {
  if (!seed) return false;
  return Object.values(seed).some((v) => Array.isArray(v) && v.length > 0);
}

/** System prompt for the proposal call. English + the module catalog; not the
 *  chat assistant prompt and not operating-guide grounded (no active context at
 *  creation time). */
export function buildProposalSystemPrompt(): string {
  return [
    "You are a senior project manager helping set up a new project tracker.",
    "From the user's description, call the propose_project tool EXACTLY ONCE.",
    "Infer a concise name and any metadata you can; leave fields you cannot infer unset.",
    "Choose the feature modules that fit the project from this set:",
    ALL_MODULE_IDS.join(", ") + ".",
    "Optionally propose a small amount of realistic starter content (a few risks/issues,",
    "milestones, key stakeholders, opening tasks) — at most a handful of each. Omit a list",
    "if you have nothing concrete. Use ISO dates (YYYY-MM-DD). Do not invent owners or emails.",
    "When the source names specific team members, add them to the resources list (first/last",
    "name, external flag if they are a contractor) and use their exact name as the assignee or",
    "owner on any task or risk they own, so they populate the directory rather than existing",
    "only as free-text names.",
  ].join(" ");
}
