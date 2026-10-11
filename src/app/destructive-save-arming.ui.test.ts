import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SLICE_POLICY } from "./workspace-slice-policy";

/**
 * The UI half of the destructive-save arming invariant (docs/open-followups.md §293).
 *
 * `destructive-save-arming.test.ts` walks `TOOL_DEFS`, so every AI removal tool
 * must carry an arming decision. The UI surface has no such declaration, and a
 * hand-kept list of delete routes was rejected (2026-08-30 spec: whoever forgets
 * the arming call forgets the list line too, and nothing forces a new handler to
 * join it). This file DISCOVERS the routes from the code instead: every call to
 * a counted slice's setter whose argument contains a `.filter(` — the shape of a
 * removal — must sit in a function that calls `allowDestructiveSave`, or carry a
 * written reason in `UNARMED_BY_DESIGN`. A new filter-delete therefore fails here
 * until someone decides, which a registry could never force.
 *
 * Since 2026-10-08 a removal SHAPE is any of: a `.filter(` or `.splice(` in the
 * setter's value, a value or updater that results in `[]`, or a local variable
 * initialised by a `.filter(`/`.splice(` and handed to the setter. Since batch 21
 * also a COMMITTER: a setter handed a parameter of its own function, so a list
 * computed by any caller passes through it (`commitBuckets` in
 * `use-budget-buckets.ts` is the one today; `isParameterHandOff` says what it
 * does not see). Since 2026-10-11 also a CONDITIONAL clear (`setX(cond ? [] : p)`,
 * see `isEmptyArrayResult` for the one normalisation it lets through), and a
 * filtered local declared in an ENCLOSING function, not only the nearest one.
 *
 * Since 2026-10-11 a committer's parameter may also be destructured, or aliased by
 * a local before it is handed on (`isParameterHandOff`), and a rebuild accumulator
 * (a local initialised to `[]` and handed to the setter) counts as a site: whether
 * its loop skips a row is not something this scan can read, so a person decides.
 *
 * ★★★ ITS BOUND. A removal written another way passes unseen: a setter handed a
 * parameter of an OUTER function, an exempt accumulator whose loop later learns to
 * skip a row (its exemption names the function, not the loop), an alias made by
 * ASSIGNMENT rather than by an initialiser (`let l; l = next;`), a copy made any
 * other way than a lone spread (`next.slice()`, `[...next, x]`), a filtered local
 * or committer alias hidden by a same-named local in a sibling function or block
 * (each scope is searched whole, nested closures included, first match wins), a
 * generic setter such as the undo runner's (it arms by hand; nothing checks it),
 * or a counted slice's setter handed down under another name. Those stay a by-hand
 * review, as §293 records. And "the enclosing function calls it" is a PRESENCE
 * check, not an ordering or branch check — whether the arm fires on the right path
 * is each route's own test.
 *
 * ★ The setters are derived from `SLICE_POLICY`'s counted slices, so a newly
 * counted slice is scanned the day it is counted. Parsed with the TypeScript
 * parser, never a regex (`src/test/strip-comments.ts` records why).
 */

const APP = join(process.cwd(), "src", "app");
const ARM = "allowDestructiveSave";

/** A filter-into-setter site whose function deliberately does not arm, keyed
 *  `file#function#setter`. The reason must say why no arm is needed THERE, and
 *  `sites` is how many unarmed sites the key covers: a second filter-delete added
 *  under an exempt key then fails until someone reviews it and raises the count. */
const UNARMED_BY_DESIGN: Readonly<Record<string, { sites: number; reason: string }>> = {
  "use-task-row-handlers.ts#onDelete#setTasks": {
    sites: 1,
    reason:
      "One confirmed row, and isMassDeletion needs prev - cur >= 5, so it cannot trip the guard; an arm would only " +
      "hand the bypass to the next save (§323, pinned in is-workspace-empty.test.ts).",
  },
  "use-resource-directory.ts#purgeCalendarFor#setAbsences": {
    sites: 1,
    reason: "A helper, not a route: its two callers, handleDeleteResource and handleBulkDeleteResources, arm.",
  },
  "use-resource-directory.ts#purgeCalendarFor#setShifts": {
    sites: 1,
    reason: "A helper, not a route: its two callers, handleDeleteResource and handleBulkDeleteResources, arm.",
  },
  "use-reference-data.ts#onReorderDisciplines#setDisciplines": {
    sites: 1,
    reason: "A reorder: the filter drops only ids missing from prev, and the drag list passes every row's id.",
  },
  "use-reference-data.ts#onReorderGrades#setGrades": {
    sites: 1,
    reason: "A reorder: the filter drops only ids missing from prev, and the drag list passes every row's id.",
  },
};

interface Site { key: string; file: string; fn: string; setter: string; line: number; armed: boolean }

function countedSetters(): Set<string> {
  return new Set(
    Object.entries(SLICE_POLICY)
      .filter(([, p]) => p.counted)
      .map(([slice]) => `set${slice[0]!.toUpperCase()}${slice.slice(1)}`),
  );
}

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function contains(node: ts.Node, pred: (n: ts.Node) => boolean): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (pred(n)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

const isMethodCall = (name: string) => (n: ts.Node): boolean =>
  ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === name;
const isFilterCall = isMethodCall("filter");
const isSpliceCall = isMethodCall("splice");
const isEmptyArray = (n: ts.Node): boolean => ts.isArrayLiteralExpression(n) && n.elements.length === 0;

/** Strip parentheses and `as`/`<T>`/`satisfies`/`!` wrappers, so `([] as Task[])` reads as `[]`. */
function unwrap(n: ts.Expression): ts.Expression {
  for (;;) {
    if (
      ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isTypeAssertionExpression(n) ||
      ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n)
    ) n = n.expression;
    else return n;
  }
}

const NON_EMPTY_WHEN_TRUE: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.GreaterThanToken, "0"],
  [ts.SyntaxKind.ExclamationEqualsEqualsToken, "0"],
  [ts.SyntaxKind.ExclamationEqualsToken, "0"],
  [ts.SyntaxKind.GreaterThanEqualsToken, "1"],
]);
const EMPTY_WHEN_TRUE: ReadonlyMap<ts.SyntaxKind, string> = new Map([
  [ts.SyntaxKind.EqualsEqualsEqualsToken, "0"],
  [ts.SyntaxKind.EqualsEqualsToken, "0"],
  [ts.SyntaxKind.LessThanToken, "1"],
  [ts.SyntaxKind.LessThanEqualsToken, "0"],
]);

/** A condition that is exactly an emptiness test of one list, read as the list's name
 *  and which way it points: `X.length`, `X.length > 0`, `!== 0`, `!= 0`, `>= 1` are TRUE
 *  when X is non-empty; `=== 0`, `== 0`, `< 1`, `<= 0` are TRUE when it is empty; each
 *  leading `!` flips that. Anything else (another operator, another number, a `&&`, a
 *  comparison with a second list) is no emptiness test, and gets `undefined`. */
function lengthTestOf(cond: ts.Expression): { name: string; trueWhenEmpty: boolean } | undefined {
  let c = unwrap(cond);
  let flips = 0;
  while (ts.isPrefixUnaryExpression(c) && c.operator === ts.SyntaxKind.ExclamationToken) { flips++; c = unwrap(c.operand); }
  let trueWhenEmpty = false;
  if (ts.isBinaryExpression(c)) {
    const right = unwrap(c.right);
    if (!ts.isNumericLiteral(right)) return undefined;
    const op = c.operatorToken.kind;
    if (NON_EMPTY_WHEN_TRUE.get(op) === right.text) trueWhenEmpty = false;
    else if (EMPTY_WHEN_TRUE.get(op) === right.text) trueWhenEmpty = true;
    else return undefined;
    c = unwrap(c.left);
  }
  if (!(ts.isPropertyAccessExpression(c) && c.name.text === "length" && ts.isIdentifier(c.expression))) return undefined;
  return { name: c.expression.text, trueWhenEmpty: flips % 2 === 0 ? trueWhenEmpty : !trueWhenEmpty };
}

/** A value that IS `[]`, or a `?:` with a `[]` branch (`cond ? [] : p`), which drops
 *  every row whenever its condition picks that branch. ★ One normalisation is let
 *  through: the `[]` sits on the branch an emptiness test of `p` takes when `p` IS
 *  empty, with plain `p` on the other (`p.length ? p : []`, `!p.length ? [] : p`,
 *  `p.length === 0 ? [] : p`). That branch only ever replaces an empty list, so no
 *  row is lost, whatever it holds.
 *  The direction is checked: `p.length ? [] : p` empties a NON-empty list and counts,
 *  as does any condition `lengthTestOf` cannot read as an emptiness test. ★ It errs
 *  towards flagging: `p.length ? [...p] : []` or `p.length ? p.map(f) : []` is flagged
 *  too, because the other branch must be `p` itself. */
function isEmptyArrayResult(v: ts.Expression): boolean {
  const e = unwrap(v);
  if (isEmptyArray(e)) return true;
  if (!ts.isConditionalExpression(e)) return false;
  const yes = unwrap(e.whenTrue);
  const no = unwrap(e.whenFalse);
  const emptyBranch = isEmptyArrayResult(yes) ? "yes" : isEmptyArrayResult(no) ? "no" : undefined;
  if (!emptyBranch) return false;
  const other = emptyBranch === "yes" ? no : yes;
  const test = lengthTestOf(e.condition);
  const normalises =
    test !== undefined &&
    ts.isIdentifier(other) &&
    other.text === test.name &&
    test.trueWhenEmpty === (emptyBranch === "yes");
  return !normalises;
}

/** The value an expression or an updater arrow RESULTS in: `[]`, `() => []`, `(p) => { return []; }`,
 *  or any of those through a conditional (`cond ? [] : p`). */
function resultsInEmptyArray(arg: ts.Expression): boolean {
  const e = unwrap(arg);
  if (isEmptyArrayResult(e)) return true;
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
    if (!ts.isBlock(e.body)) return isEmptyArrayResult(e.body);
    return contains(e.body, (n) => ts.isReturnStatement(n) && !!n.expression && isEmptyArrayResult(n.expression));
  }
  return false;
}

/** The SHAPES of a removal this scan sees in a value: a `.filter(`, a `.splice(`, or a result of `[]`. */
const isRemovalValue = (v: ts.Expression): boolean =>
  contains(v, isFilterCall) || contains(v, isSpliceCall) || resultsInEmptyArray(v);

/** The initializer of `name`'s `const`/`let` declaration, looked up through the function
 *  scopes around `from`, nearest first, up to the file (`const kept = rows.filter(…);
 *  const h = () => setTasks(kept);` finds `kept` one function out). ★ Each scope is
 *  searched whole, nested functions included, so a same-named local in a SIBLING function
 *  can be found first. That cuts both ways: a sibling's `.filter(` flags a site that does
 *  not remove, and a sibling's plain local hides a `.filter(` declared further out. */
function localInitializer(from: ts.Node, name: string): ts.Expression | undefined {
  for (let scope: ts.Node | undefined = from.parent; scope; scope = scope.parent) {
    if (!ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) continue;
    let init: ts.Expression | undefined;
    contains(scope, (n) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) { init = n.initializer; return true; }
      return false;
    });
    if (init) return init;
  }
  return undefined;
}

/** A removal handed to the setter: its argument has a removal shape, or is a local
 *  variable initialised by a `.filter(` or `.splice(` (`const kept = prev.filter(…); setX(kept)`),
 *  or by `[]`. ★ That last one is the rebuild accumulator (`const next = []` then a push
 *  per kept row, as `use-jira-sync.ts` committed until §698). Whether it drops a row depends on its loop,
 *  which this scan cannot read, so it counts and fails CLOSED: an accumulator that keeps
 *  every row needs an `UNARMED_BY_DESIGN` reason, which a person writes after reading the loop.
 *  ★ It errs towards flagging: `let next = []; next = rows.map(f);` counts too.
 *  The local may be handed on as is (`kept`), as a copy (`[...kept]`) or from an updater
 *  (`() => kept`, `() => { return kept; }`), and through any chain of plain aliases
 *  (`const out = kept;`). */
function isRemovalArgument(arg: ts.Expression): boolean {
  if (isRemovalValue(arg)) return true;
  return handedOnNames(arg).some((name) => isRemovalLocal(arg, name, new Set()));
}

/** The name a value copies unchanged: `next` or `[...next]`. */
function copiedName(v: ts.Expression): string | undefined {
  let e = unwrap(v);
  const only = ts.isArrayLiteralExpression(e) && e.elements.length === 1 ? e.elements[0] : undefined;
  if (only && ts.isSpreadElement(only)) e = unwrap(only.expression);
  return ts.isIdentifier(e) ? e.text : undefined;
}

/** The locals an argument hands over unchanged: the value's own (`next`, `[...next]`), or
 *  each one an updater returns (`() => next`, `function () { return next; }`; returns in
 *  nested functions are not read). An updater's OWN parameter is never one: `(p) => p`
 *  keeps the list it is given, whatever an outer local named `p` holds. */
function handedOnNames(arg: ts.Expression): string[] {
  const e = unwrap(arg);
  if (!ts.isArrowFunction(e) && !ts.isFunctionExpression(e)) {
    const name = copiedName(e);
    return name === undefined ? [] : [name];
  }
  const own = new Set(e.parameters.flatMap((param) => boundNames(param.name)));
  const results: ts.Expression[] = [];
  if (!ts.isBlock(e.body)) results.push(e.body);
  else {
    const visit = (n: ts.Node): void => {
      if (ts.isFunctionLike(n)) return;
      if (ts.isReturnStatement(n) && n.expression) results.push(n.expression);
      ts.forEachChild(n, visit);
    };
    ts.forEachChild(e.body, visit);
  }
  return results.map(copiedName).filter((name): name is string => name !== undefined && !own.has(name));
}

/** `name`'s declaration, found from `from` by `localInitializer`, is a `.filter(`, a `.splice(`,
 *  a `[]`, or a plain alias of another such local. `seen` stops a cycle. */
function isRemovalLocal(from: ts.Node, name: string, seen: Set<string>): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  const init = localInitializer(from, name);
  if (!init) return false;
  if (contains(init, isFilterCall) || contains(init, isSpliceCall) || isEmptyArray(unwrap(init))) return true;
  const source = unwrap(init);
  return ts.isIdentifier(source) && isRemovalLocal(source, source.text, seen);
}

/** A COMMITTER: the setter is handed a parameter of the function it sits in
 *  (`function commitBuckets(next) { …; setBudgets(next); }`). Whatever list a
 *  caller computes — a `.filter(` in another file included — reaches the slice
 *  through here, so the committer is judged as a removal route itself. Its
 *  callers are not followed: the committer is the one place every one of them
 *  passes through. A parameter of the NEAREST function counts whether plain or
 *  destructured (`({ next }) =>`, `([next]) =>`), and so does a local of that
 *  function's own body that aliases one (`const list = next;`, `const { next } =
 *  args;`), through any chain of such aliases. ★ A parameter of an OUTER function
 *  is not seen, nor an alias declared in a nested function, nor a parameter that
 *  is transformed (`next.slice()`) rather than aliased.
 *  ★ It fails CLOSED on an inline callback's parameter: `onChange={(next) =>
 *  setTasks(next)}` counts as a committer, and since it resolves to its component
 *  it is refused with no exemption path. Give it a named handler. None today. */
function isParameterHandOff(arg: ts.Expression): boolean {
  const e = unwrap(arg);
  if (!ts.isIdentifier(e)) return false;
  let fn: ts.Node | undefined = arg.parent;
  while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
  return !!fn && derivesFromParameter(fn as ts.SignatureDeclaration, e.text, new Set());
}

/** The names a binding introduces: `next`, or each name in `{ next }` / `[a, { b }]`, at any depth. */
function boundNames(b: ts.BindingName): string[] {
  if (ts.isIdentifier(b)) return [b.text];
  return b.elements.flatMap((el) => (ts.isOmittedExpression(el) ? [] : boundNames(el.name)));
}

/** `name` is a parameter of `fn`, or a local of `fn`'s own body (nested functions not
 *  searched) whose initializer is, after `unwrap`, another such name. `seen` stops a cycle.
 *  ★ The first declaration of `name` in document order wins, so of two same-named locals
 *  in sibling blocks only the first is read. */
function derivesFromParameter(fn: ts.SignatureDeclaration, name: string, seen: Set<string>): boolean {
  if (seen.has(name)) return false;
  seen.add(name);
  if (fn.parameters.some((p) => boundNames(p.name).includes(name))) return true;
  let init: ts.Expression | undefined;
  const visit = (n: ts.Node): void => {
    if (init || (n !== fn && ts.isFunctionLike(n))) return;
    if (ts.isVariableDeclaration(n) && n.initializer && boundNames(n.name).includes(name)) { init = n.initializer; return; }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn, visit);
  if (!init) return false;
  const source = unwrap(init);
  return ts.isIdentifier(source) && derivesFromParameter(fn, source.text, seen);
}
/** `allowDestructiveSave()`, `x.allowDestructiveSave?.()`, or the ref a hook keeps it in,
 *  `allowDestructiveSaveRef.current?.()`. Never `allowDestructiveSaveAnyway`, the user's own
 *  save-anyway, which is not a route arming itself. */
function isArmCall(n: ts.Node): boolean {
  if (!ts.isCallExpression(n)) return false;
  if (calleeName(n) === ARM) return true;
  const e = n.expression;
  return ts.isPropertyAccessExpression(e) && e.name.text === "current" && /(^|\.)allowDestructiveSaveRef$/.test(e.expression.getText());
}

/** The name a function is known by: its declaration, the variable or property it
 *  is assigned to (through any call it is an argument of, such as `useCallback` or
 *  `guardEdit`), or the JSX prop it is passed as. Undefined for an unnamed inner
 *  callback, so the walk goes on up. ★ A local result can name it too
 *  (`const r = ids.map(() => setX(…filter…))` names the site `r`): that fails
 *  CLOSED, as an unarmed `r`, so read such a red as a naming miss, not a missing arm. */
function functionName(fn: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) return fn.name?.getText();
  // Climb through every call the function is an ARGUMENT of (`useCallback(fn, deps)`,
  // `guardEdit(fn)`, …) to the name the result is bound to.
  let node: ts.Node = fn;
  let p: ts.Node = fn.parent;
  while (ts.isCallExpression(p) && p.arguments.some((a) => a === node)) {
    node = p;
    p = p.parent;
  }
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (ts.isPropertyAssignment(p)) return p.name.getText();
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return p.parent.name.getText();
  return undefined;
}

/** A site named for a component (PascalCase), a hook (`useX`) or the module: judged by
 *  that whole scope, where any arm would pass it, so it is refused rather than judged.
 *  A refused site has no exemption path: give the delete a named handler instead. */
const isUnresolved = (s: Site): boolean => s.fn === "<module>" || /^([A-Z]|use[A-Z0-9])/.test(s.fn);

/** Every filter-into-counted-setter site in one source. Pure, so the fixture
 *  cases below can feed it text. */
function scanSource(file: string, text: string, setters: ReadonlySet<string>): Site[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: Site[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const setter = calleeName(n);
      if (setter && setters.has(setter) && n.arguments.some((a) => isRemovalArgument(a) || isParameterHandOff(a))) {
        let fn: ts.Node | undefined = n.parent;
        let name: string | undefined;
        for (; fn; fn = fn.parent) {
          if (ts.isFunctionLike(fn) && (name = functionName(fn))) break;
        }
        const fnName = name ?? "<module>";
        sites.push({
          key: `${file}#${fnName}#${setter}`,
          file,
          fn: fnName,
          setter,
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          armed: contains(fn ?? sf, isArmCall),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

function scanApp(): Site[] {
  const setters = countedSetters();
  const files = (readdirSync(APP, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort();
  return files.flatMap((f) =>
    scanSource(relative(APP, join(APP, f)).split(sep).join("/"), readFileSync(join(APP, f), "utf8"), setters),
  );
}

describe("scanSource (the scanner itself)", () => {
  const setters = new Set(["setTasks", "setRaid"]);
  const scan = (src: string) => scanSource("x.tsx", src, setters);

  it("finds a filter-delete in a useCallback and names it by its variable", () => {
    const [site] = scan(`const del = useCallback((id) => { setTasks((p) => p.filter((t) => t.id !== id)); }, []);`);
    expect(site).toMatchObject({ fn: "del", setter: "setTasks", armed: false });
  });

  it("counts an optional or member arming call anywhere in that function", () => {
    expect(scan(`function del(id) { setTasks((p) => p.filter(Boolean)); allowDestructiveSave?.(); }`)[0]!.armed).toBe(true);
    expect(scan(`const del = (id) => { deps.allowDestructiveSave(); ws.setTasks((p) => p.filter(Boolean)); };`)[0]!.armed).toBe(true);
    expect(scan(`const del = useCallback(() => { allowDestructiveSaveRef.current?.(); setTasks((p) => p.filter(Boolean)); }, []);`)[0]!.armed).toBe(true);
  });

  it("does not count the user's own save-anyway call as an arm", () => {
    expect(scan(`function del() { allowDestructiveSaveAnyway(); setTasks((p) => p.filter(Boolean)); }`)[0]!.armed).toBe(false);
  });

  it("walks past an unnamed inner callback to the named handler", () => {
    const [site] = scan(`const onClear = () => { confirmThen(() => { setRaid((p) => p.filter(Boolean)); }); allowDestructiveSave(); };`);
    expect(site).toMatchObject({ fn: "onClear", armed: true });
  });

  // ★★ Review finding: `onClearUnlinked: guardEdit(() => { … })` left the arrow
  //   unnamed, the walk climbed to the COMPONENT, and an arm anywhere in the
  //   component then "armed" this site — deleting its own arm stayed green.
  it("names a handler passed through a wrapper call, and judges only its own body", () => {
    const [site] = scan(
      `function Comp() { allowDestructiveSaveRef.current?.(); const h = { onClear: guardEdit(() => { setRaid((p) => p.filter(Boolean)); }) }; }`,
    );
    expect(site).toMatchObject({ fn: "onClear", armed: false });
  });

  it("refuses a site that only resolves to its component", () => {
    const [site] = scan(`function Comp() { useEffect(() => { setTasks((p) => p.filter(Boolean)); }); }`);
    expect(site!.fn).toBe("Comp");
    expect(isUnresolved(site!)).toBe(true);
  });

  // ★ Review finding: a hook body is a scope too. An unnamed effect in a hook that
  //   arms in ANOTHER handler would otherwise be judged armed.
  it("refuses a site that only resolves to its hook", () => {
    const [site] = scan(
      `export function useFoo() { const del = useCallback(() => { allowDestructiveSave(); }, []); useEffect(() => { setRaid((p) => p.filter(Boolean)); }, []); }`,
    );
    expect(site).toMatchObject({ fn: "useFoo", armed: true });
    expect(isUnresolved(site!)).toBe(true);
  });

  it("names an inline JSX handler by its prop", () => {
    const [site] = scan(`const el = <X onRemove={() => setTasks((p) => p.filter(Boolean))} />;`);
    expect(site!.fn).toBe("onRemove");
  });

  // §293, 2026-10-11: an alias is followed only through the committer's own body, and only as a plain copy.
  it("ignores a transformed parameter, an alias declared in a nested function, and an alias cycle", () => {
    expect(scan(`function commit(next) { const list = next.slice(); setTasks(list); }`)).toEqual([]);
    expect(scan(`function commit(next) { const h = () => { const list = next; }; setTasks(list); }`)).toEqual([]);
    expect(scan(`function f() { let a = b; let b = a; setTasks(a); }`)).toEqual([]);
  });

  // Review finding: the angle-bracket cast, which only a `.ts` file can hold.
  it("sees an alias through an angle-bracket cast in a .ts file", () => {
    const src = `function commit(next) { const l = <Task[]>next; setTasks(l); }`;
    expect(scanSource("x.ts", src, setters).map((x) => x.setter)).toEqual(["setTasks"]);
  });

  // Second review: an updater handing back its OWN parameter keeps the list, whatever an outer local of that name holds.
  it("ignores an updater that returns its own parameter", () => {
    expect(scan(`function C() { const prev = rows.filter(Boolean); const h = () => setTasks((prev) => prev); }`)).toEqual([]);
    expect(scan(`function a() { const p = rows.filter(Boolean); } function b() { setTasks((p) => { return p; }); }`)).toEqual([]);
    // A return inside a NESTED function is that function's result, not the updater's.
    expect(scan(`function e() { const kept = a.filter(Boolean); setTasks((p) => { const f = () => { return kept; }; return p; }); }`)).toEqual([]);
  });

  it("ignores an edit, an unlisted setter, and a filter outside the setter's value", () => {
    expect(scan(`function e() { setTasks((p) => p.map((t) => t)); setOther((p) => p.filter(Boolean)); const k = a.filter(Boolean); setTasks(p); }`)).toEqual([]);
    // A local initialised by anything else, `.map(` included, is no removal.
    expect(scan(`function e() { const next = rows.map((r) => r); setTasks(next); }`)).toEqual([]);
    expect(scan(`function e() { setTasks((p) => p.length ? p : []); }`)).toEqual([]);
    // §293, 2026-10-11: the same normalisation, negated or compared, is no removal either.
    expect(scan(`function e() { setTasks((p) => !p.length ? [] : p); }`)).toEqual([]);
    expect(scan(`function e() { setTasks((p) => (p.length > 0 ? p : [])); }`)).toEqual([]);
    expect(scan(`function e() { setTasks((p) => (p.length === 0 ? [] : p)); }`)).toEqual([]);
    expect(scan(`function e() { setTasks((p) => (!!p.length ? p : [])); }`)).toEqual([]);
  });

  // §293, widened 2026-10-08: the other written shapes of a removal.
  it.each([
    ["a clear to []", `function clear() { setTasks([]); }`],
    ["a clear through a cast", `function clear() { setTasks([] as Task[]); }`],
    ["an updater returning []", `function clear() { setTasks(() => []); }`],
    ["an updater block returning []", `function clear() { setTasks((p) => { log(p); return []; }); }`],
    ["a splice", `function del(i) { setTasks((p) => { const c = [...p]; c.splice(i, 1); return c; }); }`],
    ["a local filtered list", `function del(id) { const kept = tasks.filter((t) => t.id !== id); setTasks(kept); }`],
    ["a local spliced list", `function del(i) { const gone = rows.splice(i, 1); setTasks(gone); }`],
    ["a committer handed its own parameter", `function commit(next) { setTasks(next); }`],
    ["a committer's parameter through a cast", `const commit = (next) => { setTasks(next as Task[]); };`],
    // §293, widened 2026-10-11: a conditional clear, and a local declared one function out.
    ["a conditional clear", `function reset() { setTasks(wipe ? [] : tasks); }`],
    ["a conditional clear in an updater", `function reset() { setTasks((p) => (wipe ? [] : p)); }`],
    ["a conditional clear returned from a block", `function reset() { setTasks((p) => { return wipe ? p : []; }); }`],
    ["a nested conditional clear", `function reset() { setTasks((p) => (a ? p : b ? [] : p)); }`],
    ["a length test of ANOTHER list", `function reset() { setTasks((p) => (other.length ? p : [])); }`],
    // Review finding: an emptiness test pointing the OTHER way empties a non-empty list.
    ["a clear-if-non-empty", `function reset() { setTasks((p) => (p.length ? [] : p)); }`],
    ["a negated test the wrong way", `function reset() { setTasks((p) => (!p.length ? p : [])); }`],
    ["the clear-if-non-empty idiom of use-version-history.ts", `function reset() { setTasks((p) => (p.length === 0 ? p : [])); }`],
    ["a length compared with another number", `function reset() { setTasks((p) => (p.length > 5 ? p : [])); }`],
    ["a length test inside a &&", `function reset() { setTasks((p) => (p.length && keep ? p : [])); }`],
    ["a length compared with another list", `function reset() { setTasks((p) => (p.length > other.length ? p : [])); }`],
    ["a local filtered list one function out", `function Comp() { const kept = tasks.filter(Boolean); const save = () => { setTasks(kept); }; }`],
    // §293, widened 2026-10-11: a rebuild accumulator, which counts whether or not its loop skips a row.
    ["a rebuild accumulator", `function e() { const next = []; for (const r of rows) next.push(r); setTasks(next); }`],
    ["a typed rebuild accumulator that skips a row", `function e() { const next = [] as Task[]; for (const r of rows) { if (r.gone) continue; next.push(r); } setTasks(next); }`],
    // Review finding: an alias, a copy or an updater of a filtered or accumulator local hands on the same list.
    ["an alias of a filtered local", `function C() { const kept = a.filter(Boolean); function commit() { const l = kept; setTasks(l); } }`],
    ["an alias of an accumulator", `function e() { const next = []; const out = next; setTasks(out); }`],
    ["a spread copy of an accumulator", `function e() { const next = []; setTasks([...next]); }`],
    ["an updater returning an accumulator", `function e() { const next = []; setTasks(() => next); }`],
    // Second review: a block-bodied or `function` updater returns the local too.
    ["a block updater returning an accumulator", `function e() { const next = []; setTasks(() => { return next; }); }`],
    ["a function updater returning a filtered local", `function e() { const kept = a.filter(Boolean); setTasks(function () { return kept; }); }`],
    // §293, widened 2026-10-11: a committer's parameter destructured, or aliased first.
    ["a committer's destructured parameter", `const commit = ({ next }) => { setTasks(next); };`],
    ["a committer's array-destructured parameter", `function commit([first, { next }]) { setTasks(next); }`],
    ["a local alias of a committer's parameter", `function commit(next) { const list = next; setTasks(list); }`],
    ["a chain of aliases through a cast", `function commit(next) { const a = next; const b = a as Task[]; setTasks(b); }`],
    ["a destructured local of a committer's parameter", `function commit(args) { const { next } = args; setTasks(next); }`],
  ])("finds %s", (_label, src) => {
    expect(scan(src).map((x) => x.setter)).toEqual(["setTasks"]);
  });

  it("judges a committer by its own body, and ignores a parameter of an OUTER function", () => {
    expect(scan(`function commit(next) { if (gone) allowDestructiveSave?.(); setTasks(next); }`)[0]).toMatchObject({ fn: "commit", armed: true });
    expect(scan(`function outer(next) { const h = () => { setTasks(next); }; }`)).toEqual([]);
    expect(scan(`function outer(next) { const h = () => { const l = next; setTasks(l); }; }`)).toEqual([]);
  });
});

describe("destructive-save arming, UI surface (§293)", () => {
  const sites = scanApp();

  // ANTI-VACUITY: a broken walk or an empty setter set would pass every check below.
  it("scans the counted setters and finds the known removal sites", () => {
    expect(countedSetters().size).toBeGreaterThanOrEqual(13);
    expect(sites.length).toBeGreaterThanOrEqual(15);
    expect(sites.map((s) => s.key)).toContain("use-raid-items.ts#handleDeleteRaidItem#setRaid");
    // A clear to `[]`, seen since the 2026-10-08 widening, not by any `.filter(`.
    expect(sites.find((s) => s.key === "use-bulk-operations.ts#handleClearAll#setTasks")?.armed).toBe(true);
    // The unbounded clear-unlinked route, moved out of task-manager.tsx (§491 step 16); its two
    // filters (absences, shifts) both arm. The wrapper-call naming it used to pin is the scanner case above.
    expect(sites.filter((s) => s.key.startsWith("workload-triage-handlers.ts#onClearUnlinked#")).map((s) => s.armed)).toEqual([true, true]);
    // A committer, seen since batch 21: any caller's list reaches setBudgets through it.
    expect(sites.find((s) => s.key === "use-budget-buckets.ts#commitBuckets#setBudgets")?.armed).toBe(true);
  });

  // A site that resolves to a component (PascalCase), a hook (`useX`) or the module is
  // judged by that whole scope, where any arm passes it: refuse it rather than pass it.
  it("every site resolves to a named handler, not a component, a hook or the module", () => {
    const unresolved = sites.filter(isUnresolved).map((s) => `${s.file}:${s.line} ${s.fn}`);
    expect(unresolved).toEqual([]);
  });

  it("every filter-delete on a counted slice arms, or says why not", () => {
    const missing = sites
      .filter((s) => !s.armed && !(s.key in UNARMED_BY_DESIGN))
      .map((s) => `${s.file}:${s.line} ${s.fn} → ${s.setter}`);
    expect(missing, "arm with allowDestructiveSave, or add a reasoned UNARMED_BY_DESIGN entry").toEqual([]);
  });

  it("every UNARMED_BY_DESIGN entry names a live, unarmed site", () => {
    const unarmed = new Set(sites.filter((s) => !s.armed).map((s) => s.key));
    expect(Object.keys(UNARMED_BY_DESIGN).filter((k) => !unarmed.has(k))).toEqual([]);
  });

  // An exemption is keyed by file#function#setter, so a SECOND filter-delete added to an
  // exempt function would share the key; the count makes it a deliberate edit.
  it("every UNARMED_BY_DESIGN entry covers exactly the sites it counts", () => {
    const off = Object.entries(UNARMED_BY_DESIGN)
      .map(([key, entry]) => ({ key, counted: entry.sites, found: sites.filter((s) => !s.armed && s.key === key).length }))
      .filter((e) => e.counted !== e.found);
    expect(off).toEqual([]);
  });
});
