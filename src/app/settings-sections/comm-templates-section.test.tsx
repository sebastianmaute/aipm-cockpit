import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CommTemplatesSection, type CommTemplatesSectionProps } from "./comm-templates-section";
import type { CommTemplate } from "../comm-templates";
import { defaultSettings } from "../settings-types";
import { ToastProvider } from "../toast-context";
import { readDiagLog, clearDiagLog } from "../diagnostics";
import { expectRowUniqueNames } from "../../test/row-unique-names";
import { rowLabel } from "../row-tokens";
import { t } from "../i18n";

const showToastSpy = vi.fn();

beforeEach(() => {
  clearDiagLog();
  showToastSpy.mockClear();
  mockVersions = [version()];
});

const saveVersion = vi.fn(async () => {});
type MockVersion = { id: string; templateId: string; name: string; body: string; isAuto: boolean; createdAt: string };
const version = (over: Partial<MockVersion> = {}): MockVersion => ({
  id: "x-v-1", templateId: "t1", name: "v1", body: "<p>old</p>", isAuto: false, createdAt: "2026-06-15T00:00:00Z", ...over,
});
// ★ Mutable so a test can seed a version list that collides. `vi.mock` hoists
// above this declaration, but the factory reads the binding rather than a
// snapshot, so a test that reassigns it before `setup()` is what the next
// render sees. The `mock` name prefix is what lets vitest's hoist check accept
// the reference at all.
let mockVersions: MockVersion[] = [version()];
vi.mock("../use-comm-template-versions", () => ({
  useCommTemplateVersions: () => ({
    versions: mockVersions,
    busy: false,
    saveVersion,
    removeVersion: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("../rich-text-editor", () => ({
  RichTextEditor: (p: {
    value: string;
    onChange: (html: string) => void;
    label: string;
    mergeFields: readonly string[];
    fieldLabel: (f: string) => string;
  }) => (
    <div>
      <textarea aria-label={p.label} value={p.value} onChange={(e) => p.onChange(e.target.value)} />
      {p.mergeFields.map((f) => (
        <button key={f} type="button" onClick={() => p.onChange(p.value + `{{${f}}}`)}>
          {p.fieldLabel(f)}
        </button>
      ))}
    </div>
  ),
}));

const tpl = (over: Partial<CommTemplate> = {}): CommTemplate => ({
  id: "t1", category: "status-inquiry", name: "Inquiry A", body: "Hello ", isDefault: false, createdAt: "", updatedAt: "", ...over,
});

type Handlers = Pick<CommTemplatesSectionProps, "onCreate" | "onRename" | "onSaveBody" | "onRemove" | "onSetDefault">;

function setup(templates: CommTemplate[], onChange = vi.fn(), overrides: Partial<Handlers> = {}) {
  const handlers: Handlers = {
    onCreate: vi.fn(async () => {}),
    onRename: vi.fn(async () => {}),
    onSaveBody: vi.fn(async () => {}),
    onRemove: vi.fn(async () => {}),
    onSetDefault: vi.fn(async () => {}),
    ...overrides,
  };
  render(
    <ToastProvider value={{ showToast: showToastSpy, showToastAction: showToastSpy }}>
      <CommTemplatesSection lang="en-US" templates={templates} config={null} settings={defaultSettings} onChange={onChange} {...handlers} />
    </ToastProvider>,
  );
  return { ...handlers, onChange };
}

describe("CommTemplatesSection", () => {
  it("creates a template in the selected category", () => {
    const h = setup([]);
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Weekly ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(h.onCreate).toHaveBeenCalledWith("status-inquiry", "Weekly ping", "");
  });

  it("inserts a merge field token into the body", async () => {
    setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    const body = (await screen.findByLabelText("Body")) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Task name" }));
    expect(body.value).toContain("{{taskName}}");
  });

  it("sets a template as default", () => {
    const h = setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: rowLabel(t("en-US", "commTplSetDefault"), "Inquiry A") }));
    expect(h.onSetDefault).toHaveBeenCalledWith("status-inquiry", "t1");
  });

  it("saves a named version of the current body", async () => {
    setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    vi.spyOn(window, "prompt").mockReturnValue("My version");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    expect(saveVersion).toHaveBeenCalledWith("My version", expect.any(String), false);
  });

  it("cancels editing: reverts the body draft and does not save", async () => {
    const h = setup([tpl({ body: "Hello " })]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    const body = (await screen.findByLabelText("Body")) as HTMLTextAreaElement;
    fireEvent.change(body, { target: { value: "Hello CHANGED" } });
    expect(body.value).toBe("Hello CHANGED");
    fireEvent.click(screen.getByRole("button", { name: "Cancel editing" }));
    const reverted = (await screen.findByLabelText("Body")) as HTMLTextAreaElement;
    expect(reverted.value).toBe("Hello ");
    expect(h.onSaveBody).not.toHaveBeenCalled();
  });

  it("compares Current against a version and shows the diff", async () => {
    setup([tpl({ body: "<p>new</p>" })]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare: Current" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare: v1" }));
    expect(await screen.findByLabelText(/removed: old/)).toBeTruthy();
    expect(screen.getByLabelText(/added: new/)).toBeTruthy();
  });

  it("changes the send mode via the radio group", () => {
    const { onChange } = setup([], vi.fn());
    fireEvent.click(screen.getByRole("radio", { name: "Outlook draft (HTML)" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ commTemplateSendMode: "outlook-draft" }));
  });

  it("surfaces a create failure (rejected save) as a logged event + error toast instead of an unhandled rejection", async () => {
    const onCreate = vi.fn(async () => { throw new Error("turso write failed"); });
    setup([], vi.fn(), { onCreate });
    fireEvent.change(screen.getByLabelText("Template name"), { target: { value: "Weekly ping" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => {
      expect(readDiagLog().some((ev) => ev.code === "commTemplates.saveFailed")).toBe(true);
    });
    expect(showToastSpy).toHaveBeenCalledWith("error", expect.any(String));
  });

  // ★★ WCAG 2.4.6 — nothing stops two templates in one category sharing a
  // name, so BOTH the bare "Set as default" and the name-interpolated
  // "Delete: <name>" collide. The row's own name button is content-named and
  // collides too. All three take the same occurrence token.
  // ★ `c3` shares the name from the OTHER category: it is never rendered here,
  // so it must not consume an occurrence index.
  // ★★ THREE rendered rows, and only ONE of them default, is load-bearing. With
  // two rows where one is default, the row NAME buttons differ by the badge
  // ("Weekly pingDefault" vs "Weekly ping") even with no fix at all — the
  // uniqueness assertion then passes over that control for the wrong reason and
  // covers only the two action buttons. The two non-default rows collide.
  const collidingTemplates: CommTemplate[] = [
    tpl({ id: "c1", name: "Weekly ping", isDefault: true }),
    tpl({ id: "c2", name: "Weekly ping" }),
    tpl({ id: "c4", name: "Weekly ping" }),
    tpl({ id: "c3", name: "Weekly ping", category: "stakeholder-update" }),
  ];
  const nameOf = (el: Element) => el.getAttribute("aria-label") || el.textContent || "";
  const buttonNames = () => screen.getAllByRole("button").map(nameOf);

  it("gives every per-row control a row-unique accessible name when two templates share a name", () => {
    setup(collidingTemplates);
    // 11 = measured for this fixture (whole-document scope).
    expectRowUniqueNames({ minControls: 11, requireCollisionSeed: true });
  });

  it("numbers the occurrence index over the RENDERED category, not the whole template list", () => {
    setup(collidingTemplates);
    const names = buttonNames();
    const verb = t("en-US", "commTplSetDefault");
    // Three rendered rows → exactly (1), (2), (3). Building the map over the
    // whole `templates` array instead would hand the third rendered row (4),
    // because the other category's `c3` sits ahead of it there.
    expect(names).toContain(rowLabel(verb, "Weekly ping (1)"));
    expect(names).toContain(rowLabel(verb, "Weekly ping (2)"));
    expect(names).toContain(rowLabel(verb, "Weekly ping (3)"));
    expect(names.some((n) => n.includes("Weekly ping (4)"))).toBe(false);
  });

  // ★★★ THE TEST THAT USED TO SIT HERE WAS VACUOUS, and this is the record of
  // that rather than a silent replacement. It asserted that three row buttons
  // start with "Weekly ping" and that exactly one of their names carries the
  // badge — and BOTH were already true of the UNFIXED, content-named code,
  // because the default row's content name was "Weekly pingDefault" while the
  // other two were "Weekly ping". The badge was doing the disambiguating for
  // free, so the assertion could not tell fixed code from broken code.
  // ★★ MEASURED, not reasoned. With the row button's `aria-label` mutated to
  // `undefined` (exactly the pre-fix shape) the old test PASSED, while "gives
  // every per-row control a row-unique accessible name" — the test that really
  // does cover the §276 collision on this surface — went RED under that same
  // mutant. So the file's collision coverage was real; only this one test was
  // contributing nothing to it while reading as though it did.
  // ★★ WHAT REPLACES IT PINS THE COMPOSED NAME, not two counts, and that is
  // the whole difference: a content-named button can satisfy a count, but it
  // cannot produce "Weekly ping (1) Default". Both halves of the
  // `tpl.isDefault ? … : token` ternary get their own `it()` — vitest aborts at
  // the first hard assertion, so folding them together would leave whichever
  // ran second unproved — and each is written so the OTHER branch's mutant
  // passes it, which is what makes them isolate.
  // ★ Neither is collision coverage and neither should be read as such; the
  // uniqueness assertion above is.
  it("keeps the occurrence token AND the default badge in a colliding default row's name", () => {
    setup(collidingTemplates);
    // c1 is the only default and leads the colliding trio. The badge is visible
    // text INSIDE the button, so it has to survive into the accessible name
    // (information parity, and WCAG 2.5.3 containment) alongside the token.
    expect(buttonNames()).toContain(`Weekly ping (1) ${t("en-US", "commTplDefaultBadge")}`);
  });

  it("leaves the default badge off a non-default row's name", () => {
    setup(collidingTemplates);
    // The ternary's other branch. Making the badge UNCONDITIONAL leaves every
    // name distinct and every count unchanged, so only an exact-name assertion
    // on a non-default row catches it — and dropping the ternary entirely still
    // satisfies this one, which is what keeps the two tests independent.
    expect(buttonNames()).toContain("Weekly ping (2)");
  });

  // ★★ WCAG 2.4.6 — a version name is whatever `window.prompt` returned
  // (`saveCurrentVersion`), and nothing on any backend constrains it, so two
  // versions can share one. Both of that row's controls interpolated the raw
  // name, so "Compare: draft" and "Restore: draft" each appeared twice.
  async function openVersionList() {
    setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    // The editor is lazy; awaiting it also guarantees the `selected` subtree
    // (which holds the version list) has committed.
    await screen.findByLabelText("Body");
  }

  it("gives every version-list control a row-unique accessible name when two versions share a name", async () => {
    mockVersions = [version({ id: "v-a", name: "draft" }), version({ id: "v-b", name: "draft" })];
    await openVersionList();
    // 11 = measured for this fixture (whole-document scope): one row name
    // button, "Set as default", "Delete", "Create", "Cancel editing", "Save
    // version", the Current row's Compare, and Compare+Restore per version.
    expectRowUniqueNames({ minControls: 11, requireCollisionSeed: true });
  });

  it("numbers the Current pseudo-row too when a saved version is named after it", async () => {
    // The Current row is part of the SAME rendered list and carries the SAME
    // verb, so it has to share the token map — otherwise a version the user
    // literally named "Current" collides with it and only one of the two pair
    // members can be numbered.
    mockVersions = [version({ id: "v-a", name: t("en-US", "commTplCurrent") })];
    await openVersionList();
    const names = buttonNames();
    const compare = t("en-US", "commTplCompare");
    const current = t("en-US", "commTplCurrent");
    expect(names).toContain(`${compare}: ${current} (1)`);
    expect(names).toContain(`${compare}: ${current} (2)`);
  });
});
