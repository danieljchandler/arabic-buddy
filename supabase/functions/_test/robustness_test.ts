import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fixtureJwt, loadFunction } from "./harness.ts";

/**
 * What every function does with a request it did not expect.
 *
 * These are public endpoints, so a malformed body is not hypothetical — it is
 * the first thing anyone poking at them will send. What matters is that the
 * function answers rather than throwing, because an unhandled throw in a Deno
 * edge function returns a bare 500 with no CORS headers, which the browser then
 * reports as a network error. The caller cannot tell that apart from being
 * offline, so a validation bug presents to the learner as "the app is broken".
 *
 * Deliberately shallow and applied to all 84, rather than deep on a few: the
 * value is in knowing no function in the set falls over.
 */

const FUNCTION_ORIGIN = "https://e2e.supabase.co/functions/v1";
const ORIGIN = "https://hakiya.app";

async function functionNames(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(new URL("../", import.meta.url))) {
    if (entry.isDirectory && !entry.name.startsWith("_")) names.push(entry.name);
  }
  return names.sort();
}

const names = await functionNames();

/** A POST carrying a body the function will not understand. */
function malformedRequest(name: string, body: string): Request {
  return new Request(`${FUNCTION_ORIGIN}/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      authorization: `Bearer ${fixtureJwt()}`,
    },
    body,
  });
}

/**
 * Send every function a bad request and report the ones that throw.
 *
 * Any HTTP status is acceptable — 400 is ideal, 500 is survivable. Throwing is
 * not, because the platform's own error response carries no CORS headers.
 */
async function sweep(describe: string, buildBody: () => string): Promise<void> {
  const failures: string[] = [];

  for (const name of names) {
    const fn = await loadFunction(name, {
      // Some functions reach an upstream before validating; answer everything
      // so a throw here is the function's own, not a missing route.
      upstreams: {
        "https://": () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    });

    try {
      const response = await fn.handler(malformedRequest(name, buildBody()));
      if (!(response instanceof Response)) {
        failures.push(`${name}: returned ${typeof response} instead of a Response`);
      }
    } catch (error) {
      failures.push(`${name}: threw ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      fn.restore();
    }
  }

  assertEquals(
    failures,
    [],
    `Functions that threw on ${describe}. An unhandled throw returns a bare 500 ` +
      `with no CORS headers, which the browser reports as a network error:\n` +
      failures.join("\n"),
  );
}

Deno.test("no function throws on a body that is not JSON", async () => {
  await sweep("a non-JSON body", () => "<html>not json</html>");
});

Deno.test("no function throws on an empty body", async () => {
  await sweep("an empty body", () => "");
});

Deno.test("no function throws on valid JSON with none of the expected fields", async () => {
  await sweep("JSON with no expected fields", () => JSON.stringify({ unexpected: true }));
});

Deno.test("no function throws on nulls where it expects strings", async () => {
  await sweep("null-valued fields", () =>
    JSON.stringify({
      text: null,
      dialect: null,
      category: null,
      word: null,
      prompt: null,
      url: null,
      id: null,
    }),
  );
});

Deno.test("a missing required array gets a 400 naming the problem, not a TypeError", async () => {
  // Found by the sweep above, pinned as warts for months: listening-quiz
  // dereferenced `words.slice` and culture-guide `messages.filter` straight
  // off req.json(), so the caller saw a 500 with "Cannot read properties of
  // undefined". Both guard now — the message is for a human and the status
  // is the client's, not the server's.
  for (const name of ["listening-quiz", "culture-guide"]) {
    const fn = await loadFunction(name);
    try {
      const response = await fn.handler(malformedRequest(name, JSON.stringify({ dialect: "Gulf" })));
      const text = await response.text();
      assertEquals(response.status, 400, name);
      assertEquals(/Cannot read propert/i.test(text), false, name);
    } finally {
      fn.restore();
    }
  }
});

Deno.test("no function throws on an oversized field", async () => {
  // A megabyte of text through a prompt-building path is a realistic way to
  // find an unguarded slice or a regex that backtracks.
  await sweep("a very large field", () =>
    JSON.stringify({ text: "ا".repeat(200_000), dialect: "Gulf" }),
  );
});
