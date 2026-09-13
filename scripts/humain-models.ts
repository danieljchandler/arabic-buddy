#!/usr/bin/env -S deno run --allow-env --allow-net
/**
 * What HUMAIN Node will actually serve this key.
 *
 * Node's catalogue is **per key**, not per product: model availability is
 * assigned to a user across four tiers (Global, HUMAIN Global, HUMAIN
 * In-Kingdom, Early Access/Preview), so the id M3 is published under is a fact
 * about your key rather than something the documentation can state. Node's own
 * instruction is to call `GET /v1/models` before selecting a model, and this is
 * that call.
 *
 * It exists because `MODEL_IDS.HUMAIN_M3` in `_shared/modelRegistry.ts` carries
 * the only unverified value in the M3 integration. Run this, read the `id`
 * column, and make the registry match. A mismatch is not subtle — Node answers
 * 404 `model_not_found` — but it is invisible until something calls the model,
 * and the validator leg M3 sits on is designed to swallow exactly that.
 *
 * Usage:
 *   HUMAIN_NODE_API_KEY=... deno run --allow-env --allow-net scripts/humain-models.ts
 *   HUMAIN_NODE_API_KEY=... deno run --allow-env --allow-net scripts/humain-models.ts --json
 *
 * The key is read from the environment and never printed, logged or written
 * anywhere by this script. Put it in your shell's secret store, not in a file
 * in this repo.
 */

const BASE = Deno.env.get('HUMAIN_BASE_URL')?.trim() || 'https://api.node.humain.com/v1';

interface NodeCapabilities {
  api_interface?: string;
  supported_formats?: string[];
  messages_adapter?: string;
  max_context_tokens?: number;
  max_output_tokens?: number;
  supports_streaming?: boolean;
  supports_function_calling?: boolean;
  supports_images?: boolean;
}

interface NodeModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  node?: NodeCapabilities;
}

function fail(message: string): never {
  console.error(message);
  Deno.exit(1);
}

const key = Deno.env.get('HUMAIN_NODE_API_KEY')?.trim();
if (!key) {
  fail(
    'HUMAIN_NODE_API_KEY is not set.\n' +
      'Create a key on the Users page for your Team in HUMAIN Node, then export it\n' +
      'in your shell. Do not commit it or paste it into a chat.',
  );
}

const response = await fetch(`${BASE.replace(/\/+$/, '')}/models`, {
  headers: { Authorization: `Bearer ${key}` },
});

// Every failure mode here is one Node documents, and each has a different
// remedy, so they are worth telling apart rather than dumping a status code.
// The request id is what support needs and is the one header worth echoing.
if (!response.ok) {
  const requestId = response.headers.get('x-request-id') ?? 'none';
  const detail = await response.text().catch(() => '');
  const hint = response.status === 401
    ? 'The key is absent, revoked, inactive or wrong — replace it.'
    : response.status === 429
    ? `A user or Team limit was reached. Retry-After: ${response.headers.get('retry-after') ?? 'not sent'}.`
    : response.status >= 500
    ? 'Node or a provider behind it is temporarily unavailable; retry with backoff.'
    : 'See the error code above against Node’s documented error list.';
  fail(`GET /models failed: ${response.status}\n${detail}\n${hint}\nX-Request-ID: ${requestId}`);
}

const body = await response.json() as { data?: NodeModel[] };
const models = body.data ?? [];

if (Deno.args.includes('--json')) {
  console.log(JSON.stringify(models, null, 2));
  Deno.exit(0);
}

if (models.length === 0) {
  fail(
    'This key can see no models at all.\n' +
      'Model availability is assigned per user in Node; the user behind this key\n' +
      'may have no tier selected, or none that carries the model you want.',
  );
}

console.log(`${models.length} model(s) available to this key at ${BASE}\n`);
for (const model of models.sort((a, b) => a.id.localeCompare(b.id))) {
  const node = model.node ?? {};
  const caps = [
    node.supports_streaming ? 'stream' : null,
    node.supports_function_calling ? 'tools' : null,
    node.supports_images ? 'images' : null,
  ].filter(Boolean).join(', ');
  console.log(`  ${model.id}`);
  console.log(
    `      owner=${model.owned_by ?? '?'}  interface=${node.api_interface ?? '?'}` +
      `  ctx=${node.max_context_tokens ?? '?'}  out=${node.max_output_tokens ?? '?'}` +
      (caps ? `  [${caps}]` : ''),
  );
}

// The whole point of the script: the registry has to name an id from this list.
const arabic = models.filter((m) => /m3|humain/i.test(m.id));
console.log(
  arabic.length
    ? `\nLikely M3 id(s): ${arabic.map((m) => m.id).join(', ')}\n` +
      'Set MODEL_IDS.HUMAIN_M3 in supabase/functions/_shared/modelRegistry.ts to\n' +
      '"humain/<id>" — the humain/ prefix is the registry\'s vendor form and is\n' +
      'stripped before the request leaves.'
    : '\nNothing here looks like M3. Tool-calling matters for this integration —\n' +
      'the dialect validator asks for a structured judgment — so check the\n' +
      '[tools] marker on whichever id you pick.',
);
