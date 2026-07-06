import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectSwitcher } from "./project-switcher";
import { type ProjectRegistryEntry } from "./projects-registry";
import { t } from "./i18n";

const projects: ProjectRegistryEntry[] = [
  {
    id: "p1",
    name: "Apollo",
    code: "APL",
    storageConfig: { kind: "browser" },
  },
  {
    id: "p2",
    name: "Gemini",
    code: "GMN",
    storageConfig: { kind: "browser" },
  },
];

function renderSwitcher(overrides: Partial<React.ComponentProps<typeof ProjectSwitcher>> = {}) {
  const onSwitch = vi.fn();
  const onLoadFromFile = vi.fn();
  const onNew = vi.fn();
  render(
    <ProjectSwitcher
      currentProjectName="Apollo"
      projects={projects}
      currentProjectId="p1"
      lang="en-US"
      onSwitch={onSwitch}
      onLoadFromFile={onLoadFromFile}
      onNew={onNew}
      {...overrides}
    />,
  );
  return { onSwitch, onLoadFromFile, onNew };
}

describe("ProjectSwitcher", () => {
  it("renders the current project name on the trigger", () => {
    renderSwitcher();
    expect(
      screen.getByRole("button", { name: /Apollo/ }),
    ).toBeInTheDocument();
  });

  it("shows the fallback label when the current name is null", () => {
    renderSwitcher({ currentProjectName: null, currentProjectId: null });
    const label = t("en-US", "projectCurrentLabel");
    // The trigger's accessible name includes the fallback label.
    expect(
      screen.getByRole("button", { name: new RegExp(label) }),
    ).toBeInTheDocument();
  });

  it("opens the dropdown listing the projects when the trigger is clicked", async () => {
    const user = userEvent.setup();
    renderSwitcher();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Apollo/ }));

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Gemini/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Apollo/ })).toBeInTheDocument();
  });

  it("calls onSwitch and closes when a non-current project is clicked", async () => {
    const user = userEvent.setup();
    const { onSwitch } = renderSwitcher();

    await user.click(screen.getByRole("button", { name: /Apollo/ }));
    await user.click(screen.getByRole("menuitem", { name: /Gemini/ }));

    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch).toHaveBeenCalledWith("p2");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("marks the current project entry as disabled and does not call onSwitch", async () => {
    const user = userEvent.setup();
    const { onSwitch } = renderSwitcher();

    await user.click(screen.getByRole("button", { name: /Apollo/ }));
    const currentItem = screen.getByRole("menuitem", { name: /Apollo/ });
    expect(currentItem).toBeDisabled();
    expect(currentItem).toHaveAttribute("aria-current", "true");

    await user.click(currentItem);
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it("calls onLoadFromFile and closes when 'Load from file' is clicked", async () => {
    const user = userEvent.setup();
    const { onLoadFromFile } = renderSwitcher();

    await user.click(screen.getByRole("button", { name: /Apollo/ }));
    await user.click(
      screen.getByRole("menuitem", {
        name: t("en-US", "projectSwitcherLoadFile"),
      }),
    );

    expect(onLoadFromFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("calls onNew and closes when '+ New project' is clicked", async () => {
    const user = userEvent.setup();
    const { onNew } = renderSwitcher();

    await user.click(screen.getByRole("button", { name: /Apollo/ }));
    await user.click(
      screen.getByRole("menuitem", {
        name: new RegExp(t("en-US", "projectsNew")),
      }),
    );

    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  describe("menu keyboard navigation (APG roving)", () => {
    it("focuses the first non-disabled menuitem on open", async () => {
      const user = userEvent.setup();
      renderSwitcher();

      await user.click(screen.getByRole("button", { name: /Apollo/ }));

      // Apollo (current) is disabled, so focus lands on Gemini.
      expect(screen.getByRole("menuitem", { name: /Gemini/ })).toHaveFocus();
    });

    it("moves focus with ArrowDown / ArrowUp and wraps", async () => {
      const user = userEvent.setup();
      renderSwitcher();

      await user.click(screen.getByRole("button", { name: /Apollo/ }));
      const gemini = screen.getByRole("menuitem", { name: /Gemini/ });
      const loadFile = screen.getByRole("menuitem", {
        name: t("en-US", "projectSwitcherLoadFile"),
      });
      const newProject = screen.getByRole("menuitem", {
        name: new RegExp(t("en-US", "projectsNew")),
      });

      expect(gemini).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(loadFile).toHaveFocus();
      await user.keyboard("{ArrowUp}");
      expect(gemini).toHaveFocus();
      // Wrap backwards to the last item.
      await user.keyboard("{ArrowUp}");
      expect(newProject).toHaveFocus();
      // Wrap forwards to the first item.
      await user.keyboard("{ArrowDown}");
      expect(gemini).toHaveFocus();
    });

    it("jumps to first/last with Home/End", async () => {
      const user = userEvent.setup();
      renderSwitcher();

      await user.click(screen.getByRole("button", { name: /Apollo/ }));
      const gemini = screen.getByRole("menuitem", { name: /Gemini/ });
      const newProject = screen.getByRole("menuitem", {
        name: new RegExp(t("en-US", "projectsNew")),
      });

      await user.keyboard("{End}");
      expect(newProject).toHaveFocus();
      await user.keyboard("{Home}");
      expect(gemini).toHaveFocus();
    });

    it("Escape closes the menu and returns focus to the trigger (WCAG 2.4.3)", async () => {
      const user = userEvent.setup();
      renderSwitcher();

      const trigger = screen.getByRole("button", { name: /Apollo/ });
      await user.click(trigger);
      // Focus is inside the menu (Gemini).
      expect(screen.getByRole("menuitem", { name: /Gemini/ })).toHaveFocus();

      await user.keyboard("{Escape}");
      // Menu closed and focus restored to the trigger button, not lost to body.
      expect(screen.queryByRole("menuitem", { name: /Gemini/ })).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  describe("turso mode", () => {
    it("omits the 'Load from file' item from the dropdown", async () => {
      const user = userEvent.setup();
      renderSwitcher({ mode: "turso" });

      await user.click(screen.getByRole("button", { name: /Apollo/ }));

      expect(
        screen.queryByRole("menuitem", {
          name: t("en-US", "projectSwitcherLoadFile"),
        }),
      ).toBeNull();
      // The rest of the menu is unchanged.
      expect(screen.getByRole("menuitem", { name: /Gemini/ })).toBeInTheDocument();
      expect(
        screen.getByRole("menuitem", {
          name: new RegExp(t("en-US", "projectsNew")),
        }),
      ).toBeInTheDocument();
    });
  });

  describe("readOnly mode (popout indicator)", () => {
    it("shows the current project name without an interactive trigger", () => {
      renderSwitcher({ readOnly: true });
      // Name is displayed...
      expect(screen.getByText("Apollo")).toBeInTheDocument();
      // ...but there is NO dropdown trigger button.
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("does not open a menu or call onSwitch when clicked", async () => {
      const user = userEvent.setup();
      const { onSwitch } = renderSwitcher({ readOnly: true });

      await user.click(screen.getByText("Apollo"));

      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(onSwitch).not.toHaveBeenCalled();
    });

    it("falls back to the no-project label when the name is null", () => {
      renderSwitcher({ readOnly: true, currentProjectName: null });
      expect(
        screen.getByText(t("en-US", "projectCurrentLabel")),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });
  });
});
