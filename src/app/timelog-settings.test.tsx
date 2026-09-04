import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("./use-secrets", () => ({ saveSecretValue: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./timelog-api", () => ({
  listUsers: vi.fn(),
  getPrivileges: vi.fn(),
}));
import * as secrets from "./use-secrets";
import * as timelogApi from "./timelog-api";
import { TimelogSettings } from "./timelog-settings";
import { defaultTimelogConfig, type TimelogLinks, type TimelogPolicy } from "./timelog-types";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

describe("TimelogSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("seals the token via saveSecretValue on input", () => {
    let cfg = { ...defaultTimelogConfig, enabled: true };
    render(<TimelogSettings lang="en-US" config={cfg} onChange={(n) => (cfg = n)} />);
    fireEvent.change(screen.getByLabelText(t("en-US", "timelogToken")), {
      target: { value: "tok123" },
    });
    expect(secrets.saveSecretValue).toHaveBeenCalledWith("timelogApiToken", "tok123", "device");
  });

  it("hides config fields until enabled", () => {
    render(
      <TimelogSettings lang="en-US" config={defaultTimelogConfig} onChange={() => {}} />,
    );
    expect(screen.queryByLabelText(t("en-US", "timelogHost"))).toBeNull();
  });

  it("test() SUCCESS renders timelogTestOk", async () => {
    vi.mocked(timelogApi.listUsers).mockResolvedValue([
      { userId: 1, firstName: "Ada", lastName: "Lovelace", initials: "AL", email: "ada@example.com", isActive: true },
    ]);
    vi.mocked(timelogApi.getPrivileges).mockResolvedValue({ registrationAllTasks: false });

    const cfg = { ...defaultTimelogConfig, enabled: true, host: "h", tenant: "t", apiToken: "tok" };
    render(<TimelogSettings lang="en-US" config={cfg} onChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogTest") }));

    await screen.findByText(/1/);
  });

  it("test() FAILURE renders timelogTestFail", async () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    vi.mocked(timelogApi.listUsers).mockRejectedValue(err);
    vi.mocked(timelogApi.getPrivileges).mockResolvedValue({ registrationAllTasks: false });

    const cfg = { ...defaultTimelogConfig, enabled: true, host: "h", tenant: "t", apiToken: "tok" };
    render(<TimelogSettings lang="en-US" config={cfg} onChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "timelogTest") }));

    await screen.findByText(/401/);
  });

  it("renders timelogTokenInvalid warning when tokenInvalidAt is set", () => {
    const cfg = { ...defaultTimelogConfig, enabled: true, tokenInvalidAt: "2024-01-01T00:00:00Z" };
    render(<TimelogSettings lang="en-US" config={cfg} onChange={() => {}} />);
    expect(screen.getByText(t("en-US", "timelogTokenInvalid"))).toBeTruthy();
  });
});

const EMPTY_LINKS: TimelogLinks = { userLinks: [], projectLinks: [] };

const RULE_LABELS = [
  t("en-US", "insightTimelogCapPerEntryTitle"),
  t("en-US", "insightTimelogCapPerDayTitle"),
  t("en-US", "insightTimelogNonWorkingDayTitle"),
  t("en-US", "insightTimelogWorkingHoursTitle"),
] as const;

function renderGuardrails(policy?: TimelogPolicy, onLinksChange = vi.fn()) {
  const links: TimelogLinks = { ...EMPTY_LINKS, ...(policy ? { policy } : {}) };
  const view = render(
    <TimelogSettings
      lang="en-US"
      config={defaultTimelogConfig}
      onChange={vi.fn()}
      links={links}
      onLinksChange={onLinksChange}
    />,
  );
  return { onLinksChange, container: view.container };
}

describe("TimelogSettings guardrails", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders every rule off when no policy is configured", () => {
    renderGuardrails();
    for (const name of RULE_LABELS) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  // ★★ THE AXE GATE CANNOT SEE THIS, in any view at any seed size: of axe-core
  // 4.12.1's rules carrying the four tags `e2e/a11y.spec.ts` requests, NOT ONE
  // flags two controls sharing an accessible name. This unit test is the only
  // detector that can exist for WCAG 2.4.6 on this surface.
  it("gives every guardrail control a row-unique accessible name", () => {
    const { container } = renderGuardrails({
      timelogCapPerEntry: { enabled: true, threshold: 6 },
      timelogCapPerDay: { enabled: true, threshold: 10 },
    });
    // ★ MEASURED, not a guess: this fixture renders exactly 6 controls of these
    // roles — the four rule toggles, plus one threshold spinbutton for each of
    // the two ENABLED cap rules (a threshold field renders only while its rule
    // is on). Keep this at the measured value: a loose floor would let a
    // silently narrowed `roles` array back in unnoticed.
    // ★ `requireCollisionSeed` is deliberately OFF — this is a distinct-name
    // regression pin, not a claim to cover a shared-name collision, and the four
    // rule labels are four different i18n strings that cannot collide by seed.
    expectRowUniqueNames({ minControls: 6, scope: container, roles: ["button", "spinbutton"] });
  });

  it("enables a rule without inventing a threshold", () => {
    const { onLinksChange } = renderGuardrails();
    fireEvent.click(
      screen.getByRole("button", { name: t("en-US", "insightTimelogNonWorkingDayTitle") }),
    );
    expect(onLinksChange).toHaveBeenCalledWith(
      expect.objectContaining({ policy: { timelogNonWorkingDay: { enabled: true } } }),
    );
  });

  it("labels each threshold field, since a placeholder is not an accessible name", () => {
    renderGuardrails({
      timelogCapPerEntry: { enabled: true, threshold: 6 },
      timelogCapPerDay: { enabled: true, threshold: 10 },
    });
    expect(screen.getByRole("spinbutton", { name: t("en-US", "timelogEntryCapLabel") })).toHaveValue(6);
    expect(screen.getByRole("spinbutton", { name: t("en-US", "timelogDayCapLabel") })).toHaveValue(10);
  });

  it("renders no guardrail section when no workspace blob is threaded in", () => {
    render(<TimelogSettings lang="en-US" config={defaultTimelogConfig} onChange={vi.fn()} />);
    expect(screen.queryByText(t("en-US", "timelogGuardrailsTitle"))).toBeNull();
    for (const name of RULE_LABELS) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  // ★★ BYTE-STABILITY. `TimelogPolicy` is Partial by construction and
  // `sanitizeTimelogLinks` drops the `policy` key ONLY when no rule key is left
  // — a `{rule: {enabled: false}}` entry survives sanitising untouched. So this
  // writer must never leave one behind, or a workspace that merely had its
  // Settings opened stops serialising byte-identically to what it was before
  // this feature. A CONTROLLED harness, not two isolated renders: the round
  // trip is the property, and feeding the first call's output back in by hand
  // would prove nothing about what the component does with it.
  it("leaves no policy key behind when a rule is switched on and back off", () => {
    let seen: TimelogLinks = EMPTY_LINKS;
    function Harness() {
      const [links, setLinks] = useState<TimelogLinks>(EMPTY_LINKS);
      seen = links;
      return (
        <TimelogSettings
          lang="en-US"
          config={defaultTimelogConfig}
          onChange={vi.fn()}
          links={links}
          onLinksChange={setLinks}
        />
      );
    }
    render(<Harness />);
    const toggle = screen.getByRole("button", {
      name: t("en-US", "insightTimelogNonWorkingDayTitle"),
    });

    fireEvent.click(toggle);
    expect(seen.policy).toEqual({ timelogNonWorkingDay: { enabled: true } });

    fireEvent.click(toggle);
    expect("policy" in seen).toBe(false);
    expect(seen).toStrictEqual(EMPTY_LINKS);
  });

  it("keeps a threshold the user set on a rule they then switched off", () => {
    const { onLinksChange } = renderGuardrails({
      timelogCapPerDay: { enabled: true, threshold: 10 },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "insightTimelogCapPerDayTitle") }));
    expect(onLinksChange).toHaveBeenCalledWith(
      expect.objectContaining({ policy: { timelogCapPerDay: { enabled: false, threshold: 10 } } }),
    );
  });
});
