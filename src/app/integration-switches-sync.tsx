"use client";

// §762 — carries the deployment's switched-off integrations from the root layout
// (a server component that reads AIPM_DISABLED_INTEGRATIONS per request) into the
// client's `integration-switches` record. It records them during render, before
// its children render, so the first paint already hides what is switched off; the
// value is the same on the server render and on hydration.

import type { ReactNode } from "react";
import { setDisabledIntegrations, type IntegrationId } from "./integration-switches";

export function IntegrationSwitchesSync({ disabled, children }: { disabled: readonly IntegrationId[]; children: ReactNode }) {
  setDisabledIntegrations(disabled);
  return children;
}
