import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { IntegrationSwitchesSync } from "./integration-switches-sync";
import { currentAiRoute, getAiDeploymentState, setAiDeploymentState, type AiDeploymentState } from "./ai-deployment";
import { DIRECT_AI_STATUS } from "../test/ai-status-fetch";
import { isIntegrationDisabled, setDisabledIntegrations } from "./integration-switches";

// What the child saw at ITS render, i.e. whether the record was already set before children render.
const seen: boolean[] = [];
function Probe({ record }: { record: (v: boolean) => void }) {
  const v = isIntegrationDisabled("jira");
  record(v);
  return <span data-testid="probe">{String(v)}</span>;
}
const record = (v: boolean) => { seen.push(v); };
const lastSeen = () => seen[seen.length - 1];

afterEach(() => {
  setDisabledIntegrations([]);
  seen.length = 0;
});

const AI: AiDeploymentState = { off: false, route: "direct", invalid: false, keyRestricted: false };

describe("§762 — IntegrationSwitchesSync", () => {
  it("§762 — disabled={[]} leaves jira enabled for the child (positive control)", () => {
    render(<IntegrationSwitchesSync disabled={[]} ai={AI}><Probe record={record} /></IntegrationSwitchesSync>);
    expect(lastSeen()).toBe(false);
    expect(screen.getByTestId("probe").textContent).toBe("false");
  });

  it("§762 — disabled={[\"jira\"]} is recorded BEFORE the child renders", () => {
    render(<IntegrationSwitchesSync disabled={["jira"]} ai={AI}><Probe record={record} /></IntegrationSwitchesSync>);
    expect(lastSeen()).toBe(true);
    expect(screen.getByTestId("probe").textContent).toBe("true");
  });

  it("§762 — a later disabled={[]} clears what an earlier render recorded", () => {
    const { rerender } = render(<IntegrationSwitchesSync disabled={["jira"]} ai={AI}><Probe record={record} /></IntegrationSwitchesSync>);
    expect(isIntegrationDisabled("jira")).toBe(true);
    rerender(<IntegrationSwitchesSync disabled={[]} ai={AI}><Probe record={record} /></IntegrationSwitchesSync>);
    expect(isIntegrationDisabled("jira")).toBe(false);
    expect(lastSeen()).toBe(false);
  });
});

// layout.tsx is an async server component (headers(), next/font) and no test renders it, so the wiring is
// pinned at source level: the env value is parsed per request and handed to the sync wrapper around {children}.
describe("IntegrationSwitchesSync records the deployment's AI state", () => {
  afterEach(() => setAiDeploymentState(DIRECT_AI_STATUS));

  it("a gateway state reaches the client store before the child renders", () => {
    const GATEWAY: AiDeploymentState = { off: false, route: "gateway", invalid: false, keyRestricted: false };
    const routes: string[] = [];
    function RouteProbe() {
      routes.push(currentAiRoute());
      return null;
    }
    render(<IntegrationSwitchesSync disabled={[]} ai={GATEWAY}><RouteProbe /></IntegrationSwitchesSync>);
    expect(getAiDeploymentState()).toEqual(GATEWAY);
    expect(currentAiRoute()).toBe("gateway");
    expect(routes.at(-1)).toBe("gateway");
  });
});

describe("§762 — layout.tsx wiring (source pin)", () => {
  const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8").split("\r").join("");
  it("§762 — parses AIPM_DISABLED_INTEGRATIONS from process.env inside the request-time component", () => {
    const fn = layout.slice(layout.indexOf("export default async function RootLayout"));
    expect(fn).toMatch(/const disabledIntegrations = parseDisabledIntegrations\(process\.env\[DISABLED_INTEGRATIONS_ENV\]\);/);
  });
  it("§762 — wraps {children} in IntegrationSwitchesSync fed that parsed list", () => {
    const m = layout.match(/<IntegrationSwitchesSync disabled=\{disabledIntegrations\} ai=\{aiDeployment\}>([\s\S]*?)<\/IntegrationSwitchesSync>/);
    expect(m).not.toBeNull();
    expect(m![1]).toContain("{children}");
  });
});
