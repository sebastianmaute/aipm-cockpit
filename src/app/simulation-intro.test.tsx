import { createRef, useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SimulationIntro } from "./simulation-intro";
import { t } from "./i18n";
import { HELP_ENTRIES } from "./help-content";
import { FORECAST_SIM_HELP_ID } from "./sim-explainer";

describe("SimulationIntro", () => {
  it("shows the verbatim intro copy and both actions", () => {
    render(<SimulationIntro lang="en-US" onGotIt={vi.fn()} onShowMe={vi.fn()} />);
    expect(
      screen.getByText(
        'Simulation is on. Dashed teal numbers are simulated, not measured. "P80" means 8 in 10 simulated runs reached it. Switch it off in the Budget burn tile or in Edit project.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Got it" })).toBeInTheDocument();
  });

  it("calls onGotIt from the Got it button", async () => {
    const onGotIt = vi.fn();
    render(<SimulationIntro lang="en-US" onGotIt={onGotIt} onShowMe={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(onGotIt).toHaveBeenCalledTimes(1);
  });

  it("calls onShowMe from the Show me button", async () => {
    const onShowMe = vi.fn();
    render(<SimulationIntro lang="en-US" onGotIt={vi.fn()} onShowMe={onShowMe} />);
    await userEvent.click(screen.getByRole("button", { name: "Show me" }));
    expect(onShowMe).toHaveBeenCalledTimes(1);
  });

  it("omits Show me when no Help opener is available", () => {
    render(<SimulationIntro lang="en-US" onGotIt={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Show me" })).toBeNull();
  });

  // Without the switch on screen (burn tile absent), Got it hands focus to the next control, never to <body>.
  it("moves focus to the next control when the anchor holds no control", async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      const anchorRef = createRef<HTMLDivElement>();
      return (
        <>
          {open && <SimulationIntro lang="en-US" onGotIt={() => setOpen(false)} anchorRef={anchorRef} />}
          <button type="button" hidden>Hidden after</button>
          <button type="button">After</button>
        </>
      );
    }
    render(<Host />);
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus();
  });

  // A candidate that refuses focus (layout-hidden in a browser) is passed over; with nothing after the
  // note, focus goes back to the last control before it.
  it("skips a control that refuses focus and falls back to the control before the note", async () => {
    function Host() {
      const [open, setOpen] = useState(true);
      const anchorRef = createRef<HTMLDivElement>();
      return (
        <>
          {/* Far before: a loop that never stops on success would end here, not on Before. */}
          <button type="button">Far before</button>
          <button type="button">Before</button>
          {open && <SimulationIntro lang="en-US" onGotIt={() => setOpen(false)} anchorRef={anchorRef} />}
          <button type="button" aria-hidden="true">Shadowed after</button>
          <button type="button">Refuses</button>
        </>
      );
    }
    render(<Host />);
    const refuses = screen.getByRole("button", { name: "Refuses" });
    refuses.focus = () => {};
    await userEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByRole("button", { name: "Before" })).toHaveFocus();
  });

  it("dismisses on Escape", async () => {
    const onGotIt = vi.fn();
    render(<SimulationIntro lang="en-US" onGotIt={onGotIt} onShowMe={vi.fn()} />);
    await userEvent.keyboard("{Escape}");
    expect(onGotIt).toHaveBeenCalledTimes(1);
  });
});

describe("SimulationIntro Escape ownership", () => {
  it("dismisses while focus is on the anchor control", async () => {
    const onGotIt = vi.fn();
    const anchorRef = createRef<HTMLDivElement>();
    render(
      <>
        <div ref={anchorRef}><button type="button">Anchor</button></div>
        <SimulationIntro lang="en-US" onGotIt={onGotIt} anchorRef={anchorRef} />
      </>,
    );
    screen.getByRole("button", { name: "Anchor" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onGotIt).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the anchor when Got it is activated from inside the note", async () => {
    const user = userEvent.setup();
    const anchorRef = createRef<HTMLDivElement>();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <div ref={anchorRef}><button type="button">Anchor</button></div>
          {open && <SimulationIntro lang="en-US" onGotIt={() => setOpen(false)} anchorRef={anchorRef} />}
        </>
      );
    }
    render(<Harness />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole("button", { name: "Got it" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByRole("button", { name: "Anchor" })).toHaveFocus();
  });

  it("does not take Escape from a text field elsewhere", async () => {
    const onGotIt = vi.fn();
    const anchorRef = createRef<HTMLDivElement>();
    render(
      <>
        <div ref={anchorRef}><button type="button">Anchor</button></div>
        <input aria-label="Elsewhere" />
        <SimulationIntro lang="en-US" onGotIt={onGotIt} anchorRef={anchorRef} />
      </>,
    );
    screen.getByRole("textbox", { name: "Elsewhere" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(onGotIt).not.toHaveBeenCalled();
  });
});

describe("forecast simulation Help entry", () => {
  it("is registered under the id the explainer and intro use", () => {
    const entry = HELP_ENTRIES.find((e) => e.id === FORECAST_SIM_HELP_ID);
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      group: "concepts",
      titleKey: "helpConceptForecastSimTitle",
      bodyKey: "helpConceptForecastSimBody",
      primerKey: "helpConceptForecastSimPrimer",
      relatedViews: ["forecast", "dashboard"],
      relatedConcepts: ["concept-milestone", "concept-budget"],
    });
  });

  it("renders title and body in EN and DE", async () => {
    const { loadI18n } = await import("./i18n");
    await loadI18n("de");
    for (const lang of ["en-US", "de"] as const) {
      expect(t(lang, "helpConceptForecastSimTitle").length).toBeGreaterThan(3);
      expect(t(lang, "helpConceptForecastSimBody")).toContain("P80");
      expect(t(lang, "helpConceptForecastSimPrimer").length).toBeGreaterThan(20);
    }
    expect(t("de", "helpConceptForecastSimTitle")).not.toBe(t("en-US", "helpConceptForecastSimTitle"));
  });
});
