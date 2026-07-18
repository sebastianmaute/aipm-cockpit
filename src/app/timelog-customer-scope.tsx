// src/app/timelog-customer-scope.tsx
// Presentational customer-scope picker for the Time-bookings header: a wildcard
// filter box + a customer <select>. When a customer is chosen the panel scopes
// the booking fetch to that customer's projects. Pure — filter/selection state +
// the lazy customer load are owned by the panel and passed as props.
import { t, type Lang } from "./i18n";
import { Input, Select } from "./form-controls";

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
      <Input
        type="search"
        size="xs"
        aria-label={t(lang, "timelogCustomerFilter")}
        placeholder={t(lang, "timelogCustomerFilter")}
        value={filter}
        disabled={disabled}
        onFocus={onFocusLoad}
        onChange={(e) => onFilterChange(e.target.value)}
        className="w-28 print:hidden"
      />
      <Select
        size="xs"
        aria-label={t(lang, "timelogCustomerLabel")}
        value={value === "" ? "" : String(value)}
        disabled={disabled}
        onFocus={onFocusLoad}
        onChange={(e) => onSelectChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="max-w-[14rem] print:hidden"
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
