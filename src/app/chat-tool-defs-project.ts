// src/app/chat-tool-defs-project.ts — Anthropic tool schemas for the project record (§715).
// Pure data; routing and the per-field judge live in chat-tools-project.ts and project-ai-fields.ts. Offered like
// every other entity write tool: always, with a read-only window refused by the dispatcher.

import { expectedTokenField } from "./chat-tools-updates";
import { NACE_SECTIONS } from "./nace-sections";
import { DEPLOYMENTS, IDENTITY_TYPES, REGULATORY_REQUIREMENTS } from "./project-options";
import { PROJECT_AI_FIELDS, type ProjectAiField } from "./project-ai-fields";

const text = (description?: string) => ({ type: "string" as const, ...(description ? { description } : {}) });
const count = { type: ["number", "string"], description: "A whole number of zero or more, or \"\" to clear it." };
const url = text("An http(s) address; \"\" clears it.");
const date = text("YYYY-MM-DD; \"\" clears it. The end date cannot be before the start date.");

// ★ A `Record` over `ProjectAiField`, so a field added to PROJECT_AI_FIELDS is a compile error here until it is
//   described, and the schema can never offer a field the judge does not know.
const FIELD_SCHEMAS: Record<ProjectAiField, object> = {
  name: text("Cannot be blank."),
  code: text(),
  description: text(),
  sponsor: text(),
  projectManager: text(),
  customer: text(),
  products: text(),
  platform: text(),
  profitCenter: text(),
  quotes: text(),
  notes: text(),
  docRepoLocation: text("Where the project's documents live."),
  startDate: date,
  endDate: date,
  regulatory: {
    type: "array" as const,
    items: { type: "string" as const, enum: [...REGULATORY_REQUIREMENTS] },
    description: "REPLACES the whole list. \"Not applicable\" stands alone.",
  },
  identityTypes: {
    type: "array" as const,
    items: { type: "string" as const, enum: [...IDENTITY_TYPES] },
    description: "REPLACES the whole list.",
  },
  deployment: { type: "string" as const, enum: [...DEPLOYMENTS, ""] },
  naceSection: { type: "string" as const, enum: [...NACE_SECTIONS.map((s) => s.code), ""] },
  identityCount: count,
  stakeholderCount: count,
  operatingTimezone: text("An IANA timezone, e.g. Europe/Berlin; \"\" clears it."),
  jiraUrl: url,
  salesforceUrl: url,
  sharepointUrl: url,
  confluenceUrl: url,
};

const FIELD_LIST = PROJECT_AI_FIELDS.join(", ");

export const PROJECT_TOOL_DEFS = [
  {
    name: "get_project",
    description:
      `Read this project's record: ${FIELD_LIST}. Returns those fields and an expectedToken for update_project.`,
    input_schema: { type: "object" as const, properties: {} },
  },
  {
    name: "update_project",
    description:
      `Change fields of this project's record: ${FIELD_LIST}. Requires the expectedToken from get_project. Only the fields you pass change. Contact persons, key-stakeholder lists and knowledge links are not editable here. Each field is judged on its own: one with a bad value keeps its stored value and is listed in refused with the reason, while the others are written; keys that are not project fields are listed in ignored. The result's project is the record as stored.`,
    input_schema: {
      type: "object" as const,
      properties: { ...expectedTokenField, ...FIELD_SCHEMAS },
      required: ["expectedToken"],
    },
  },
];
