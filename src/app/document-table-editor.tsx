// The table block editor. Split out of document-block-editors.tsx (Task 8 of
// the documents-s3b slice) once that file crossed the ~400-line split
// threshold — see its own header comment for why `useBlockDraft` and
// `BlockReadOnlyNotice` stay there as the shared template rather than being
// duplicated here.
//
// ★★★ TABLE REPEATS CONTROLS ON THREE AXES AT ONCE — block, row, AND column —
//  so this is the one editor where the bullets editor's block-qualifier
//  pattern (`documentsBlockN` joined onto the base label with an en dash,
//  NEVER a bare trailing digit — see `BulletsBlockEditor`'s header comment)
//  has to be applied even to labels that already vary by row+column
//  (`documentsTableCell`, `documentsTableColumnHeader`, `documentsRemoveRow`,
//  `documentsRemoveColumn`). Row/column numbers alone only disambiguate
//  WITHIN one table block — two sibling table blocks of the same shape would
//  otherwise render byte-identical cell and button names, and axe cannot see
//  that collision at any seed size (AGENTS.md a11y hard-constraint section).
//  The multi-block test below is the only possible detector.
import { t } from "./i18n";
import type { DocBlock } from "./document-model";
import { type BlockEditorProps, useBlockDraft } from "./document-block-editors";

type TableDraft = {
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
};

export function TableBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "table" }>>) {
  const { value, setValue, commit, commitValue } = useBlockDraft(
    (b: Extract<DocBlock, { type: "table" }>): TableDraft => ({
      caption: b.caption ?? "",
      columns: b.columns,
      rows: b.rows,
    }),
    block,
    index,
    // ★ Caption is OPTIONAL and sparse: an empty one is omitted, so a table
    //  that never had a caption serializes exactly as it did before.
    (v): DocBlock =>
      v.caption
        ? { type: "table", caption: v.caption, columns: [...v.columns], rows: v.rows.map((r) => [...r]) }
        : { type: "table", columns: [...v.columns], rows: v.rows.map((r) => [...r]) },
    onCommit,
  );

  const blockQualifier = t(lang, "documentsBlockN", String(index + 1));
  const qualify = (label: string) => `${label} – ${blockQualifier}`;

  const editCaption = (text: string) => setValue((prev) => ({ ...prev, caption: text }));

  const editColumnHeader = (c: number, text: string) => {
    setValue((prev) => {
      const columns = [...prev.columns];
      columns[c] = text;
      return { ...prev, columns };
    });
  };

  const editCell = (r: number, c: number, text: string) => {
    setValue((prev) => ({
      ...prev,
      rows: prev.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? text : cell)) : row)),
    }));
  };

  // Structural actions (add/remove) have no blur event to hang a deferred
  // commit off, so they go through `commitValue` — synchronous, resolved
  // against the shared `liveValueRef` — exactly like the bullets editor's
  // add/remove/move/toggle. See `useBlockDraft`'s own doc comment for why
  // that has to be a synchronous commit rather than a `setValue` + a later
  // effect.
  const addRow = () => {
    commitValue((prev) => ({ ...prev, rows: [...prev.rows, prev.columns.map(() => "")] }));
  };

  // ★ Adding or removing a column touches the header AND every row in ONE
  //  commit — a column added to only one of the two makes the table ragged,
  //  and the renderers assume rectangularity.
  const addColumn = () => {
    commitValue((prev) => ({
      ...prev,
      columns: [...prev.columns, ""],
      rows: prev.rows.map((row) => [...row, ""]),
    }));
  };

  // ★ The two remove buttons below are DISABLED (a real `disabled` attribute,
  //  never `aria-disabled` — that lookalike still fires `onClick`, which
  //  this repo has been bitten by) once only one row/column remains, mirroring
  //  the bullets editor's move-up/down boundary disable. Nothing else in this
  //  file stops a table shrinking to 0×0.
  const removeRow = (r: number) => {
    commitValue((prev) => ({ ...prev, rows: prev.rows.filter((_, j) => j !== r) }));
  };

  const removeColumn = (c: number) => {
    commitValue((prev) => ({
      ...prev,
      columns: prev.columns.filter((_, j) => j !== c),
      rows: prev.rows.map((row) => row.filter((_, j) => j !== c)),
    }));
  };

  return (
    <div className="flex flex-col gap-2" onBlur={commit}>
      <input
        type="text"
        aria-label={qualify(t(lang, "documentsTableCaption"))}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground"
        value={value.caption}
        onChange={(e) => editCaption(e.target.value)}
      />

      <div className="overflow-x-auto">
        <table className="w-max text-sm">
          <thead>
            <tr>
              {value.columns.map((col, c) => (
                <th key={c} className="px-1 py-1 text-left font-medium">
                  <input
                    type="text"
                    aria-label={qualify(t(lang, "documentsTableColumnHeader", String(c + 1)))}
                    className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-foreground"
                    value={col}
                    onChange={(e) => editColumnHeader(c, e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={qualify(t(lang, "documentsRemoveColumn", String(c + 1)))}
                    disabled={value.columns.length <= 1}
                    className="ml-1 rounded-md border border-line px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => removeColumn(c)}
                  >
                    <span aria-hidden="true">{"✕"}</span>
                  </button>
                </th>
              ))}
              {/* ★★ PAIRS WITH THE PER-ROW REMOVE BUTTON'S <td> BELOW. Without
                  it every body row was one cell wider than the header — a
                  ragged table the renderers' rectangularity assumption does
                  not cover, and a grid column a screen reader enters unnamed.
                  ★ `sr-only` because the column shows one icon-only button
                  whose own name already says what it does; same convention as
                  documents-list.tsx's action column.
                  ★ Its OWN key — reusing `documentsRemoveRow` would announce
                  the COLUMN as "Remove row {0}", i.e. name a column after a
                  single one of its buttons.
                  ★ NOT block-qualified: a <th> is scoped by its own table
                  element, so unlike the per-row CONTROLS it cannot collide
                  with a sibling table block's header. */}
              <th className="px-1 py-1 text-left font-medium">
                <span className="sr-only">{t(lang, "documentsTableRowActions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {value.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="px-1 py-1">
                    <input
                      type="text"
                      aria-label={qualify(t(lang, "documentsTableCell", String(r + 1), String(c + 1)))}
                      className="w-32 rounded-md border border-line bg-surface px-2 py-1 text-foreground"
                      value={cell}
                      onChange={(e) => editCell(r, c, e.target.value)}
                    />
                  </td>
                ))}
                <td className="px-1 py-1">
                  <button
                    type="button"
                    aria-label={qualify(t(lang, "documentsRemoveRow", String(r + 1)))}
                    disabled={value.rows.length <= 1}
                    className="rounded-md border border-line px-2 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => removeRow(r)}
                  >
                    <span aria-hidden="true">{"✕"}</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ★ Visible labels stay the plain, unqualified "Add row"/"Add column"
         — only the accessible name carries the block qualifier (mirrors
         ToggleButton's WCAG 4.1.2 contract and the bullets editor's
         Add-item button). WCAG 2.5.3 still holds: the accessible name
         CONTAINS the visible text. */}
      <div className="flex gap-2">
        <button
          type="button"
          aria-label={qualify(t(lang, "documentsAddRow"))}
          className="rounded-md border border-line px-2 py-1 text-xs"
          onClick={addRow}
        >
          {t(lang, "documentsAddRow")}
        </button>
        <button
          type="button"
          aria-label={qualify(t(lang, "documentsAddColumn"))}
          className="rounded-md border border-line px-2 py-1 text-xs"
          onClick={addColumn}
        >
          {t(lang, "documentsAddColumn")}
        </button>
      </div>
    </div>
  );
}
