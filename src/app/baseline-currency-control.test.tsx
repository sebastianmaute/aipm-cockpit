import { afterEach, describe, expect, test, vi } from "vitest";
import { useEffect, useRef, type ReactNode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { BaselineCurrencyControl } from "./baseline-currency-control";
import { createProjectClock, resolveTimezone } from "./timezone";
import type { FxRates, ResourcePlan, Role } from "./types";

const plan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" };
const roles: Role[] = [{ id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
// The table CACHED in the workspace — present in every test, so a control that
// read it instead of `sessionRates` would be enabled in the first one.
const cached: FxRates = { base: "EUR", date: "2026-01-02", fetchedAt: "2026-01-02T00:00:00.000Z", rates: { EUR: 1, USD: 1.1, GBP: 0.8, INR: 90 } };
const session: FxRates = { base: "EUR", date: "2026-10-13", fetchedAt: "2026-10-13T00:00:00.000Z", rates: { EUR: 1, USD: 1.08, GBP: 0.852, INR: 91 } };

function Seeder() {
  const { setPlan, setRoles, setFxRates } = useWorkspace();
  useEffect(() => {
    setPlan(plan);
    setRoles(roles);
    setFxRates(cached);
  }, [setPlan, setRoles, setFxRates]);
  return null;
}

function Probe() {
  const { plan: p, roles: r, baselineHistory, fxRates, activityLog } = useWorkspace();
  return (
    <>
      <span data-testid="currency">{p.currency}</span>
      <span data-testid="rate">{String(r[0]?.internalRate ?? "")}</span>
      <span data-testid="history">{JSON.stringify(baselineHistory)}</span>
      <span data-testid="cached">{fxRates ? "cached" : "none"}</span>
      <span data-testid="log">{JSON.stringify(activityLog)}</span>
      <span data-testid="roles">{JSON.stringify(r.map((x) => ({ id: x.id, internalRate: x.internalRate })))}</span>
    </>
  );
}

// Exposes the live workspace setters so a test can act as a PEER writer.
const live: { current: ReturnType<typeof useWorkspace> | null } = { current: null };
function Driver() {
  const ws = useWorkspace();
  const ref = useRef(live);
  useEffect(() => { ref.current.current = ws; });
  return null;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <Seeder />
        <Probe />
        <Driver />
        {children}
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

const renderControl = (sessionRates: FxRates | null, today = "2026-10-14") =>
  render(<BaselineCurrencyControl lang="en-US" sessionRates={sessionRates} workdayHours={8} today={today} />, { wrapper });

async function openSwitchToGbp() {
  renderControl(session);
  await waitFor(() => expect(screen.getByTestId("rate").textContent).toBe("100"));
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Project currency" }), "GBP");
  return screen.getByRole("dialog", { name: "Switch project currency to GBP?" });
}

describe("BaselineCurrencyControl", () => {
  test("is disabled with the needs-rates text while only a CACHED table exists (Review Focus 3)", async () => {
    renderControl(null);
    await waitFor(() => expect(screen.getByTestId("cached").textContent).toBe("cached"));
    const select = screen.getByRole("combobox", { name: "Project currency" });
    expect(select).toBeDisabled();
    expect(screen.getByText("Refresh the ECB rates first: the switch converts your rates at today's rate.")).toBeInTheDocument();
    expect(select).toHaveAccessibleDescription(/Refresh the ECB rates first/);
  });

  test("with session rates the select is enabled and carries no needs-rates text", async () => {
    renderControl(session);
    await waitFor(() => expect(screen.getByTestId("currency").textContent).toBe("EUR"));
    expect(screen.getByRole("combobox", { name: "Project currency" })).toBeEnabled();
    expect(screen.queryByText(/Refresh the ECB rates first/)).not.toBeInTheDocument();
  });

  test("choosing GBP opens the dialog with the converted rows; Cancel (focused on open) changes nothing", async () => {
    const dialog = await openSwitchToGbp();
    const row = within(dialog).getByText("€100.00").closest("tr");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("£85.20")).toBeInTheDocument();
    expect(within(dialog).getByText("1 EUR = 0.852 GBP (ECB, 2026-10-13)")).toBeInTheDocument();
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(cancel).toHaveFocus());
    await userEvent.click(cancel);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("currency").textContent).toBe("EUR");
    expect(screen.getByTestId("rate").textContent).toBe("100");
    expect(screen.getByTestId("history").textContent).toBe("[]");
    expect(screen.getByRole("combobox", { name: "Project currency" })).toHaveValue("EUR");
  });

  test("Confirm switches the currency, converts the rate and records one history entry", async () => {
    const dialog = await openSwitchToGbp();
    await userEvent.click(within(dialog).getByRole("button", { name: "Switch to GBP" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("currency").textContent).toBe("GBP");
    expect(screen.getByTestId("rate").textContent).toBe("85.2");
    const history = JSON.parse(screen.getByTestId("history").textContent ?? "[]") as Array<{ currency: string; perPrevious?: number }>;
    expect(history).toHaveLength(1);
    expect(history[0].currency).toBe("GBP");
    expect(history[0].perPrevious).toBe(0.852);
    expect(screen.getByRole("combobox", { name: "Project currency" })).toHaveValue("GBP");
  });

  // §476 owner requirement — the switch is recorded in the activity log, by the user, once.
  const logOf = () => JSON.parse(screen.getByTestId("log").textContent ?? "[]") as Array<{ kind: string; args: unknown[]; actor?: string }>;
  test("Confirm appends exactly one activity entry: from, to, the cross rate and the ECB date", async () => {
    const dialog = await openSwitchToGbp();
    expect(logOf()).toEqual([]); // control: opening the dialog logs nothing
    await userEvent.click(within(dialog).getByRole("button", { name: "Switch to GBP" }));
    const log = logOf();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ kind: "plan.currencySwitched", args: ["EUR", "GBP", 0.852, "2026-10-13"], actor: "user" });
  });

  test("Cancel appends no activity entry", async () => {
    const dialog = await openSwitchToGbp();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(logOf()).toEqual([]);
  });

  test("Escape closes the dialog like Cancel", async () => {
    const dialog = await openSwitchToGbp();
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("currency").textContent).toBe("EUR");
    expect(screen.getByTestId("rate").textContent).toBe("100");
    expect(screen.getByTestId("history").textContent).toBe("[]");
  });
  // §476 A2 — the entry's `from` is the PROJECT day (the clock the app renders `today`
  // from), not the UTC day `toISOString` gives; `at` stays the ISO instant.
  describe("switch date", () => {
    afterEach(() => {
      vi.useRealTimers();
    });
    test("at 00:30 Berlin on the 1st (UTC: the previous day) the entry starts on the local day", async () => {
      const instant = new Date("2026-10-31T23:30:00.000Z");
      const today = createProjectClock(resolveTimezone("Europe/Berlin", undefined), instant).today;
      expect(today).toBe("2026-11-01"); // control: the zone really is a day ahead of UTC here
      vi.useFakeTimers({ toFake: ["Date"], now: instant });
      renderControl(session, today);
      await waitFor(() => expect(screen.getByTestId("rate").textContent).toBe("100"));
      await userEvent.selectOptions(screen.getByRole("combobox", { name: "Project currency" }), "GBP");
      await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Switch to GBP" }));
      const history = JSON.parse(screen.getByTestId("history").textContent ?? "[]") as Array<{ from: string; at: string }>;
      expect(history).toHaveLength(1);
      expect(history[0].from).toBe("2026-11-01");
      expect(history[0].at).toBe("2026-10-31T23:30:00.000Z");
    });
  });

  // §476 A6 — a pending choice that stops being a switch (a peer already switched) is
  // dropped, so the dialog cannot come back on its own later.
  test("a peer switch to the pending currency closes the dialog, and it does not reappear on a switch back", async () => {
    await openSwitchToGbp();
    act(() => live.current?.setPlan((p) => ({ ...p, currency: "GBP" })));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    act(() => live.current?.setPlan((p) => ({ ...p, currency: "EUR" })));
    await waitFor(() => expect(screen.getByTestId("currency").textContent).toBe("EUR"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // §476 A7 — Confirm writes through FUNCTIONAL setters, so a role added in the same tick
  // (AGENTS.md "N saves in one tick") survives the switch, converted like the rest.
  test("a role added in the same tick as Confirm survives, converted", async () => {
    const dialog = await openSwitchToGbp();
    const confirm = within(dialog).getByRole("button", { name: "Switch to GBP" });
    act(() => {
      live.current?.setRoles((prev) => [...prev, { id: 4, disciplineId: 1, gradeId: 1, internalRate: 200, externalRate: 300 }]);
      confirm.click();
    });
    await waitFor(() => expect(screen.getByTestId("currency").textContent).toBe("GBP"));
    const ids = JSON.parse(screen.getByTestId("roles").textContent ?? "[]") as Array<{ id: number; internalRate: number }>;
    expect(ids).toEqual([{ id: 3, internalRate: 85.2 }, { id: 4, internalRate: 170.4 }]);
    const history = JSON.parse(screen.getByTestId("history").textContent ?? "[]") as unknown[];
    expect(history).toHaveLength(1);
  });

  // §476 final fix 2, item 4 — a peer tab's switch to the same currency that lands in the
  // same tick, BEFORE this tab re-renders, must not be converted a second time: Confirm
  // decides against the LIVE currency, not the one its render planned from.
  test("a peer switch queued before Confirm in the same tick: no second conversion, history entry or activity entry", async () => {
    const dialog = await openSwitchToGbp();
    const confirm = within(dialog).getByRole("button", { name: "Switch to GBP" });
    const peerEntry = { from: "2026-10-14", at: "2026-10-14T08:00:00.000Z", currency: "GBP" as const, perPrevious: 0.852 };
    act(() => {
      live.current?.setPlan((p) => ({ ...p, currency: "GBP" }));
      live.current?.setRoles((prev) => prev.map((r) => ({ ...r, internalRate: 85.2 })));
      live.current?.setBaselineHistory((h) => [...h, peerEntry]);
      confirm.click();
    });
    await waitFor(() => expect(screen.getByTestId("currency").textContent).toBe("GBP"));
    expect(screen.getByTestId("rate").textContent).toBe("85.2");
    expect(JSON.parse(screen.getByTestId("history").textContent ?? "[]")).toEqual([peerEntry]);
    expect(logOf()).toEqual([]);
  });
});
