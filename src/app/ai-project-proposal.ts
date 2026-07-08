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
  sanitizeChangeItem,
  sanitizeMilestone,
  sanitizeStakeholder,
  sanitizeTaskName,
  sanitizeAssignee,
  sanitizeIsoDate,
  sanitizePriority,
  sanitizeNotes,
  sanitizeGroup,
  sanitizeResource,
} from "./sanitize";

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

/** Validate one raw list: cap to SEED_CAP_PER_ENTITY, assign 1-based temp ids,
 *  run each record through its sanitizer, drop failures. */
function buildList<T>(raw: unknown[] | undefined, sanitize: (x: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  raw.slice(0, SEED_CAP_PER_ENTITY).forEach((item, i) => {
    const withId = isObj(item) ? { ...item, id: i + 1 } : item;
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
    notes: sanitizeNotes(raw.notes),
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
 *  stakeholders to the directory by name; unmatched owners stay plain strings. */
export function proposalToSeed(p: ProjectProposal, today: string): TemplateSeed | undefined {
  const s = p.seed;
  if (!s) return undefined;
  const raid = buildList(s.raid, sanitizeRaidItem);
  const changes = buildList(s.changes, sanitizeChangeItem);
  const milestones = buildList(s.milestones, sanitizeMilestone);
  const stakeholders = buildList(s.stakeholders, sanitizeStakeholder);
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
