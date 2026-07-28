// Pure i18n-free `*` wildcard matching for user-typed filter text. The single
// owner of the query→RegExp translation: `customerMatcher` (timelog scope
// filters) and `filterPickerOptions` (every chip picker) both delegate here, so
// the regex-escape can't drift between them — and `dup:check` is blocking.
//
// Semantics, deliberately narrow: `*` spans any run of characters, everything
// else is LITERAL (a query is user text, not a pattern language), matching is
// case-insensitive and UNANCHORED. Consequence worth knowing: a query with no
// `*` behaves exactly like `String.includes` on the lowercased text, so
// adopting this matcher never changes existing behaviour.

/** `*` is a wildcard, everything else literal. Case-insensitive substring. */
export function wildcardMatcher(query: string): (text: string) => boolean {
  const q = query.trim().toLowerCase();
  if (!q) return () => true;
  const escaped = q
    .split("*")
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const re = new RegExp(escaped, "i");
  return (text: string) => re.test(text);
}
