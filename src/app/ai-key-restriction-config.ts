// SERVER-ONLY. Reads the deployment's Anthropic key restriction from the environment
// (AIPM_AI_ORGANIZATION_ID, AIPM_AI_WORKSPACE_IDS) on every call, like the gateway setting, so a
// restart applies a change and no rebuild is needed. Import this from `ai-gateway-config.ts`,
// `src/proxy.ts` and API routes only; a test pins that no client module imports it.
//
// The ids never reach a browser: the client learns only that a restriction exists
// (`AiDeploymentState.keyRestricted`). An invalid setting is logged on the server once per process
// per reason, naming the reason code only.

export const AI_ORGANIZATION_ID_ENV = "AIPM_AI_ORGANIZATION_ID";
export const AI_WORKSPACE_IDS_ENV = "AIPM_AI_WORKSPACE_IDS";

export type AiKeyRestrictionInvalidReason = "org-id" | "workspace-ids" | "workspaces-without-org";

export type AiKeyRestriction =
  | { kind: "none" }
  | {
      kind: "restricted";
      organizationId: string;
      /** `null` when any workspace of the organisation is allowed. */
      workspaceIds: readonly string[] | null;
      /** The two normalised values as one stable string; a change of either changes it. */
      signature: string;
    }
  | { kind: "invalid"; reason: AiKeyRestrictionInvalidReason };

type Env = Record<string, string | undefined>;

const ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The setting, parsed, with no side effect. Ids compare case-insensitively: all are lower-cased. */
export function parseAiKeyRestriction(env: Env): AiKeyRestriction {
  const org = env[AI_ORGANIZATION_ID_ENV]?.trim() ?? "";
  const rawWorkspaces = env[AI_WORKSPACE_IDS_ENV]?.trim() ?? "";
  if (!org && !rawWorkspaces) return { kind: "none" };
  if (!org) return { kind: "invalid", reason: "workspaces-without-org" };
  if (!ID_SHAPE.test(org)) return { kind: "invalid", reason: "org-id" };
  const organizationId = org.toLowerCase();
  if (!rawWorkspaces) {
    return { kind: "restricted", organizationId, workspaceIds: null, signature: `${organizationId}|` };
  }
  const items = rawWorkspaces.split(",").map((s) => s.trim());
  if (!items.every((s) => ID_SHAPE.test(s))) return { kind: "invalid", reason: "workspace-ids" };
  const workspaceIds = items.map((s) => s.toLowerCase());
  return { kind: "restricted", organizationId, workspaceIds, signature: `${organizationId}|${workspaceIds.join(",")}` };
}

/** Reasons already reported by this server process: each is logged once, not on every request. */
const reportedInvalid = new Set<AiKeyRestrictionInvalidReason>();

/** `parseAiKeyRestriction`, and an invalid setting tells the operator, once per process per reason,
 *  which part is invalid: the reason code only, never an id. */
export function readAiKeyRestriction(env: Env): AiKeyRestriction {
  const restriction = parseAiKeyRestriction(env);
  if (restriction.kind === "invalid" && !reportedInvalid.has(restriction.reason)) {
    reportedInvalid.add(restriction.reason);
    console.warn(`ai key restriction invalid: ${restriction.reason}`);
  }
  return restriction;
}
