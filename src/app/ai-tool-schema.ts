// src/app/ai-tool-schema.ts — the JSON-schema checks the forced-call envelope (ai-forced-call.ts) uses
// when a model is asked with tool_choice auto: does a reply's tool input match the tool's schema, and the
// tool in strict form for the retry. PURE: no I/O, no i18n.

type Schema = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `value` against the subset of JSON Schema the app's tools use: `type` (object, array, string, number,
 *  integer, boolean), `properties` + `required`, `items` and `enum`. Keys the schema does not list are
 *  allowed, and a keyword outside that subset is not checked. */
export function matchesSchema(value: unknown, schema: unknown): boolean {
  if (!isPlainObject(schema)) return true;
  const s: Schema = schema;
  if (Array.isArray(s.enum) && !s.enum.includes(value)) return false;
  switch (s.type) {
    case "object": {
      if (!isPlainObject(value)) return false;
      const required = Array.isArray(s.required) ? s.required : [];
      if (required.some((k) => typeof k === "string" && !Object.hasOwn(value, k))) return false;
      const props = isPlainObject(s.properties) ? s.properties : {};
      return Object.entries(props).every(([k, sub]) => !Object.hasOwn(value, k) || matchesSchema(value[k], sub));
    }
    case "array":
      return Array.isArray(value) && (s.items === undefined || value.every((v) => matchesSchema(v, s.items)));
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    default:
      return true;
  }
}

/** `schema` with `additionalProperties: false` on every object, which strict mode requires. */
function closeObjects(schema: unknown): unknown {
  if (!isPlainObject(schema)) return schema;
  const node: Schema = { ...schema };
  if (node.type === "object") {
    node.additionalProperties = false;
    const props = isPlainObject(node.properties) ? node.properties : {};
    node.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, closeObjects(v)]));
  }
  if (node.items !== undefined) node.items = closeObjects(node.items);
  return node;
}

/** `tools` with the one named `toolName` in strict form (`strict: true`, every object closed); the
 *  others as they are. */
export function withStrictTool(tools: unknown[], toolName: string): unknown[] {
  return tools.map((t) => {
    if (!isPlainObject(t) || t.name !== toolName) return t;
    return { ...t, strict: true, input_schema: closeObjects(t.input_schema) };
  });
}
