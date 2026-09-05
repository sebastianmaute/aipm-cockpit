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
 *  cursor, so remount (a `key`) is how a caller forces a reseed. Both existing
 *  call sites already pass `key={`estimate-${editingId ?? "new"}`}` for that
 *  reason; keep doing so. */
export function EffortField({
  lang,
  label,
  minutes,
  onChange,
  placeholder,
  captionHint,
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
}) {
  const [text, setText] = useState(() => formatDuration(minutes ?? 0));
  const [invalid, setInvalid] = useState(false);
  const noticeId = useId();

  return (
    <Field label={label} hint={captionHint}>
      <Input
        type="text"
        value={text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          if (value.trim() === "") {
            setInvalid(false);
            onChange(undefined);
            return;
          }
          const mins = parseDuration(value);
          if (mins === null) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
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
