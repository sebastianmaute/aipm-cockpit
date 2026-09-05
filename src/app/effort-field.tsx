"use client";

import { useId, useState } from "react";
import { formatDuration, parseDuration } from "./duration";
import { FieldNotice } from "./field-feedback";
import { Input } from "./form-controls";
import { type Lang, t } from "./i18n";
import { Field } from "./task-form-layout";

/** A duration text input over `parseDuration`/`formatDuration` (w/d/h/m).
 *
 *  Extracted from `task-form-fields.tsx` so the Time tracking dialog can reuse
 *  it. `minutes` seeds the text ONCE via lazy `useState` — the box is
 *  free-text while focused and must not be re-formatted under the user's
 *  cursor, so a caller forces a reseed by REMOUNTING this component. The
 *  invariant is "reseed on remount" — a `key` and a conditional mount satisfy
 *  it equally, so state the requirement that way rather than counting call
 *  sites. The task form's estimate field is inside a long-lived form and so
 *  passes an explicit `key`; the Time tracking dialog's two boxes carry none
 *  and need none, because the dialog itself is mounted only while open and
 *  therefore remounts on every open. Anything reusing this from a surface that
 *  outlives the value it seeds from needs the `key`. */
export function EffortField({
  lang,
  label,
  minutes,
  onChange,
  placeholder,
  captionHint,
  onValidityChange,
}: {
  lang: Lang;
  label: string;
  minutes: number | undefined;
  onChange: (minutes: number | undefined) => void;
  /** Overrides the default `taskEffortHint` placeholder — the dialog's
   *  remaining box shows the DERIVED figure here instead. */
  placeholder?: string;
  /** Optional InfoTooltip text beside the caption. */
  captionHint?: string;
  /** Fires whenever the box crosses between parsable and not. Unparsable text
   *  is NOT reported through `onChange` — the parent keeps its last valid
   *  number — so a caller with a Save button must gate that button on this
   *  instead, or it commits a number the user believes they replaced. */
  onValidityChange?: (valid: boolean) => void;
}) {
  // ★ A defined `minutes` that `formatDuration` renders empty (≤ 0, NaN
  //   included) must still render "0m": empty is pixel-identical to "not
  //   overridden", and the 0-vs-undefined distinction is the whole point of
  //   this field (`types.ts` — "Never 0 for 'not overridden'").
  const [text, setText] = useState(() =>
    minutes === undefined ? "" : formatDuration(minutes) || "0m",
  );
  const [invalid, setInvalid] = useState(false);
  const noticeId = useId();

  const applyInvalid = (next: boolean) => {
    setInvalid(next);
    if (next !== invalid) onValidityChange?.(!next);
  };

  return (
    <Field label={label} hint={captionHint}>
      <Input
        type="text"
        value={text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          if (value.trim() === "") {
            applyInvalid(false);
            onChange(undefined);
            return;
          }
          const mins = parseDuration(value);
          if (mins === null) {
            applyInvalid(true);
            return;
          }
          applyInvalid(false);
          onChange(mins);
        }}
        placeholder={placeholder ?? t(lang, "taskEffortHint")}
        invalid={invalid}
        aria-describedby={invalid ? noticeId : undefined}
        className="w-full"
      />
      {invalid && <FieldNotice id={noticeId}>{t(lang, "taskEffortInvalid")}</FieldNotice>}
    </Field>
  );
}
