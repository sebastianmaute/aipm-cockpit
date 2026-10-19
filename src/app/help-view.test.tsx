import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { loadI18n, t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { HelpView } from "./help-view";
import { helpSectionId } from "./help-content-pane";
import { helpEntryBody } from "./help-content";
import { FORECAST_AXIS_EXTENSION_DAYS } from "./gantt-engine";
import { FORECAST_SIM_HELP_ID } from "./sim-explainer";
import { SETTINGS_KEY } from "./use-settings";
import { showForecastView } from "../test/forecast-view";

describe("HelpView (grouped)", () => {
  it("renders the group headers", () => {
    render(<HelpView lang="en-US" />);
    expect(screen.getAllByText("Concepts").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Workflows").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Features").length).toBeGreaterThan(0);
    expect(screen.getAllByText("What's automated").length).toBeGreaterThan(0);
  });

  it("renders a concept section with a Related line", () => {
    render(<HelpView lang="en-US" />);
    expect(screen.getAllByText("Milestone").length).toBeGreaterThan(0);
    // "Related:" appears for concept entries that carry relations.
    expect(screen.getAllByText(/Related:/).length).toBeGreaterThan(0);
  });

  it("hides all groups and shows the empty message on a no-match search", () => {
    render(<HelpView lang="en-US" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzznomatchxyz" } });
    expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
    expect(screen.queryAllByText("Concepts").length).toBe(0);
  });

  it("consumes a deep-linked concept on mount (scroll + callback)", () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollSpy });
    const onConsumed = vi.fn();
    render(<HelpView lang="en-US" pendingHelpConcept="concept-raid" onHelpConceptConsumed={onConsumed} />);
    expect(onConsumed).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("shows the relations map with concept nodes on the How-it-connects tab", () => {
    render(<HelpView lang="en-US" />);
    fireEvent.click(screen.getByRole("tab", { name: "How it all connects" }));
    // a concept node button exists inside the map (e.g. "Milestone")
    expect(screen.getAllByRole("button", { name: "Milestone" }).length).toBeGreaterThan(0);
  });

  it("hides the search box on a non-Help tab", () => {
    render(<HelpView lang="en-US" />);
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Information flows" }));
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("navigates to a related view when onNavigateView is provided", () => {
    const onNav = vi.fn();
    render(<HelpView lang="en-US" onNavigateView={onNav} />);
    // Several entries relate to view "raid" — each Related line renders a nav button.
    const btns = screen.getAllByRole("button", { name: /go to raid/i });
    expect(btns.length).toBeGreaterThan(0);
    fireEvent.click(btns[0]);
    expect(onNav).toHaveBeenCalledWith("raid");
  });

  it("omits the Guided tours tab when onStartTour is absent", () => {
    const { unmount } = render(<HelpView lang="en-US" />);
    expect(screen.queryByText("Guided tours")).toBeNull();
    unmount();
  });

  it("shows tour cards on the Guided tours tab when onStartTour is provided", () => {
    render(
      <HelpView
        lang="en-US"
        onStartTour={() => {}}
        catalogTours={[{ id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc", stepCount: 3, iconView: "raid" }]}
        completedTours={[]}
      />,
    );
    // Default tab is Help; switch to the Guided tours tab to reveal the catalog.
    fireEvent.click(screen.getByRole("tab", { name: "Guided tours" }));
    expect(screen.getByRole("button", { name: /managing risks/i })).toBeInTheDocument();
  });
});

describe("HelpView search clear", () => {
  it("clears the in-pane search field from the overlaid X", () => {
    render(<HelpView lang="en-US" />);
    const field = screen.getByLabelText("Search help") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "milestone" } });
    expect(field.value).toBe("milestone");
    fireEvent.click(screen.getByRole("button", { name: "Clear – Search help" }));
    expect(field.value).toBe("");
  });
});

describe("HelpView reading-level dropdown", () => {
  it("offers all three levels on the Help tab", () => {
    render(<HelpView lang="en-US" />);
    const select = screen.getByLabelText(t("en-US", "helpReadingLevelLabel"));
    expect(select).toBeInTheDocument();
    expect([...select.querySelectorAll("option")].map((o) => o.value)).toEqual([
      "guided",
      "standard",
      "expert",
    ]);
  });

  // ★ Position, not just presence: the user asked for it between the search box
  // and Print, and the toolbar convention keeps Print · reset-size contiguous —
  // so it must sit OUTSIDE that trailing group, not as its first member.
  it("sits after the search box and before the Print group", () => {
    render(<HelpView lang="en-US" />);
    const select = screen.getByLabelText(t("en-US", "helpReadingLevelLabel"));
    const search = screen.getByLabelText(t("en-US", "helpSearchPlaceholder"));
    const print = screen.getByRole("button", { name: t("en-US", "printHint") });
    const after = (a: Element, b: Element) =>
      !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(after(search, select)).toBe(true);
    expect(after(select, print)).toBe(true);
    expect(select.closest("div.ml-auto")).toBeNull();
  });

  // The level changes nothing outside the Help tab, and a control with no
  // visible effect is worse than an absent one.
  it("is absent on another tab", async () => {
    render(<HelpView lang="en-US" />);
    await userEvent.click(screen.getByRole("tab", { name: t("en-US", "helpRelationsTitle") }));
    expect(screen.queryByLabelText(t("en-US", "helpReadingLevelLabel"))).toBeNull();
  });
});
describe("HelpView — every tab has its own name (§672)", () => {
  beforeAll(() => loadI18n("de"));

  // Each tab is named by its translated title, so two tabs worded alike would sound identical.
  // The tours tab renders only when a tour can be started, so it is passed here to get all four.
  // Without the German dictionary the de case would silently re-run en-US, so pin that it loaded.
  it("renders real German for the de case", () => {
    expect(t("de", "helpRelationsTitle")).not.toBe(t("en-US", "helpRelationsTitle"));
  });

  it.each(["en-US", "de"] as const)("names every tab distinctly in %s", (lang) => {
    render(<HelpView lang={lang} onStartTour={vi.fn()} />);
    expectRowUniqueNames({ minControls: 4, roles: ["tab"], scope: screen.getByRole("tablist") });
  });
});

describe("HelpView — reopening the simulation intro (§502)", () => {
  const LABEL = "Show the simulation introduction again";
  beforeEach(() => { showForecastView(); });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(SETTINGS_KEY);
  });

  it("offers nothing while the intro has never been dismissed", async () => {
    render(<HelpView lang="en-US" onNavigateView={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: t("en-US", "helpConceptForecastSimTitle") })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: LABEL })).toBeNull();
  });

  it("renders the entry with the axis cap filled in, not the placeholder", async () => {
    render(<HelpView lang="en-US" onNavigateView={vi.fn()} />);
    const heading = await screen.findByRole("heading", { name: t("en-US", "helpConceptForecastSimTitle") });
    const text = heading.closest("section")?.textContent ?? "";
    expect(text).toContain(`at most ${FORECAST_AXIS_EXTENSION_DAYS} days`);
    expect(text).not.toContain("{0}");
  });

  it("under the simulation entry, clears the seen flag and goes to the Dashboard", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ simulationIntroSeen: true }));
    const onNavigateView = vi.fn();
    render(<HelpView lang="en-US" simulationActive onNavigateView={onNavigateView} />);
    const button = await screen.findByRole("button", { name: LABEL });
    expect(button.closest("section")?.id).toBe(helpSectionId(FORECAST_SIM_HELP_ID));
    await userEvent.click(button);
    expect(onNavigateView).toHaveBeenCalledWith("dashboard");
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}").simulationIntroSeen).toBe(false));
    expect(screen.queryByRole("button", { name: LABEL })).toBeNull();
  });
});

describe("HelpView — reopening the intro with the switch off (§502)", () => {
  const LABEL = "Show the simulation introduction again";
  beforeEach(() => { showForecastView(); });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(SETTINGS_KEY);
  });

  it("shows a note instead of a button and changes nothing", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ simulationIntroSeen: true }));
    const onNavigateView = vi.fn();
    render(<HelpView lang="en-US" simulationActive={false} onNavigateView={onNavigateView} />);
    expect(await screen.findByText(t("en-US", "helpSimulationIntroNeedsSwitch"))).toBeInTheDocument();
    expect(t("en-US", "helpSimulationIntroNeedsSwitch")).toContain("once Use Monte Carlo forecasting is switched on for this project");
    expect(screen.queryByRole("button", { name: LABEL })).toBeNull();
    expect(onNavigateView).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}").simulationIntroSeen).toBe(true);
  });

  it("names the new surfaces and the horizon in the body, EN and DE", async () => {
    expect(t("en-US", "helpConceptForecastSimBody")).toContain("beyond the forecast horizon");
    expect(t("en-US", "helpConceptForecastSimBody")).toContain("Forecast tile");
    await loadI18n("de");
    const de = t("de", "helpConceptForecastSimBody");
    expect(de).toContain("Prognosehorizont");
    expect(de).toContain("Prognose-Kachel");
    expect(de).toContain("Nächste Schritte");
    expect(de).not.toBe(t("en-US", "helpConceptForecastSimBody"));
    expect(t("de", "helpSimulationIntroNeedsSwitch")).not.toBe(t("en-US", "helpSimulationIntroNeedsSwitch"));
  });

  it("names part 4's surfaces by their on-screen labels, EN and DE (§502)", async () => {
    await loadI18n("de");
    for (const lang of ["en-US", "de"] as const) {
      const body = helpEntryBody(lang, { bodyKey: "helpConceptForecastSimBody" });
      for (const key of ["simEvenOdds", "simSafeToCommit", "simCautious", "forecastDraftAskLabel", "forecastScenarioUseAsProposal", "forecastColChancePrioritised"] as const) {
        expect(body).toContain(t(lang, key));
      }
      expect(body).toContain("→");
      expect(body).toContain(lang === "de" ? "als simuliert" : "marked simulated");
    }
  });

  // The axis cap is the Gantt's constant, filled in at render: the string itself carries only the placeholder,
  // so a hand-typed number cannot come back and drift from FORECAST_AXIS_EXTENSION_DAYS.
  it("quotes the Gantt's axis cap from FORECAST_AXIS_EXTENSION_DAYS, EN and DE (§502)", async () => {
    await loadI18n("de");
    for (const lang of ["en-US", "de"] as const) {
      expect(t(lang, "helpConceptForecastSimBody")).toContain(lang === "de" ? "höchstens {0} Tage" : "at most {0} days");
      const body = helpEntryBody(lang, { bodyKey: "helpConceptForecastSimBody" });
      expect(body).toContain(`${FORECAST_AXIS_EXTENSION_DAYS} ${lang === "de" ? "Tage" : "days"}`);
      expect(body).not.toContain("{0}");
    }
  });

  // A lone scenario, target or proposal write applies at once (shouldStage stages only several writes or a
  // delete), so the help must not promise an approval step for it.
  it("promises the review card only for several changes or a delete, EN and DE (§502)", async () => {
    await loadI18n("de");
    const en = t("en-US", "helpConceptForecastSimBody");
    expect(en).toContain("One such change applies at once and is logged");
    expect(en).not.toMatch(/once you approve|same approval/);
    const de = t("de", "helpConceptForecastSimBody");
    expect(de).toContain("Eine einzelne solche Änderung gilt sofort und wird protokolliert");
    expect(de).not.toMatch(/sobald Sie zustimmen|derselben Zustimmung/);
  });

  // The forecast decision export section starts unticked (gate 1), so the help must not promise it in every export.
  it("says exports carry the decision block only with the section ticked, EN and DE (§502)", async () => {
    await loadI18n("de");
    const en = t("en-US", "helpConceptForecastSimBody");
    expect(en).toContain("tick Forecast decision (simulated) in Settings → Export, which starts unticked");
    expect(en).not.toContain("Exports and documents gain");
    const de = t("de", "helpConceptForecastSimBody");
    expect(de).toContain("in Einstellungen → Export „Prognose-Entscheidung (simuliert)“ an, das anfangs nicht angehakt ist");
    expect(de).not.toContain("Exporte und Dokumente erhalten");
  });
});

describe("HelpView — forecast view held back (§502)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem(SETTINGS_KEY);
  });

  it("lists no simulation entry, no reopen action and no graph node", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ simulationIntroSeen: true }));
    render(<HelpView lang="en-US" onNavigateView={vi.fn()} />);
    expect(await screen.findByRole("heading", { name: t("en-US", "helpConceptMilestoneTitle") })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: t("en-US", "helpConceptForecastSimTitle") })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show the simulation introduction again" })).toBeNull();
  });
});
