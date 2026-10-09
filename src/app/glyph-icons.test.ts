// §689 — controls and status marks that drew text glyphs (× ✕ ⋮ ↑ ↓ ▸ ▾ ✓ ⚠) now
// draw icons from icons.ts. A SOURCE check, per file: the glyph form is gone and
// the icon is rendered the expected number of times. Rendering each of these
// sixteen components needs a fixture apiece, and a glyph coming back is a
// source-level regression, which is exactly what this reads. The patterns use
// alternation, never a bracket expression: a bracket expression splits these
// multibyte characters into bytes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (f: string) => readFileSync(join(process.cwd(), "src", "app", f), "utf8");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

// A glyph alone on its line (the register's reproduce form), a glyph in an
// aria-hidden span, a glyph as a JSX string literal, or a status mark at the
// start of a text run.
const GLYPH_FORMS = [
  /^\s*(×|✕|⋮|▸)\s*$/gm,
  /<span aria-hidden(="true")?>\{?"?(×|✕|↑|↓|⚠)"?\}?<\/span>/g,
  /\{"(↑|↓|✕|×)"\}/g,
  /(>|\s)(✓|⚠) \{/g,
  /✓\{" "\}/g,
  /\{t\(lang, "reminderSnooze"\)\} ▾/g,
];

const CASES: readonly [file: string, icon: string, min: number][] = [
  ["chat-panel.tsx", "XMarkIcon", 2],
  ["history-panel.tsx", "XMarkIcon", 2],
  ["knowledge-panel.tsx", "XMarkIcon", 2],
  ["project-form-fields.tsx", "XMarkIcon", 1],
  ["create-project-wizard.tsx", "XMarkIcon", 1],
  ["bullets-block-editor.tsx", "XMarkIcon", 1],
  ["bullets-block-editor.tsx", "ArrowUpIcon", 1],
  ["bullets-block-editor.tsx", "ArrowDownIcon", 1],
  ["document-table-editor.tsx", "XMarkIcon", 2],
  ["action-cta-controls.tsx", "EllipsisVerticalIcon", 1],
  ["task-row.tsx", "EllipsisVerticalIcon", 1],
  ["arrangement-tile.tsx", "EllipsisVerticalIcon", 1],
  ["jira-settings.tsx", "ChevronRightIcon", 1],
  ["jira-settings.tsx", "CheckIcon", 2],
  ["jira-settings.tsx", "ExclamationTriangleIcon", 1],
  ["notifications.tsx", "ChevronDownIcon", 1],
  ["storage-config.tsx", "CheckIcon", 2],
  ["settings-sections/ai-section.tsx", "CheckIcon", 1],
  ["sidebar-footer.tsx", "ExclamationTriangleIcon", 1],
  ["integration-disclaimer.tsx", "ExclamationTriangleIcon", 1],
  ["document-links-field.tsx", "ExclamationTriangleIcon", 1],
];

describe("§689 — glyphs are icons from icons.ts", () => {
  it.each(CASES)("%s renders %s at least %i time(s)", (file, icon, min) => {
    expect(count(src(file), new RegExp(`<${icon}\\b`, "g"))).toBeGreaterThanOrEqual(min);
  });

  it.each([...new Set(CASES.map(([f]) => f))])("%s has no glyph-drawn control or status mark left", (file) => {
    const s = src(file);
    const hits = GLYPH_FORMS.flatMap((re) => s.match(re) ?? []);
    expect(hits).toEqual([]);
  });

  // ★ Positive control: the forms above must match the markup they were written
  // for, or a clean result above means nothing.
  it("the glyph forms match the old markup", () => {
    const old = [
      "            ×\n",
      '<span aria-hidden="true">✕</span>',
      '<span aria-hidden="true">{"↑"}</span>',
      "<>✓ {status.message}</>",
      '                      ✓{" "}',
      '{t(lang, "reminderSnooze")} ▾',
      '<span aria-hidden="true">⚠</span>',
      "              ▸\n",
    ];
    for (const o of old) {
      expect(GLYPH_FORMS.some((re) => { re.lastIndex = 0; return re.test(o); }), o).toBe(true);
    }
  });
});
