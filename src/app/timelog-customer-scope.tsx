// src/app/timelog-customer-scope.tsx
// Presentational customer-scope picker for the Time-bookings header: a wildcard
// filter box + a customer <select>. When a customer is chosen the panel scopes
// the booking fetch to that customer's projects. Pure — filter/selection state +
// the lazy customer load are owned by the panel and passed as props.
import { t, type Lang } from "./i18n";
import { Input, Select } from "./form-controls";
import { ClearableSearchInput } from "./clearable-search-input";

export type CustomerOption = { id: number; name: string };

interface TimelogCustomerScopeProps {
  lang: Lang;
  value: number | "";
  options: readonly CustomerOption[];
  filter: string;
  disabled: boolean;
  onFilterChange: (value: string) => void;
  onSelectChange: (value: number | "") => void;
  /** Lazy-load the customer directory on first focus of either control. */
  onFocusLoad: () => void;
}

export function TimelogCustomerScope({
  lang,
  value,
  options,
  filter,
  disabled,
  onFilterChange,
  onSelectChange,
  onFocusLoad,
}: TimelogCustomerScopeProps) {
  return (
    <>
      {/* The sizing lives on the POSITIONING wrapper and the field goes w-full:
          leaving the width on the field would size it independently of the box the
          clear button is absolutely positioned against, so the ✕ would land
          off-target.

          ★ `clearLabel` is QUALIFIED, not a bare "Clear": this view renders a
          second clear button for the projects filter, and two controls
          announcing the same name is a WCAG 2.4.6 failure the axe gate cannot
          see (a name exists, so it passes). Mirrors the row-unique
          `${edit} – ${row.name}` pattern used elsewhere. */}
      <ClearableSearchInput
        value={filter}
        onClear={() => onFilterChange("")}
        clearLabel={`${t(lang, "clear")} – ${t(lang, "timelogCustomerLabel")}`}
        className="w-[21rem] print:hidden"
      >
        <Input
          type="search"
          size="xs"
          aria-label={t(lang, "timelogCustomerFilter")}
          placeholder={t(lang, "timelogCustomerFilter")}
          value={filter}
          disabled={disabled}
          onFocus={onFocusLoad}
          onChange={(e) => onFilterChange(e.target.value)}
          className={`w-full ${filter ? "pr-8" : ""} [&::-webkit-search-cancel-button]:appearance-none`}
        />
      </ClearableSearchInput>
      <Select
        size="xs"
        aria-label={t(lang, "timelogCustomerLabel")}
        value={value === "" ? "" : String(value)}
        disabled={disabled}
        onFocus={onFocusLoad}
        onChange={(e) => onSelectChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="max-w-[20rem] print:hidden"
      >
        <option value="">{t(lang, "timelogCustomerAll")}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
    </>
  );
}
