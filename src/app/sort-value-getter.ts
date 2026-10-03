// A sortable report table's `getValue`, built from one accessor per sort key (open-followups §7, A4).
//
// The hand-written form was an if-chain whose LAST `return` answered for whatever key was left, so
// adding a sort key without a branch silently sorted the new column by the last one's value. Here
// the map's type requires every key: pass both type arguments at the call site and a missing or
// misspelt key is a compile error.

export type SortValueMap<Row, Key extends string> = { readonly [K in Key]: (row: Row) => string | number };

export function sortValueGetter<Row, Key extends string>(
  byKey: SortValueMap<Row, Key>,
): (row: Row, key: Key) => string | number {
  return (row, key) => byKey[key](row);
}
