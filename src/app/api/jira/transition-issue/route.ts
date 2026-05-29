import {
  callJira,
  forwardJsonResponse,
  parseJiraRequest,
} from "../_helpers";

export const runtime = "nodejs";

type Transition = {
  id: string;
  name: string;
  to?: { statusCategory?: { key?: string } };
};

// Transition an issue toward a given target category ("done", "indeterminate",
// or "new"). Each Jira project has bespoke workflow transitions, so we GET the
// available ones and pick the first that lands in the requested category.
export async function POST(request: Request) {
  const parsed = await parseJiraRequest(request);
  if ("error" in parsed) return parsed.error;
  const { creds } = parsed;
  const b = parsed.body;
  const key = typeof b.key === "string" ? b.key.trim() : "";
  if (!key || !/^[A-Z][A-Z0-9_]+-\d+$/i.test(key)) {
    return Response.json({ error: "missing-or-bad-key" }, { status: 400 });
  }
  const targetCategory =
    typeof b.targetCategory === "string" ? b.targetCategory : "";
  if (
    targetCategory !== "done" &&
    targetCategory !== "indeterminate" &&
    targetCategory !== "new"
  ) {
    return Response.json(
      { error: "invalid-target-category" },
      { status: 400 },
    );
  }

  // 1. List transitions
  const transRes = await callJira(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
  );
  if (!transRes.ok) return forwardJsonResponse(transRes);
  const transData = (await transRes.json().catch(() => null)) as {
    transitions?: Transition[];
  } | null;
  const transitions = transData?.transitions ?? [];
  const match = transitions.find(
    (tr) => tr.to?.statusCategory?.key === targetCategory,
  );
  if (!match) {
    return Response.json(
      {
        error: "no-matching-transition",
        available: transitions.map((tr) => ({
          id: tr.id,
          name: tr.name,
          category: tr.to?.statusCategory?.key ?? null,
        })),
      },
      { status: 409 },
    );
  }

  // 2. Apply the transition
  const applyRes = await callJira(
    creds,
    `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
    {
      method: "POST",
      body: JSON.stringify({ transition: { id: match.id } }),
    },
  );
  if (applyRes.status === 204) {
    return Response.json({ ok: true, transitionId: match.id, name: match.name });
  }
  return forwardJsonResponse(applyRes);
}
