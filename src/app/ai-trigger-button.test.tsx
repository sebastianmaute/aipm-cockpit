import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiTriggerButton } from "./ai-trigger-button";
import { t } from "./i18n";

// `raciSuggest` ("Suggest RACI") stands in for a caller's own idle label — the
// plan's `aiSuggest` is not a real TranslationKey. It is one of the six AI
// trigger sites' actual labels and shares no substring with "Stop", which the
// name/label assertions below depend on.
describe("AiTriggerButton", () => {
  it("shows the feature label and runs when idle", async () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    render(
      <AiTriggerButton lang="en-US" busy={false} onRun={onRun} onCancel={onCancel} idleLabelKey="raciSuggest" />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "raciSuggest") });
    await userEvent.click(btn);
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("flips BOTH the visible label and the accessible name to Stop when busy", () => {
    render(
      <AiTriggerButton lang="en-US" busy onRun={vi.fn()} onCancel={vi.fn()} idleLabelKey="raciSuggest" />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "aiStop") });
    // WCAG 2.5.3: the visible text must be part of the accessible name.
    expect(btn).toHaveTextContent(t("en-US", "aiStop"));
    expect(btn).not.toHaveTextContent(t("en-US", "raciSuggest"));
  });

  it("routes the click to onCancel while busy", async () => {
    const onRun = vi.fn();
    const onCancel = vi.fn();
    render(
      <AiTriggerButton lang="en-US" busy onRun={onRun} onCancel={onCancel} idleLabelKey="raciSuggest" />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "aiStop") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("keeps a real disabled attribute so a disabled trigger cannot fire", async () => {
    const onRun = vi.fn();
    render(
      <AiTriggerButton
        lang="en-US"
        busy={false}
        onRun={onRun}
        onCancel={vi.fn()}
        idleLabelKey="raciSuggest"
        disabled
      />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "raciSuggest") });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onRun).not.toHaveBeenCalled();
  });

  // ── nameQualifier ────────────────────────────────────────────────────────
  // Two sites mount this trigger more than once in one DOM (the dedup trigger
  // in Open Points + Gantt; the insights CTA once per row). Identical
  // accessible names there is WCAG 2.4.6, and the axe gate is BLIND to it — it
  // only flags a MISSING name. These tests are the only coverage.

  it("qualifies the accessible name in BOTH states without touching the visible text", () => {
    const { rerender } = render(
      <AiTriggerButton
        lang="en-US" busy={false} onRun={vi.fn()} onCancel={vi.fn()}
        idleLabelKey="raciSuggest" nameQualifier="Gantt"
      />,
    );
    const idle = screen.getByRole("button", { name: `${t("en-US", "raciSuggest")} – Gantt` });
    // The SUFFIX is name-only: the rendered text is still the bare label.
    expect(idle).toHaveTextContent(t("en-US", "raciSuggest"));
    expect(idle.textContent).not.toContain("Gantt");

    rerender(
      <AiTriggerButton
        lang="en-US" busy onRun={vi.fn()} onCancel={vi.fn()}
        idleLabelKey="raciSuggest" nameQualifier="Gantt"
      />,
    );
    // ★ The BUSY state must be qualified too. Qualifying only the idle state
    //   restores the collision precisely when every row reads "Stop".
    const busyBtn = screen.getByRole("button", { name: `${t("en-US", "aiStop")} – Gantt` });
    expect(busyBtn.textContent).not.toContain("Gantt");
  });

  it("gives two mounts with different qualifiers two DIFFERENT accessible names", () => {
    // ★ A single-mount test cannot see a collision — which is the entire point
    //   of the prop. Render both and assert each is found exactly once.
    render(
      <>
        <AiTriggerButton
          lang="en-US" busy={false} onRun={vi.fn()} onCancel={vi.fn()}
          idleLabelKey="raciSuggest" nameQualifier="Open Points"
        />
        <AiTriggerButton
          lang="en-US" busy={false} onRun={vi.fn()} onCancel={vi.fn()}
          idleLabelKey="raciSuggest" nameQualifier="Gantt"
        />
      </>,
    );
    const label = t("en-US", "raciSuggest");
    expect(screen.getAllByRole("button", { name: `${label} – Open Points` })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: `${label} – Gantt` })).toHaveLength(1);
    // The unqualified name must match NEITHER — an exact-string query proves
    // the suffix actually landed rather than being appended to a stale name.
    expect(screen.queryByRole("button", { name: label })).toBeNull();
  });

  // ── description ──────────────────────────────────────────────────────────

  it("puts description on title while the accessible name stays the label", () => {
    render(
      <AiTriggerButton
        lang="en-US" busy={false} onRun={vi.fn()} onCancel={vi.fn()}
        idleLabelKey="allocPlan" description={t("en-US", "allocPlanTitle")}
      />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "allocPlan") });
    // ★ Assert the two DIFFER. Asserting only "title is set" would pass in the
    //   broken case where title fell back to the label.
    expect(btn.getAttribute("title")).toBe(t("en-US", "allocPlanTitle"));
    expect(btn.getAttribute("title")).not.toBe(btn.getAttribute("aria-label"));
  });

  it("drops the description while busy, since it describes running not stopping", () => {
    render(
      <AiTriggerButton
        lang="en-US" busy onRun={vi.fn()} onCancel={vi.fn()}
        idleLabelKey="allocPlan" description={t("en-US", "allocPlanTitle")}
      />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "aiStop") });
    expect(btn.getAttribute("title")).toBe(t("en-US", "aiStop"));
  });

  // ── variant / size / type ────────────────────────────────────────────────

  it("defaults to the secondary/xs treatment and forwards variant + size to Button", () => {
    const props = {
      lang: "en-US", busy: false, onRun: vi.fn(), onCancel: vi.fn(),
      idleLabelKey: "raciSuggest",
    } as const;
    const { rerender } = render(<AiTriggerButton {...props} />);
    const name = { name: t("en-US", "raciSuggest") };
    const defaulted = screen.getByRole("button", name).className;

    // The default is exactly what an explicit secondary/xs renders, so the four
    // sites that pass neither keep the look they had before this component.
    rerender(<AiTriggerButton {...props} variant="secondary" size="xs" />);
    expect(screen.getByRole("button", name).className).toBe(defaulted);

    // ★ And an override actually REACHES Button — asserting only "the class
    //   contains something" would pass with the props dropped on the floor.
    rerender(<AiTriggerButton {...props} variant="primary" size="sm" />);
    const overridden = screen.getByRole("button", name).className;
    expect(overridden).not.toBe(defaulted);
    expect(overridden).toContain("bg-ui-dark-blue"); // VARIANT_CLASS.primary
    expect(overridden).toContain("text-sm");         // SIZE_CLASS.sm
  });

  it("renders a plain button by default and a real submit button on request", () => {
    const props = {
      lang: "en-US", busy: false, onRun: vi.fn(), onCancel: vi.fn(),
      idleLabelKey: "inlineAiEdit",
    } as const;
    const name = { name: t("en-US", "inlineAiEdit") };
    const { rerender } = render(<AiTriggerButton {...props} />);
    // Default must stay "button": an accidental submit inside a form would
    // navigate/reload rather than run the feature.
    expect(screen.getByRole("button", name).getAttribute("type")).toBe("button");

    rerender(<AiTriggerButton {...props} type="submit" />);
    expect(screen.getByRole("button", name).getAttribute("type")).toBe("submit");
  });
});
