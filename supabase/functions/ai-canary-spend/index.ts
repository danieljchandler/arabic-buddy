// ai-canary-spend — the spend half of the daily AI canary.
//
// The canary (scripts/ai-canary.ts, run by .github/workflows/ai-canary.yml)
// signs in as an ordinary subscriber, which is the point: it should see the
// app the way a learner does. But the two numbers it judges spend on are not
// a learner's to read. `llm_usage_logs` is admin-read-only under RLS, and the
// OpenRouter key lives only in this project's secrets. Copying either the
// service-role key or the OpenRouter key into GitHub to read them from there
// would put a full-access key, or a spend-capable one, in a second place for
// the sake of two totals.
//
// So they are read here, server-side, and only totals leave:
//   - `llm_usage_logs.cost_usd` summed over the last 24 hours and over the
//     seven days before that, so the canary can tell a spike from a busy week;
//   - OpenRouter's key-info endpoint (GET /api/v1/key) for the key's limit and
//     what remains of it. A key with no limit reports `limit: null`, which the
//     canary treats as a failure in its own right.
//
// Read-only. Gated on the AI_CANARY_SECRET header (the scheduled caller, which
// holds no admin session) or an admin session, the same two-door pattern as
// `harvest-social-trends`. No row, no prompt and no user id is returned.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getCorsHeaders } from "../_shared/cors.ts";
import { hasSharedSecret, requireAdmin } from "../_shared/requireRole.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DAY_MS = 24 * 60 * 60 * 1000;
const PAGE = 1000;
/** 200 pages is 200k costed rows in eight days; far past anything real. */
const MAX_PAGES = 200;
const OPENROUTER_TIMEOUT_MS = 10_000;

function json(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

interface CostRow {
  cost_usd: number | string | null;
  created_at: string;
}

interface LlmTotals {
  last_24h_usd: number;
  previous_7d_usd: number;
  costed_rows_24h: number;
  uncosted_rows_24h: number | null;
  truncated: boolean;
}

async function readLlmTotals(now: number): Promise<LlmTotals> {
  const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const since24h = new Date(now - DAY_MS).toISOString();
  const since8d = new Date(now - 8 * DAY_MS).toISOString();

  let last24 = 0;
  let previous7 = 0;
  let rows24 = 0;
  let truncated = false;

  // Paged rather than summed in SQL: PostgREST aggregates are off by default on
  // Supabase, and an RPC would be a migration that only Lovable can apply. Only
  // the two columns needed, and only costed rows.
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      truncated = true;
      break;
    }
    const { data, error } = await db
      .from("llm_usage_logs")
      .select("cost_usd, created_at")
      .gte("created_at", since8d)
      .not("cost_usd", "is", null)
      .order("created_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(`llm_usage_logs read failed: ${error.message}`);
    const rows = (data ?? []) as CostRow[];
    for (const row of rows) {
      const cost = Number(row.cost_usd);
      if (!Number.isFinite(cost)) continue;
      // Parsed, not compared as strings: Postgres answers `+00:00` with six
      // fractional digits, toISOString() writes `Z` with three.
      if (Date.parse(row.created_at) >= now - DAY_MS) {
        last24 += cost;
        rows24++;
      } else {
        previous7 += cost;
      }
    }
    if (rows.length < PAGE) break;
  }

  // How much of the last day the total cannot see. Non-LLM legs and providers
  // that report no spend log a null cost, so a low total with many uncosted
  // rows is a blind spot, not a quiet day.
  let uncosted: number | null = null;
  const { count, error: countError } = await db
    .from("llm_usage_logs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since24h)
    .is("cost_usd", null);
  if (!countError) uncosted = count ?? 0;

  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return {
    last_24h_usd: round(last24),
    previous_7d_usd: round(previous7),
    costed_rows_24h: rows24,
    uncosted_rows_24h: uncosted,
    truncated,
  };
}

interface OpenRouterKeyInfo {
  configured: boolean;
  ok: boolean;
  status?: number;
  limit?: number | null;
  limit_remaining?: number | null;
  usage_daily?: number | null;
}

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

async function readOpenRouterKey(): Promise<OpenRouterKeyInfo> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return { configured: false, ok: false };
  try {
    const res = await fetch("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel();
      return { configured: true, ok: false, status: res.status };
    }
    const body = (await res.json()) as { data?: Record<string, unknown> };
    const data = body?.data ?? {};
    // Only the numbers. The key's label is a name someone chose and stays here.
    return {
      configured: true,
      ok: true,
      limit: numOrNull(data.limit),
      limit_remaining: numOrNull(data.limit_remaining),
      usage_daily: numOrNull(data.usage_daily),
    };
  } catch (e) {
    console.error("[ai-canary-spend] openrouter key read failed", e instanceof Error ? e.message : e);
    return { configured: true, ok: false };
  }
}

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // The scheduled canary carries the shared secret; a person needs to be admin.
  if (!(await hasSharedSecret(req, "x-canary-secret", "AI_CANARY_SECRET"))) {
    const gate = await requireAdmin(req, cors, { allowServiceRole: false });
    if (gate.denied) return gate.response;
  }

  const now = Date.now();
  try {
    const [llm, openrouter] = await Promise.all([readLlmTotals(now), readOpenRouterKey()]);
    return json({ generated_at: new Date(now).toISOString(), llm, openrouter }, 200, cors);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[ai-canary-spend]", message);
    return json({ error: "spend_read_failed", message: message.slice(0, 300) }, 500, cors);
  }
});
