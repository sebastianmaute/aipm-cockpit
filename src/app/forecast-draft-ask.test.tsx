// "Ask Claude to draft a proposal" (§502 part 4, spec §3.6): the button, its row-unique name and the prompt it sends.
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastDraftAsk } from "./forecast-draft-ask";
import { ForecastLeverCell } from "./forecast-lever-cell";
import { loadI18n, t } from "./i18n";
import { rowLabel } from "./row-tokens";
import type { WhatItTakes } from "./forecast-levers";

const requestChat = vi.fn();
vi.mock("./workspace-tab-context", () => ({ useWorkspaceTab: () => ({ requestChat }) }));

const GO_LIVE = { name: "Go-live", date: "2026-10-20", chance: 0.31 };
const LEVERS: WhatItTakes = {
  target: { kind: "milestone", id: 1 }, chance: 0.31, prioritised: 0.58,
  people: { state: "reaches", n: 2, chance: 0.81, hours: null }, tasks: { state: "reaches", n: 9, chance: 0.8, hours: null },
};

beforeAll(async () => {
  await loadI18n("de");
});
beforeEach(() => requestChat.mockReset());

describe("ForecastDraftAsk", () => {
  test("sends the milestone, its chance and the goal, and switches to the chat", async () => {
    render(<ForecastDraftAsk lang="en-US" milestone={GO_LIVE} goal={80} />);
    await userEvent.click(screen.getByRole("button", { name: /Ask Claude to draft a proposal/ }));
    expect(requestChat).toHaveBeenCalledTimes(1);
    const [body, autoSend] = requestChat.mock.calls[0] as [string, boolean];
    expect(autoSend).toBe(true);
    expect(body).toContain("Go-live");
    expect(body).toContain("31%");
    expect(body).toContain("80%");
  });

  test("the name carries the visible label and differs from the other Ask-Claude buttons", () => {
    render(<ForecastDraftAsk lang="en-US" milestone={GO_LIVE} goal={80} />);
    const name = screen.getByRole("button").getAttribute("aria-label") ?? "";
    expect(name).toContain(t("en-US", "forecastDraftAskLabel"));
    expect(name).not.toBe(t("en-US", "aiAskClaude"));
    expect(name).not.toBe(t("en-US", "forecastAskClaude"));
    expect(name).toBe(rowLabel(t("en-US", "forecastDraftAskLabel"), "Go-live"));
  });

  test("the plan-level variant sends the plan end and carries no milestone", async () => {
    render(<ForecastDraftAsk lang="en-US" milestone={null} plan={{ date: "2026-10-23", chance: 0.4 }} goal={95} />);
    await userEvent.click(screen.getByRole("button", { name: "Ask Claude to draft a proposal" }));
    const body = requestChat.mock.calls[0][0] as string;
    expect(body).toContain("plan end");
    expect(body).toContain("40%");
    expect(body).toContain("95%");
  });

  test("German: label and body are German", async () => {
    render(<ForecastDraftAsk lang="de" milestone={GO_LIVE} goal={80} />);
    await userEvent.click(screen.getByRole("button", { name: /Claude einen Vorschlag entwerfen lassen/ }));
    expect(requestChat.mock.calls[0][0]).toContain("31 %");
  });
});

describe("ForecastLeverCell — Ask Claude", () => {
  test("offers the button only when given the milestone, named by the row token", () => {
    const { rerender } = render(<ForecastLeverCell lang="en-US" milestoneName="Go-live (2)" result={LEVERS} goal={80} />);
    expect(screen.queryByRole("button", { name: /Ask Claude/ })).toBeNull();
    rerender(<ForecastLeverCell lang="en-US" milestoneName="Go-live (2)" result={LEVERS} goal={80} askClaude={GO_LIVE} />);
    expect(screen.getByRole("button", { name: rowLabel("Ask Claude to draft a proposal", "Go-live (2)") })).toBeTruthy();
  });

  test("an on-target row offers nothing", () => {
    const onTarget = { ...LEVERS, people: { state: "on-target" }, tasks: { state: "on-target" } } as WhatItTakes;
    render(<ForecastLeverCell lang="en-US" milestoneName="Go-live" result={onTarget} goal={80} askClaude={GO_LIVE} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
