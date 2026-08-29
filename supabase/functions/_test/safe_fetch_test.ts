import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertPublicHttpUrl,
  BlockedUrlError,
  isInternalHostname,
  isPublicHttpUrl,
  safeFetch,
} from "../_shared/safeFetch.ts";

/**
 * The SSRF guard in front of `download-media`.
 *
 * `download-media` fetches a URL the caller chose and hands the bytes back
 * base64-encoded, so a hole here is an exfiltration primitive rather than a
 * blind probe. Two properties are worth pinning: the address rules, and that
 * they are re-applied on every redirect hop — a public URL that 302s to
 * link-local defeats a first-hop-only check on its own.
 */

Deno.test("isInternalHostname refuses loopback, private and link-local addresses", () => {
  for (
    const host of [
      "127.0.0.1",
      "127.13.2.9",
      "10.0.0.7",
      "172.16.5.5",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud instance metadata — the one that matters most
      "0.0.0.0",
      "100.64.0.1",
      "localhost",
      "foo.local",
      "svc.internal",
      "metadata.google.internal",
      "::1",
      "[::1]",
      "fe80::1",
      "fd00::1",
      "::ffff:127.0.0.1",
      "2130706433", // decimal spelling of 127.0.0.1
      "0x7f000001",
    ]
  ) {
    assert(isInternalHostname(host), `${host} should be treated as internal`);
  }
});

Deno.test("isInternalHostname allows ordinary public hosts", () => {
  for (const host of ["hakiya.app", "www.youtube.com", "cdn.test", "8.8.8.8", "172.32.0.1", "192.169.0.1"]) {
    assertEquals(isInternalHostname(host), false, `${host} should be allowed`);
  }
});

Deno.test("assertPublicHttpUrl rejects non-http schemes", () => {
  for (const url of ["file:///etc/passwd", "gopher://example.com", "data:text/plain,hi"]) {
    assertEquals(isPublicHttpUrl(url), false, url);
  }
});

Deno.test("assertPublicHttpUrl accepts a public https URL and returns it parsed", () => {
  const parsed = assertPublicHttpUrl("https://cdn.test/clip.mp3?x=1");
  assertEquals(parsed.hostname, "cdn.test");
  assertEquals(parsed.pathname, "/clip.mp3");
});

Deno.test("assertPublicHttpUrl throws BlockedUrlError for metadata addresses", () => {
  let thrown: unknown;
  try {
    assertPublicHttpUrl("http://169.254.169.254/latest/meta-data/");
  } catch (e) {
    thrown = e;
  }
  assert(thrown instanceof BlockedUrlError);
});

/** Swap global fetch for the duration of one test. */
async function withFetch(
  handler: (url: string) => Response,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url));
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("safeFetch follows a public redirect and reports the final URL", async () => {
  await withFetch(
    (url) =>
      url === "https://cdn.test/a"
        ? new Response(null, { status: 302, headers: { location: "https://cdn.test/b" } })
        : new Response("bytes", { status: 200 }),
    async () => {
      const { response, finalUrl } = await safeFetch("https://cdn.test/a");
      assertEquals(response.status, 200);
      assertEquals(finalUrl, "https://cdn.test/b");
    },
  );
});

Deno.test("safeFetch refuses a redirect into link-local space", async () => {
  await withFetch(
    () =>
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    async () => {
      await assertRejects(
        () => safeFetch("https://cdn.test/a"),
        BlockedUrlError,
      );
    },
  );
});

Deno.test("safeFetch gives up rather than looping forever", async () => {
  await withFetch(
    () => new Response(null, { status: 302, headers: { location: "https://cdn.test/next" } }),
    async () => {
      await assertRejects(() => safeFetch("https://cdn.test/a", {}, 2), BlockedUrlError, "Too many redirects");
    },
  );
});
