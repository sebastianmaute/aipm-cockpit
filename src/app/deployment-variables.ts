// The settings a deployer puts in the server's (or the desktop app's) environment, in one list.
// A test walks the shipped source and fails when an `AIPM_` name is read that is neither registered
// here nor excluded with a reason, so the list cannot fall behind the code. The compliance pack
// renders its "deployment switches" table from it; each effect text is a statement about what the
// code does when the variable is set, so change a text when its call site changes.

import { INTEGRATION_IDS } from "./integration-switches";
import type { TranslationKey } from "./i18n";

export interface DeploymentVariable {
  name: string;
  /** Other spellings the code accepts as the same setting. */
  aliases: readonly string[];
  subsystem: "server" | "desktop";
  effectKey: TranslationKey;
  /** The values a comma list may name, when the setting takes a closed set. */
  values?: readonly string[];
}

export const DEPLOYMENT_VARIABLES: readonly DeploymentVariable[] = [
  { name: "AIPM_AI_GATEWAY_URL", aliases: [], subsystem: "server", effectKey: "deployVarAiGatewayUrl" },
  { name: "AIPM_AI_GATEWAY_TOKEN", aliases: [], subsystem: "server", effectKey: "deployVarAiGatewayToken" },
  { name: "AIPM_AI_ORGANIZATION_ID", aliases: [], subsystem: "server", effectKey: "deployVarAiOrganizationId" },
  { name: "AIPM_AI_WORKSPACE_IDS", aliases: [], subsystem: "server", effectKey: "deployVarAiWorkspaceIds" },
  {
    name: "AIPM_DISABLED_INTEGRATIONS",
    aliases: [],
    subsystem: "server",
    effectKey: "deployVarDisabledIntegrations",
    values: INTEGRATION_IDS,
  },
  { name: "AIPM_AI_CHAT_RETENTION_DAYS", aliases: [], subsystem: "server", effectKey: "deployVarAiChatRetentionDays" },
  { name: "AIPM_AI_CHAT_RECOVERY_PUBLIC_KEY", aliases: [], subsystem: "server", effectKey: "deployVarAiChatRecoveryPublicKey" },
  { name: "AIPM_CHAT_SWEEP_TURSO_URL", aliases: [], subsystem: "server", effectKey: "deployVarChatSweepTursoUrl" },
  { name: "AIPM_CHAT_SWEEP_TURSO_TOKEN", aliases: [], subsystem: "server", effectKey: "deployVarChatSweepTursoToken" },
  { name: "AIPM_DISABLE_UPDATE_CHECK", aliases: [], subsystem: "desktop", effectKey: "deployVarDisableUpdateCheck" },
];

/** `AIPM_` names the source mentions that a deployer does not set, each with the reason. */
export const DEPLOYMENT_VARIABLE_EXCLUSIONS: readonly { name: string; reason: string }[] = [
  {
    name: "AIPM_AI_",
    reason: "A name prefix, not a variable: the key-restriction check uses it to catch a misspelling of the two real names.",
  },
  {
    name: "AIPM_UPDATE_INSTALLER",
    reason: "Set by the desktop app itself to hand the installer path to its signature-check PowerShell child; never set by a deployer.",
  },
  {
    name: "AIPM_UPDATER_DRY_RUN",
    reason: "Set by the packaged-build smoke test to load the updater without checking for updates; not for a deployment.",
  },
];
