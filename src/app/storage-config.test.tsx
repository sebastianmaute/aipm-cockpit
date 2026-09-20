import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StorageConfigSection } from "./storage-config";
import { Modal } from "./modal";
import { t } from "./i18n";

vi.mock("./use-ms-auth", () => ({
  useMsAuth: (enabled: boolean) => ({
    account: enabled ? { username: "x@y.com" } : null,
    ready: enabled,
    signIn: vi.fn(),
    signOut: vi.fn(),
    acquireToken: async () => (enabled ? "t" : null),
  }),
}));

const noop = vi.fn();
const noopAsync = async () => {};
/** Accessible name of the SharePoint URL's Apply button (its visible label is just "Apply"). */
const SP_APPLY = t("en-US", "spStorageApplyLabel");

function baseProps(overrides: Partial<React.ComponentProps<typeof StorageConfigSection>> = {}): React.ComponentProps<typeof StorageConfigSection> {
  return {
    lang: "en-US",
    config: { kind: "browser" },
    onChange: noop,
    onRequestSwitch: noop,
    description: null,
    ready: false,
    onPickFile: noopAsync,
    onOpenFile: noopAsync,
    onGrantWrite: noopAsync,
    m365Enabled: false,
    sharepointEnabled: false,
    tursoEnabled: false,
    ...overrides,
  };
}

describe("StorageConfigSection — SharePoint gating", () => {
  beforeEach(() => {
    noop.mockClear();
  });

  it("shows 'enable M365 first' when M365 is OFF and config is sp-json", () => {
    render(
      <StorageConfigSection
        lang="en-US"
        config={{ kind: "sp-json", hostname: "x", sitePath: "/sites/a", itemPath: "f" }}
        onChange={noop}
        onRequestSwitch={noop}
        m365Enabled={false}
        sharepointEnabled={false}
        tursoEnabled={false}
        description={null}
        ready={false}
        onPickFile={noopAsync}
        onOpenFile={noopAsync}
        onGrantWrite={noopAsync}
      />,
    );
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });

  it("shows URL input when M365 + SharePoint enabled AND signed in", () => {
    render(
      <StorageConfigSection
        lang="en-US"
        config={{ kind: "sp-json", hostname: "x.sharepoint.com", sitePath: "/sites/a", itemPath: "f.json" }}
        onChange={noop}
        onRequestSwitch={noop}
        m365Enabled={true}
        sharepointEnabled={true}
        tursoEnabled={false}
        description={null}
        ready={false}
        onPickFile={noopAsync}
        onOpenFile={noopAsync}
        onGrantWrite={noopAsync}
      />,
    );
    expect(screen.getByText(/sharepoint file url/i)).toBeInTheDocument();
  });

  it("an invalid SharePoint URL fails on Apply and does NOT call onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StorageConfigSection
        {...baseProps({
          config: { kind: "sp-json", hostname: "x.sharepoint.com", sitePath: "/sites/a", itemPath: "f.json" },
          onChange,
          m365Enabled: true,
          sharepointEnabled: true,
        })}
      />,
    );
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    await user.clear(input);
    await user.type(input, "not a url");
    await user.click(screen.getByRole("button", { name: SP_APPLY }));
    expect(screen.getByText(/could not parse/i)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ★★★ §548 — the SharePoint file URL is the LIVE storage target, so a commit rebuilds the backend,
// which raises the load hold, which unmounts Settings. It used to commit on BLUR, so the mousedown
// on any neighbouring control took the section away and swallowed its own click. These pin the
// Turso-shaped replacement: drafts + one explicit Apply.
describe("StorageConfigSection — the SharePoint URL commits only on an explicit Apply (§548)", () => {
  const SP_URL = "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/workspace.json";
  const SP_PARSED = {
    kind: "sp-json",
    hostname: "contoso.sharepoint.com",
    sitePath: "/sites/Alpha",
    itemPath: "Shared Documents/workspace.json",
  };

  function renderSp(onChange: React.ComponentProps<typeof StorageConfigSection>["onChange"]) {
    return render(
      <StorageConfigSection
        {...baseProps({
          config: { kind: "sp-json", hostname: "old.sharepoint.com", sitePath: "/sites/old", itemPath: "old.json" },
          onChange,
          m365Enabled: true,
          sharepointEnabled: true,
        })}
      />,
    );
  }

  // Mutation: restore `onChange({kind, ...parsed})` inside the input's `onChange` handler
  // (a per-keystroke commit) → this goes red on the first character.
  it("holds the typed URL as a draft — typing commits nothing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSp(onChange);
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    await user.clear(input);
    await user.type(input, SP_URL);
    expect((input as HTMLInputElement).value).toBe(SP_URL); // control: the draft really is held
    expect(onChange).not.toHaveBeenCalled();
  });

  // Mutation: put `onBlur={applySpUrl}` back on the Input → this goes red.
  // ★ Tab is the realistic blur: it moves focus to the Apply button, i.e. exactly the
  //   mousedown-then-click sequence the old model broke.
  it("blur does NOT commit — the draft survives leaving the field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSp(onChange);
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    await user.clear(input);
    await user.type(input, SP_URL);
    await user.tab();
    expect(input).not.toHaveFocus(); // control: the blur really happened
    expect(onChange).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe(SP_URL);
  });

  // Mutation: `if (config.kind === …) onChange(…)` → `return;` in `applySpUrl` → red.
  it("Apply commits the parsed location exactly once", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSp(onChange);
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    await user.clear(input);
    await user.type(input, SP_URL);
    await user.click(screen.getByRole("button", { name: SP_APPLY }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(SP_PARSED);
  });

  // Mutation: drop the `handleSpUrlKeyDown` wiring (`onKeyDown` off the Input) → red.
  it("Enter in the field applies", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSp(onChange);
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    await user.clear(input);
    await user.type(input, `${SP_URL}{Enter}`);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(SP_PARSED);
  });

  // ★ An IME commits its composition with Enter, and THAT Enter is not an Apply — committing there
  // would rebuild the backend and unmount Settings mid-word for every CJK typist.
  // Mutation: drop `e.nativeEvent.isComposing` from `handleSpUrlKeyDown`'s early return → red.
  // The plain-Enter test above is the positive control for this pair: the same keydown WITHOUT the
  // composing flag does apply, so this cannot pass on a handler that is simply dead.
  it("Enter that commits an IME composition does NOT apply", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSp(onChange);
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    await user.clear(input);
    await user.type(input, SP_URL);
    expect(screen.getByRole("button", { name: SP_APPLY })).toBeEnabled(); // control: Apply IS armed
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  // Mutation: `disabled={!canApplySpUrl}` → `disabled={false}` → red.
  // An enabled Apply IS the "unapplied change" signal, so a clean draft must leave it disabled.
  it("Apply is disabled while the draft is clean and enabled once it differs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSp(onChange);
    const apply = screen.getByRole("button", { name: SP_APPLY });
    expect(apply).toBeDisabled();
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    await user.type(input, "x");
    expect(apply).toBeEnabled();
  });

  // The visible label is the shared "Apply"; the accessible name names the target and CONTAINS it,
  // which is WCAG 2.5.3 label-in-name. Mutation: drop " SharePoint file URL" from
  // `spStorageApplyLabel` so the two names collide with the Turso Apply → the second expect is red.
  it("the Apply button's accessible name names SharePoint and contains its visible label", () => {
    renderSp(vi.fn());
    const apply = screen.getByRole("button", { name: SP_APPLY });
    expect(apply.textContent).toBe(t("en-US", "integrationsTursoApply"));
    expect(SP_APPLY).toContain(t("en-US", "integrationsTursoApply"));
    expect(SP_APPLY).not.toBe(t("en-US", "integrationsTursoApplyLabel"));
  });

  // §548 — Escape now DISCARDS an unapplied draft rather than committing it; there is no
  // blur-commit left on this field to rescue. ★ `modal.tsx`'s `blurFocusInside` is unaffected and
  // still serves the other blur-commit fields (budget + change modals); it keeps its own named
  // mutation in `modal.test.tsx`.
  it("Escape in a Modal host discards the unapplied draft and closes the dialog", async () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 0; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    try {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const onClose = vi.fn();
      render(
        <Modal open onClose={onClose} ariaLabel="Storage">
          <StorageConfigSection
            {...baseProps({
              config: { kind: "sp-json", hostname: "old.sharepoint.com", sitePath: "/sites/old", itemPath: "old.json" },
              onChange,
              m365Enabled: true,
              sharepointEnabled: true,
            })}
          />
        </Modal>,
      );
      const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
      await user.clear(input);
      await user.type(input, SP_URL);
      await user.keyboard("{Escape}");
      expect(onChange).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1); // control: Escape really reached the dialog
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("StorageConfigSection — Turso gating", () => {
  beforeEach(() => {
    noop.mockClear();
  });

  it("Turso option is disabled until tursoEnabled", () => {
    const onChange = vi.fn();
    const onRequestSwitch = vi.fn();
    const { rerender } = render(<StorageConfigSection {...baseProps({ onChange, onRequestSwitch, tursoEnabled: false })} />);
    expect((screen.getByRole("option", { name: t("en-US", "storageTurso") }) as HTMLOptionElement).disabled).toBe(true);
    rerender(<StorageConfigSection {...baseProps({ onChange, onRequestSwitch, tursoEnabled: true })} />);
    expect((screen.getByRole("option", { name: t("en-US", "storageTurso") }) as HTMLOptionElement).disabled).toBe(false);
  });

  it("selecting Turso calls onRequestSwitch, not onChange", () => {
    const onChange = vi.fn();
    const onRequestSwitch = vi.fn();
    render(<StorageConfigSection {...baseProps({ onChange, onRequestSwitch, tursoEnabled: true })} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "turso" } });
    expect(onRequestSwitch).toHaveBeenCalledWith("turso");
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "turso" }));
  });
});

describe("StorageConfigSection — Browse button", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ value: [] }),
    })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clicking Browse… opens the SharePoint picker dialog", async () => {
    const user = userEvent.setup();
    render(
      <StorageConfigSection
        lang="en-US"
        config={{ kind: "sp-json", hostname: "c.sharepoint.com", sitePath: "/sites/p", itemPath: "f.json" }}
        onChange={noop}
        onRequestSwitch={noop}
        m365Enabled={true}
        sharepointEnabled={true}
        tursoEnabled={false}
        description={null}
        ready={true}
        onPickFile={noopAsync}
        onOpenFile={noopAsync}
        onGrantWrite={noopAsync}
      />,
    );
    const browseBtn = screen.getByRole("button", { name: /browse/i });
    await user.click(browseBtn);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("StorageConfigSection — kind select routing", () => {
  it("changing the storage kind select calls onRequestSwitch(newKind), NOT onChange with {kind}", () => {
    const onChange = vi.fn();
    const onRequestSwitch = vi.fn();
    render(
      <StorageConfigSection
        {...baseProps({ onChange, onRequestSwitch, config: { kind: "browser" } })}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "local-json" } });
    expect(onRequestSwitch).toHaveBeenCalledTimes(1);
    expect(onRequestSwitch).toHaveBeenCalledWith("local-json");
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ kind: expect.any(String) }));
  });

  it("the kind select is controlled by config.kind", () => {
    const onChange = vi.fn();
    const onRequestSwitch = vi.fn();
    render(
      <StorageConfigSection
        {...baseProps({ onChange, onRequestSwitch, config: { kind: "local-json" } })}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    // reflects config.kind
    expect(select.value).toBe("local-json");
    // firing a change does NOT mutate the displayed value without parent re-render
    fireEvent.change(select, { target: { value: "browser" } });
    // value stays — controlled, parent hasn't updated config
    expect(select.value).toBe("local-json");
  });
});
