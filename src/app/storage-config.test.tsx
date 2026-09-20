import { describe, expect, it, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StorageConfigSection } from "./storage-config";
import { Modal } from "./modal";
import { loadI18n, t } from "./i18n";

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

  // ★★ `spUrlForConfig()` renders `itemPath` DECODED, so the live target shows a raw space while
  // the address a user copies out of the browser is `%20`-encoded. A string comparison called that
  // paste dirty, armed Apply, and applying it rebuilt the backend (identity dep) for a no-op — a
  // whole-app skeleton plus a re-download of the same file, on every site with a space in its path.
  // Mutation: `canApplySpUrl`'s `!spDraftIsCurrentTarget` → `spUrl.trim() !== spCommittedUrl`
  // (the raw-string comparison) → the first expect is red; the second is the positive control that
  // keeps a "never enabled" regression from passing it.
  it("the live target's own %20-encoded URL leaves Apply disabled; a different file enables it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <StorageConfigSection
        {...baseProps({
          // The committed item path holds a SPACE, so the encoded and decoded spellings differ.
          config: { kind: "sp-json", hostname: "contoso.sharepoint.com", sitePath: "/sites/Alpha", itemPath: "Shared Documents/workspace.json" },
          onChange,
          m365Enabled: true,
          sharepointEnabled: true,
        })}
      />,
    );
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    const apply = screen.getByRole("button", { name: SP_APPLY });
    await user.clear(input);
    await user.type(input, SP_URL); // the SAME file, %20-encoded as the browser gives it
    expect((input as HTMLInputElement).value).not.toBe(
      "https://contoso.sharepoint.com/sites/Alpha/Shared Documents/workspace.json",
    ); // control: the two spellings really do differ as strings
    expect(apply).toBeDisabled();
    await user.clear(input);
    await user.type(input, "https://contoso.sharepoint.com/sites/Alpha/Shared%20Documents/other.json");
    expect(apply).toBeEnabled();
  });

  // ★ The one surviving blur behaviour, and it is a pure setState: this Input is the ONLY place the
  // section shows the SharePoint target (the `description` readout is Turso-gated), so an accidental
  // Ctrl-A/Delete used to leave it blank behind a dead Apply until a remount.
  // Mutation: empty `restoreSpUrlOnEmptyBlur`'s body (or drop the `onBlur`) → the first expect red.
  // The "blur does NOT commit" test above is the control for the non-empty half: a blur that
  // restores unconditionally would wipe a real draft and turn THAT test red.
  it("blur with an EMPTY field restores the committed URL, and commits nothing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderSp(onChange);
    const input = screen.getByPlaceholderText(/your-tenant.sharepoint.com/i);
    await user.clear(input);
    expect((input as HTMLInputElement).value).toBe(""); // control: it really was emptied
    await user.tab();
    expect((input as HTMLInputElement).value).toBe(
      "https://old.sharepoint.com/sites/old/old.json",
    );
    expect(onChange).not.toHaveBeenCalled(); // a restore is setState, never a commit
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
  // ★★ EN ONLY, and case-SENSITIVE only because EN's two keys happen to share the casing. DE is
  //    pinned separately at the bottom of this file ("SharePoint Apply label-in-name (DE)"),
  //    case-INSENSITIVELY, because there the visible label is "Übernehmen" and the accessible name
  //    is "SharePoint-Datei-URL übernehmen". Do not "unify" the two into one case-sensitive
  //    assertion: SC 2.5.3 matching ignores case, so a case-sensitive DE test would flag
  //    conformant code. Said again at `integrationsTursoApply` in `i18n.ts`.
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

// ★★★ §548 — THE DE HALF OF THE LABEL-IN-NAME PIN (WCAG 2.5.3). EN containment says NOTHING about
//   DE: the visible label (`integrationsTursoApply`) and the accessible name (`spStorageApplyLabel`)
//   are two INDEPENDENTLY AUTHORED keys, and in EN they happen to share both the word and its
//   casing. `asset-library.test.tsx` carries the bug this rule comes from — an EN-green pair that
//   was a straight 2.5.3 failure in DE, where a German speech-input user saying the word printed on
//   the button could not activate it. Until this describe the DE side of BOTH Apply buttons was
//   unpinned, which is what the EN comments above used to record as accepted.
// ★★ CASE-INSENSITIVE IS THE CORRECT COMPARISON HERE, NOT A WEAKENED ONE. DE differs in case by
//   construction — "Übernehmen" standalone, "… übernehmen" inside a compound name — and SC 2.5.3
//   matching ignores case and position (Understanding SC 2.5.3, "Punctuation and capitalization";
//   axe's own `label-content-name-mismatch` ends in a position-independent `includes` over curated,
//   case-folded text). A case-SENSITIVE DE assertion would therefore fail code that CONFORMS, and
//   "fixing" it by capitalising the verb mid-sentence would break German orthography instead.
// ★★ NO GATE CATCHES THIS EITHER WAY: the SharePoint block needs `auth.account` (a live MSAL cache)
//   so axe never renders it, and axe's 2.5.3 rule is `experimental`, which its default tagExclude
//   drops — see `docs/AGENTS/accessibility.md`. A unit test is the only possible detector.
// ★ The DE dictionary is LAZY, so `loadI18n("de")` must run before any `t("de", …)`; without it
//   `t` serves the EN string and every assertion below compares EN with EN, i.e. is vacuous. The
//   `expect(visible).not.toBe(t("en-US", …))` line is the anti-vacuity check for exactly that.
// Mutation (named, both halves): in `i18n.de.ts` change `spStorageApplyLabel` to
//   "SharePoint-Datei-URL anwenden" → the SharePoint case is red and the EN case above stays
//   green; change `integrationsTursoApplyLabel` to "Turso-Verbindung anwenden" → the Turso case is
//   red on its own.
describe("Apply buttons — label-in-name in DE (WCAG 2.5.3)", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("the SharePoint Apply's accessible name contains its visible label, case-insensitively", () => {
    render(
      <StorageConfigSection
        {...baseProps({
          lang: "de",
          config: { kind: "sp-json", hostname: "old.sharepoint.com", sitePath: "/sites/old", itemPath: "old.json" },
          onChange: vi.fn(),
          m365Enabled: true,
          sharepointEnabled: true,
        })}
      />,
    );
    const visible = t("de", "integrationsTursoApply");
    expect(visible.trim().length).toBeGreaterThan(0); // anti-vacuity: "" is inside everything
    expect(visible).not.toBe(t("en-US", "integrationsTursoApply")); // the DE dict really loaded
    // ★★★ LOCATED BY VISIBLE TEXT, never by the accessible name — `getByRole`'s `name` reads the
    //   accessible name, so using it here would make the selector assume the very thing under test.
    const applies = screen.getAllByRole("button").filter((b) => b.textContent?.trim() === visible);
    expect(applies).toHaveLength(1); // the sibling "Browse" button must not be swept in
    const accessible = applies[0].getAttribute("aria-label") ?? "";
    expect(accessible).toBe(t("de", "spStorageApplyLabel"));
    expect(accessible.toLowerCase()).toContain(visible.toLowerCase());
  });

  // ★ STRING-LEVEL for the Turso twin, deliberately: rendering `IntegrationsSection` here would
  //   pull in its secrets/MSAL setup for one assertion. What this cannot see is the key→button
  //   BINDING, and that is already pinned in EN — `integrations-section.backend-hold.test.tsx` and
  //   `integrations-section.drafts.test.tsx` both locate that button by `integrationsTursoApplyLabel`
  //   and the `drafts` suite reads its visible text. So the untested half was the DE STRINGS, which
  //   is what this closes.
  it("the Turso Apply's accessible name contains its visible label, case-insensitively", () => {
    const visible = t("de", "integrationsTursoApply");
    const accessible = t("de", "integrationsTursoApplyLabel");
    expect(visible.trim().length).toBeGreaterThan(0);
    expect(visible).not.toBe(t("en-US", "integrationsTursoApply")); // the DE dict really loaded
    expect(accessible.toLowerCase()).toContain(visible.toLowerCase());
    expect(accessible).not.toBe(t("de", "spStorageApplyLabel")); // the two names stay distinct
  });
});
