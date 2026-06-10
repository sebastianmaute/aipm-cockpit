import type { IdentityType, Deployment, RegulatoryRequirement } from "./types";

export const IDENTITY_TYPES: readonly IdentityType[] = ["B2E", "B2B", "B2C", "NHI"];
export const DEPLOYMENTS: readonly Deployment[] = ["Cloud", "On-premise", "Hybrid"];
export const REGULATORY_REQUIREMENTS: readonly RegulatoryRequirement[] = [
  "Not applicable",
  "GDPR / data protection regulation",
  "DORA", "MaRisk", "BAIT", "NIS2", "HIPAA", "SOX",
  "EU AI Act",
  "Export control / sanctions compliance",
];
export const REGULATORY_NOT_APPLICABLE: RegulatoryRequirement = "Not applicable";

export const IDENTITY_TYPE_SET = new Set<string>(IDENTITY_TYPES);
export const DEPLOYMENT_SET = new Set<string>(DEPLOYMENTS);
export const REGULATORY_SET = new Set<string>(REGULATORY_REQUIREMENTS);
