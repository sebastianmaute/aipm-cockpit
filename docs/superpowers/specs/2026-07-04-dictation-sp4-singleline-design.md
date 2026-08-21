# Push-to-Talk Dictation — SP4 (Single-line Inputs) Design

**Goal:** Extend the dictation mic to the free-text single-line title/name inputs, reusing `useDictationMic` — so those fields get a mic + are reachable by the global hotkey.

**Context:** SP4 of sub-project C. SP3 shipped `useDictationMic` (mic button + preview + focus-registration) on 5 prose *textareas*, plus `dictation-target` + the configurable global hotkey. SP4 wires the same hook onto free-text single-line inputs. Pure UI reuse — no new engine/hook/secret/setting.

**Approved decisions:** all free-text prose single-line inputs (task title · RAID title · change title · milestone name · stakeholder name/organization/title). Append space-aware + apply each field's existing `describeTextCap`. Person fields (owner/requestedBy/decisionBy/assignee — pickers/resource-resolved) + email/number/date/enum inputs excluded.

---

## Target fields
| File | Field | Setter pattern | Cap |
|---|---|---|---|
| `task-form-fields.tsx` | `taskName` | `setForm(prev => …)` (functional, local) | `TASK_NAME_MAX` |
| `raid-edit-modal.tsx` | `title` | parent `onChange({...draftRef.current, …})` | `TASK_NAME_MAX` |
| `change-edit-modal.tsx` | `title` | `update("title", …)` (reads `draftRef.current`) | `BUDGET_NAME_MAX` |
| `milestone-edit-modal.tsx` | `name` | `setDraft(p => …)` (functional, local) | its existing cap |
| `stakeholder-edit-modal.tsx` | `name` / `organization` / `title` | `onChange`/`update` (via `draftRef.current`) | `BUDGET_NAME_MAX` |

## Wiring (per field — same as SP3 textareas)
```tsx
const { settings } = useSettings();
const { mic, status, registration } = useDictationMic({
  lang, dictation: settings.dictation, enabled: true,
  label: <field label>,
  onAppendFinal: (txt) => <setter>((/* latest */) => ({ ...latest, <field>: cap(appendDictation(latest.<field> ?? "", txt)) })),
});
```
- `cap(x)` = `describeTextCap(x, <MAX>).value` (no `.trim()` mid-append — the field's existing `onBlur` still trims; trimming here would eat a trailing space needed before the next segment). So dictation can't overflow the length cap.
- Render `{mic}` inline in the field's label row; `{status}` just below the input.
- Attach `{...registration}` (`onFocus`/`onBlur`) to the `<input>`; **compose** with any existing `onBlur` (the cap-on-blur handler) so both fire.
- ★★ MULTI-`onFinal` LANDMINE (SP3): Web Speech fires `onFinal` several times per hold. Fields whose draft is **parent-owned** (RAID/change/stakeholder — `onChange`/`update`) MUST read the LATEST draft via a `draftRef` (`const draftRef = useRef(draft); useEffect(() => { draftRef.current = draft; })`) inside `onAppendFinal`, else each segment overwrites the last. Task-title (`setForm(prev=>…)`) and milestone (`setDraft(p=>…)`) are already functional-setter-safe. (These files ALREADY have a `draftRef` from SP3's textarea wiring — reuse it.)

## Boundary / error handling
- Pure reuse: no new engine/hook/secret/CSP; `useDictationMic` centralizes the mic-denied/stt/unsupported toasts + is `supported`-gated. Fields persist via existing save paths.
- The global hotkey works automatically (single-line inputs register as targets on focus).

## Testing
- One "mic renders + append respects cap" test where a harness exists (task-form-fields at minimum); the rest tsc/lint-verified.
- A focused unit for the append-with-cap on a near-cap value (append must not exceed the cap).
- Chat/modals not in axe gate → mic a11y eye-verified (mic button carries `dictationHold` label from the shared hook).

## Out of scope
- Person/picker fields, email/number/date/enum inputs.
- Any new dictation engine/hotkey/secret (all reused).
