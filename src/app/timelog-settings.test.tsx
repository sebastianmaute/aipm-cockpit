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
import { loadI18n, t } from "./i18n";
import { MAX_HOURS_PER_DAY } from "./types";
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

  // ★★★ A CAP RULE CAN BE ON AND EVALUATE NOTHING — `isCap` rejects a missing
  // threshold — and this is the state the FIRST click creates. The toggle reads
  // pressed and the section says the rule is on; before the notice, nothing
  // anywhere said the rule was inert.
  it("marks a cap rule enabled with no threshold as incomplete", () => {
    const { onLinksChange } = renderGuardrails();
    fireEvent.click(
      screen.getByRole("button", { name: t("en-US", "insightTimelogCapPerDayTitle") }),
    );
    // ★ The deliberate no-invented-default behaviour must NOT regress: enabling
    // still writes `{enabled: true}` alone, because 8h vs 6h is an org decision.
    expect(onLinksChange).toHaveBeenCalledWith(
      expect.objectContaining({ policy: { timelogCapPerDay: { enabled: true } } }),
    );
  });

  it("shows the notice and marks the field invalid for a rule with no threshold", () => {
    renderGuardrails({ timelogCapPerDay: { enabled: true } });
    const field = screen.getByRole("spinbutton", { name: t("en-US", "timelogDayCapLabel") });
    expect(field).toHaveAttribute("aria-invalid", "true");
    const notice = screen.getByText(t("en-US", "timelogThresholdNeeded", MAX_HOURS_PER_DAY));
    // ★ The description must actually resolve — an aria-describedby pointing at
    // an absent element describes nothing.
    expect(field.getAttribute("aria-describedby")).toBe(notice.id);
    expect(notice.id).not.toBe("");
  });

  it("renders no notice while an enabled rule carries a usable threshold", () => {
    renderGuardrails({ timelogCapPerDay: { enabled: true, threshold: 8 } });
    expect(
      screen.queryByText(t("en-US", "timelogThresholdNeeded", MAX_HOURS_PER_DAY)),
    ).toBeNull();
    expect(
      screen.getByRole("spinbutton", { name: t("en-US", "timelogDayCapLabel") }),
    ).not.toHaveAttribute("aria-invalid");
  });

  // ★★ THE NOTICE IDS ARE PER-RULE, so two incomplete rules must not both point
  // at the same element — the describedby would resolve to whichever the DOM
  // yielded first.
  it("gives each rule its own notice element", () => {
    renderGuardrails({
      timelogCapPerEntry: { enabled: true },
      timelogCapPerDay: { enabled: true },
    });
    const entry = screen.getByRole("spinbutton", { name: t("en-US", "timelogEntryCapLabel") });
    const day = screen.getByRole("spinbutton", { name: t("en-US", "timelogDayCapLabel") });
    const entryId = entry.getAttribute("aria-describedby");
    const dayId = day.getAttribute("aria-describedby");
    expect(entryId).toBeTruthy();
    expect(dayId).toBeTruthy();
    expect(entryId).not.toBe(dayId);
    expect(document.getElementById(entryId as string)).not.toBeNull();
    expect(document.getElementById(dayId as string)).not.toBeNull();
  });

  // ★★★ A CONTROLLED harness, because the property IS the round trip. The field
  // is bound to the PERSISTED threshold, so an uncontrolled `vi.fn()` parent
  // would never echo a committed value back and every assertion below about
  // what the box SHOWS would be answered by the draft alone — vacuous for the
  // half of the behaviour that matters.
  function renderControlled(policy?: TimelogPolicy) {
    let seen: TimelogLinks = { ...EMPTY_LINKS, ...(policy ? { policy } : {}) };
    const initial = seen;
    function Harness() {
      const [links, setLinks] = useState<TimelogLinks>(initial);
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
    return {
      field: () => screen.getByRole("spinbutton", { name: t("en-US", "timelogDayCapLabel") }),
      links: () => seen,
    };
  }

  it.each([
    ["above the daily maximum", "999"],
    ["negative", "-5"],
    ["zero", "0"],
  ])("refuses to persist a threshold that is %s", (_case, typed) => {
    const { field, links } = renderControlled({ timelogCapPerDay: { enabled: true } });
    fireEvent.change(field(), { target: { value: typed } });
    expect(links().policy).toEqual({ timelogCapPerDay: { enabled: true } });
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(t("en-US", "timelogThresholdNeeded", MAX_HOURS_PER_DAY)),
    ).toBeTruthy();
  });

  it("persists a valid threshold and clears the notice", () => {
    const { field, links } = renderControlled({ timelogCapPerDay: { enabled: true } });
    fireEvent.change(field(), { target: { value: "8" } });
    expect(links().policy).toEqual({ timelogCapPerDay: { enabled: true, threshold: 8 } });
    expect(field()).toHaveValue(8);
    expect(
      screen.queryByText(t("en-US", "timelogThresholdNeeded", MAX_HOURS_PER_DAY)),
    ).toBeNull();
  });

  // ★★★ THE TYPIST IS NOT FOUGHT. The field is bound to the persisted value and
  // an out-of-range value is deliberately never persisted, so without the draft
  // the box would BLANK at the exact keystroke that took the number out of
  // range — the user would be typing into a field that erased itself.
  it("keeps an out-of-range value in the field while the user is still typing it", () => {
    const { field, links } = renderControlled({ timelogCapPerDay: { enabled: true } });
    fireEvent.change(field(), { target: { value: "9" } });
    expect(field()).toHaveValue(9);
    fireEvent.change(field(), { target: { value: "99" } });
    // Out of range: not persisted, but still SHOWN — the box did not blank.
    expect(field()).toHaveValue(99);
    expect(links().policy).toEqual({ timelogCapPerDay: { enabled: true } });
    fireEvent.change(field(), { target: { value: "9" } });
    expect(field()).toHaveValue(9);
    expect(links().policy).toEqual({ timelogCapPerDay: { enabled: true, threshold: 9 } });
  });

  it("shows the notice when the field is cleared while the rule is on", () => {
    const { field, links } = renderControlled({
      timelogCapPerDay: { enabled: true, threshold: 8 },
    });
    fireEvent.change(field(), { target: { value: "" } });
    expect(field()).toHaveValue(null);
    expect(field()).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(t("en-US", "timelogThresholdNeeded", MAX_HOURS_PER_DAY)),
    ).toBeTruthy();
    // The store agrees with the box rather than quietly keeping the old cap: a
    // notice saying "not applied" beside a rule that IS applying an invisible 8
    // would be the same lie this fix removes.
    expect(links().policy).toEqual({ timelogCapPerDay: { enabled: true } });
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

// ★★★ THE ENGLISH ASSERTIONS ABOVE ARE VACUOUS FOR THE GERMAN STRING. `t` falls
// back to the EN dictionary for any key the DE dictionary is missing, so an
// EN-only suite passes with `i18n.de.ts` never touched. This is the only test
// that can fail when the German value is absent, wrong, or a copy of the
// English one.
describe("TimelogSettings guardrails in German", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // The DE dictionary is lazy — without this, `t("de", …)` returns English.
    await loadI18n("de");
  });

  it("renders the incomplete-threshold notice in German", () => {
    render(
      <TimelogSettings
        lang="de"
        config={defaultTimelogConfig}
        onChange={vi.fn()}
        links={{ ...EMPTY_LINKS, policy: { timelogCapPerDay: { enabled: true } } }}
        onLinksChange={vi.fn()}
      />,
    );
    const de = t("de", "timelogThresholdNeeded", MAX_HOURS_PER_DAY);
    // Guards against a German value that is merely the English one copied over:
    // this assertion would then be satisfied by the untranslated string.
    expect(de).not.toBe(t("en-US", "timelogThresholdNeeded", MAX_HOURS_PER_DAY));
    expect(de).toContain("Obergrenze");
    expect(screen.getByText(de)).toBeTruthy();
  });
});
