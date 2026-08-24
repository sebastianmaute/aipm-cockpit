// The bullets block editor. Split out of document-block-editors.tsx (task 3
// of the fix/documents-headroom-asset-policy slice, open-followups §220) once
// that file sat at the file-size gate's 800-line cap with zero headroom — see
// its own header comment for why `useBlockDraft` and `BlockReadOnlyNotice`
// stay there as the shared template rather than being duplicated here.
import { t } from "./i18n";
import type { DocBlock } from "./document-model";
import { type BlockEditorProps, useBlockDraft } from "./document-block-editors";
import { BlockRefusalNotice } from "./document-block-notices";
import { ToggleButton } from "./toggle-button";
import { Button } from "./button";
import { Input } from "./form-controls";

type BulletsDraft = { items: readonly string[]; ordered: boolean };

/**
 * The first editor with N controls of the SAME kind per block (per-item move/
 * remove, plus add) — so unlike heading/paragraph, its labels need to be
 * unique on TWO axes at once: across sibling bullets blocks (like every other
 * editor here) AND across items within one block. Two of its labels have no
 * `{0}` placeholder to carry the item number at all (`documentsListOrdered`,
 * `documentsAddItem`), so EVERY control here is qualified with the block
 * position via `documentsBlockN` ("Block {0}"), joined onto the base label
 * with an en dash — never a bare trailing digit, which reads as part of the
 * label's OWN number ("Remove item 1 1" looks like two item numbers, not an
 * item-in-a-block). The qualifier goes in `aria-label`, never the visible
 * text: the Add button's VISIBLE label stays the plain "Add item" a sighted
 * user reads, exactly as `ToggleButton`'s WCAG 4.1.2 contract already keeps
 * the toggle's visible label unqualified below.
 *
 * ★ Still a THIN consumer of `useBlockDraft`: every action (typing, add,
 *  remove, move, toggle) goes through the hook's own `setValue`/`commit`/
 *  `commitValue` — no second copy of the dirty-check/baseline/unmount-flush/
 *  concurrent-write logic. `commitValue` is what add/remove/move/toggle use,
 *  since a button click has no blur event to hang a deferred `commit()`
 *  off; see its doc comment on `useBlockDraft` for why that has to be a
 *  synchronous commit rather than a `setValue` + a later effect.
 */
export function BulletsBlockEditor({
  lang,
  index,
  block,
  onCommit,
}: BlockEditorProps<Extract<DocBlock, { type: "bullets" }>>) {
  const { value, setValue, commit, commitValue, refusal } = useBlockDraft(
    (b: Extract<DocBlock, { type: "bullets" }>): BulletsDraft => ({
      items: b.items,
      ordered: b.ordered === true,
    }),
    block,
    index,
    (v): DocBlock =>
      v.ordered
        ? { type: "bullets", items: [...v.items], ordered: true }
        : { type: "bullets", items: [...v.items] },
    onCommit,
  );

  const blockQualifier = t(lang, "documentsBlockN", String(index + 1));
  const qualify = (label: string) => `${label} – ${blockQualifier}`;

  // Functional updaters throughout: `commitValue` resolves each against the
  // shared `liveValueRef`, not this render's `value`, so two of these fired
  // in one batched event (a real double-click, or `act(() => { a.click();
  // b.click() })`) each see the OTHER's already-applied change instead of
  // both reading the same pre-batch snapshot and one clobbering the other.
  const moveItem = (from: number, to: number) => {
    commitValue((prev) => {
      const items = [...prev.items];
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return { ...prev, items };
    });
  };

  const removeItem = (i: number) => {
    commitValue((prev) => ({ ...prev, items: prev.items.filter((_, j) => j !== i) }));
  };

  const addItem = () => {
    commitValue((prev) => ({ ...prev, items: [...prev.items, ""] }));
  };

  const toggleOrdered = () => {
    commitValue((prev) => ({ ...prev, ordered: !prev.ordered }));
  };

  return (
    <div className="flex flex-col gap-2" onBlur={commit}>
      <ToggleButton
        pressed={value.ordered}
        onToggle={toggleOrdered}
        lang={lang}
        ariaLabel={qualify(t(lang, "documentsListOrdered"))}
      >
        {t(lang, "documentsListOrdered")}
      </ToggleButton>

      <ul className="flex flex-col gap-1">
        {value.items.map((item, i) => (
          <li key={i} className="flex items-center gap-1">
            <Input
              aria-label={qualify(t(lang, "documentsListItem", String(i + 1)))}
              className="flex-1"
              size="xs"
              value={item}
              onChange={(e) => {
                const text = e.target.value;
                setValue((prev) => {
                  const items = [...prev.items];
                  items[i] = text;
                  return { ...prev, items };
                });
              }}
            />
            <Button
              variant="secondary"
              size="xs"
              aria-label={qualify(t(lang, "documentsMoveItemUp", String(i + 1)))}
              disabled={i === 0}
              onClick={() => moveItem(i, i - 1)}
            >
              <span aria-hidden="true">{"↑"}</span>
            </Button>
            <Button
              variant="secondary"
              size="xs"
              aria-label={qualify(t(lang, "documentsMoveItemDown", String(i + 1)))}
              disabled={i === value.items.length - 1}
              onClick={() => moveItem(i, i + 1)}
            >
              <span aria-hidden="true">{"↓"}</span>
            </Button>
            <Button
              variant="secondary"
              size="xs"
              aria-label={qualify(t(lang, "documentsRemoveItem", String(i + 1)))}
              // ★ Mirrors document-table-editor.tsx's remove-row/remove-column
              //  bounds. Removing the last item produces `items: []`, which
              //  document-model.ts drops on load — the block would render for
              //  the session and vanish, with no add-block control to bring it
              //  back. A real `disabled` attribute, never `aria-disabled`:
              //  the lookalike still fires onClick.
              disabled={value.items.length <= 1}
              onClick={() => removeItem(i)}
            >
              <span aria-hidden="true">{"✕"}</span>
            </Button>
          </li>
        ))}
      </ul>

      <div>
        <Button
          variant="secondary"
          size="xs"
          aria-label={qualify(t(lang, "documentsAddItem"))}
          onClick={addItem}
        >
          {t(lang, "documentsAddItem")}
        </Button>
      </div>
      {refusal && <BlockRefusalNotice lang={lang} refusal={refusal} />}
    </div>
  );
}
