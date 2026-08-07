import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiGuidesSection } from "./ai-guides-section";
import { defaultSettings as baseSettings } from "../settings-types";
import { t } from "../i18n";
import type { UseOperatingGuidesResult } from "../use-operating-guides";

// DECISION A: the section is gated on the AI master switch (it was extracted
// from inside ai-section's `settings.ai.enabled === true` fragment), so every
// test that expects guide UI must enable it.
const defaultSettings = { ...baseSettings, ai: { ...baseSettings.ai, enabled: true } };

function makeOperatingGuides(
  over: Partial<UseOperatingGuidesResult> = {},
): UseOperatingGuidesResult {
  return {
    guides: [
      {
        id: "builtin-leadership",
        name: "Project Leadership Operating Guide",
        content: "x",
        enabled: true,
        priority: 1,
        scope: {},
        builtIn: true,
      },
      {
        id: "g2",
        name: "My Guide",
        content: "y",
        enabled: true,
        priority: 2,
        scope: {},
        builtIn: false,
      },
    ],
    busy: false,
    ready: true,
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    refresh: vi.fn(),
    ...over,
  };
}

function makeProps(over: Record<string, unknown> = {}) {
  return {
    lang: "en-US" as const,
    settings: defaultSettings,
    onChange: vi.fn(),
    operatingGuides: makeOperatingGuides(),
    ...over,
  };
}

describe("AiGuidesSection", () => {
  it("renders only the enable hint while the AI master switch is off", () => {
    render(<AiGuidesSection {...makeProps({ settings: baseSettings })} />);
    expect(screen.getByText(t("en-US", "aiEnableHelp"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("en-US", "aiGuideAdd") })).toBeNull();
    expect(screen.queryByLabelText(t("en-US", "aiGroundInGuides"))).toBeNull();
  });

  // Moved from ai-section.test.tsx. The heading assertion went with the move:
  // settings-view.tsx renders the shared <h2> from the rail label now, so the
  // section no longer carries its own `aiGuidesHeading` <p>.
  it("renders the guides description and a labelled master toggle", () => {
    render(<AiGuidesSection {...makeProps()} />);
    expect(screen.getByText(t("en-US", "aiGuidesDesc"))).toBeInTheDocument();
    expect(screen.getByLabelText(t("en-US", "aiGroundInGuides"))).toBeInTheDocument();
  });

  it("does not render its own heading — settings-view supplies it", () => {
    // Pins the drop explicitly. Without this, re-adding the <p> would double
    // the heading in the live rail section and nothing would fail.
    render(<AiGuidesSection {...makeProps()} />);
    expect(screen.queryByText(t("en-US", "aiGuidesHeading"))).toBeNull();
  });

  it("lists both guides; built-in shows badge and no Delete button; user guide has Delete", () => {
    render(<AiGuidesSection {...makeProps()} />);
    expect(screen.getByText("Project Leadership Operating Guide")).toBeInTheDocument();
    expect(screen.getByText("My Guide")).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "aiGuideBuiltInBadge"))).toBeInTheDocument();
    // Delete buttons: only user guide has one. The accessible name is
    // qualified per-row with the guide name, so match by prefix.
    const deleteBtns = screen.getAllByRole("button", {
      name: new RegExp(`^${t("en-US", "aiGuideDelete")}`),
    });
    expect(deleteBtns).toHaveLength(1);
    expect(deleteBtns[0]).toHaveAccessibleName(`${t("en-US", "aiGuideDelete")} – My Guide`);
  });

  it("toggling master toggle calls onChange with groundInGuides flipped", () => {
    const onChange = vi.fn();
    render(
      <AiGuidesSection
        {...makeProps({
          settings: { ...defaultSettings, ai: { ...defaultSettings.ai, groundInGuides: true } },
          onChange,
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText(t("en-US", "aiGroundInGuides")));
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.ai.groundInGuides).toBe(false);
  });

  it("opens the add form when Add guide is pressed", () => {
    render(<AiGuidesSection {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiGuideAdd") }));
    expect(screen.getByRole("button", { name: t("en-US", "aiGuideSave") })).toBeInTheDocument();
  });

  it("Edit opens that row's form pre-filled with the guide's content", () => {
    render(<AiGuidesSection {...makeProps()} />);
    fireEvent.click(
      screen.getByRole("button", { name: `${t("en-US", "aiGuideEdit")} – My Guide` }),
    );
    const name = screen.getByLabelText(t("en-US", "aiGuideName")) as HTMLInputElement;
    expect(name.value).toBe("My Guide");
  });

  it("Delete removes that guide by id", () => {
    const remove = vi.fn();
    render(
      <AiGuidesSection
        {...makeProps({ operatingGuides: makeOperatingGuides({ remove }) })}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: `${t("en-US", "aiGuideDelete")} – My Guide` }),
    );
    expect(remove).toHaveBeenCalledWith("g2");
  });

  it("renders no guide list at all when no operatingGuides hook is supplied", () => {
    // The master toggle still renders — it is a plain setting — but the CRUD
    // surface is hook-gated, so `og == null` must not throw or half-render.
    render(<AiGuidesSection {...makeProps({ operatingGuides: undefined })} />);
    expect(screen.getByLabelText(t("en-US", "aiGroundInGuides"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("en-US", "aiGuideAdd") })).toBeNull();
  });

  it("warns when the enabled guides exceed the character budget", () => {
    const long = "x".repeat(200_000);
    render(
      <AiGuidesSection
        {...makeProps({
          operatingGuides: makeOperatingGuides({
            guides: [
              {
                id: "big",
                name: "Big",
                content: long,
                enabled: true,
                priority: 1,
                scope: {},
                builtIn: false,
              },
            ],
          }),
        })}
      />,
    );
    expect(screen.getByText(t("en-US", "aiGuideBudgetWarning"))).toBeInTheDocument();
  });

  it("gives the guide row actions a real hover affordance", () => {
    // Five of these seven buttons shipped with NO hover class at all and one
    // with `hover:bg-surface` (its own background — a no-op). The primitive
    // supplies `hover:bg-surface-muted`.
    render(<AiGuidesSection {...makeProps()} />);
    const edit = screen.getByRole("button", { name: `${t("en-US", "aiGuideEdit")} – My Guide` });
    // Word-bounded: a bare toContain("bg-surface") passes against every Button
    // variant, since they all carry `hover:bg-surface-muted`.
    expect(edit.className).toMatch(/(^|\s)hover:bg-surface-muted(\s|$)/);
    // `cursor-pointer` is Button's BASE class and is the discriminator that
    // proves this is `Button` rather than `ToggleButton` — `border-line` +
    // `bg-surface` do NOT identify Button, ToggleButton's unpressed state
    // carries both.
    expect(edit.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
  });

  it("styles the destructive guide action as destructive", () => {
    render(<AiGuidesSection {...makeProps()} />);
    const del = screen.getByRole("button", { name: `${t("en-US", "aiGuideDelete")} – My Guide` });
    // NOT a bare /ui-pink/ — the hand-rolled button already carried
    // `text-ui-pink-strong`, so that regex passes before the conversion and
    // pins nothing. These two are unique to Button's `destructive` variant.
    expect(del.className).toMatch(/(^|\s)hover:bg-ui-pink\/10(\s|$)/);
    expect(del.className).toMatch(/(^|\s)border-ui-pink\/40(\s|$)/);
    expect(del.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
  });

  it("gives Add guide the secondary primitive", () => {
    render(<AiGuidesSection {...makeProps()} />);
    const add = screen.getByRole("button", { name: t("en-US", "aiGuideAdd") });
    expect(add.className).toMatch(/(^|\s)hover:bg-surface-muted(\s|$)/);
    expect(add.className).toMatch(/(^|\s)cursor-pointer(\s|$)/);
  });

  it("gives the guide form Save the primary fill and Cancel a real hover", () => {
    render(<AiGuidesSection {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiGuideAdd") }));
    const save = screen.getByRole("button", { name: t("en-US", "aiGuideSave") });
    // Deliberate colour change, green → dark blue: edit-modal-chrome renders
    // the canonical modal Save at the default `primary`, so green-save was the
    // outlier. jsdom cannot see the pixels; this pins the class.
    expect(save.className).toMatch(/(^|\s)bg-ui-dark-blue(\s|$)/);
    expect(save.className).not.toMatch(/(^|\s)bg-ui-green(\s|$)/);

    const cancel = screen.getByRole("button", { name: t("en-US", "aiGuideCancel") });
    // Was `hover:bg-surface` — its OWN background, i.e. a visual no-op.
    expect(cancel.className).toMatch(/(^|\s)hover:bg-surface-muted(\s|$)/);
    expect(cancel.className).not.toMatch(/(^|\s)hover:bg-surface(\s|$)/);
  });

  it("keeps Save disabled until the draft has a name", () => {
    // The `disabled` prop must survive the primitive swap — Button forwards
    // native props, but a conversion that drops it ships a save that commits
    // an unnamed guide.
    render(<AiGuidesSection {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiGuideAdd") }));
    expect(screen.getByRole("button", { name: t("en-US", "aiGuideSave") })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(t("en-US", "aiGuideName")), {
      target: { value: "New guide" },
    });
    expect(screen.getByRole("button", { name: t("en-US", "aiGuideSave") })).toBeEnabled();
  });
});
