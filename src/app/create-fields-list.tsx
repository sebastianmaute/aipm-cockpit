"use client";

// §440 — the fields an AI create will write, listed under its "Create …" line
// on all three review surfaces (chat proposal card, inline Ask-Claude popover,
// insight recommendation review). One component so the three cannot drift.
import type { Lang } from "./i18n";
import type { NewItem } from "./inline-ai-edit/plan";
import type { InlineEntity } from "./inline-ai-edit/entity-descriptor";
import { fieldLabel } from "./inline-ai-edit/field-labels";

export function CreateFieldsList({ lang, item }: { lang: Lang; item: NewItem }) {
  if (item.fields.length === 0) return null;
  return (
    <ul className="ml-4 list-disc">
      {item.fields.map((f) => (
        <li key={f.field}>
          <span className="font-medium">{fieldLabel(lang, item.entity as InlineEntity, f.field)}</span>: {f.value}
        </li>
      ))}
    </ul>
  );
}
