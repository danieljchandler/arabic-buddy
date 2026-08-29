/**
 * Outbound fetch for URLs a caller chose.
 *
 * `download-media` takes a URL from the request body and fetches it. That is
 * the feature — a learner pastes a link to a clip — so the URL cannot simply be
 * allow-listed to a fixed host. What it must not become is a way to reach
 * things only the edge runtime can reach, and to read the answer: the caller
 * gets the response body back base64-encoded, so an SSRF here is an exfiltration
 * primitive, not just a blind probe.
 *
 * Two rules, and both are needed:
 *
 *   1. The destination must not be a private, loopback, link-local or
 *      otherwise internal address. Link-local (169.254.0.0/16) is the one that
 *      matters most — that is where cloud instance metadata lives.
 *   2. Every redirect hop is checked again. A public URL that 302s to
 *      `http://169.254.169.254/` defeats rule 1 on its own, so redirects are
 *      followed by hand rather than by the runtime.
 *
 * What this does not stop: a hostname that resolves to a private address
 * (DNS rebinding). Catching that means resolving the name ourselves and
 * pinning the connection to the resolved address, which the edge runtime's
 * `fetch` gives no way to do. The guard is a real barrier to the URL-shaped
 * attack and an honest partial answer to the DNS-shaped one; it is written down
 * here rather than left for someone to rediscover.
 */

/** Hostnames that never name something on the public internet. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

/** Suffixes reserved for internal naming. */
const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true;                        // 0.0.0.0/8 "this network"
  if (a === 10) return true;                       // private
  if (a === 127) return true;                      // loopback
  if (a === 169 && b === 254) return true;         // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true;         // private
  if (a === 192 && b === 0) return true;           // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true;                       // multicast + reserved + broadcast
  return false;
}

function isPrivateIPv6(host: string): boolean {
  // URL hostnames keep IPv6 in brackets; normalise and lower-case first.
  const h = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (h === "::" || h === "::1") return true;       // unspecified / loopback
  if (h.startsWith("fe80")) return true;            // link-local
  if (/^f[cd]/.test(h)) return true;                // unique local (fc00::/7)
  if (h.startsWith("ff")) return true;              // multicast
  // IPv4-mapped (::ffff:127.0.0.1) inherits the IPv4 verdict.
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    const octets = parseIPv4(mapped[1]);
    return octets ? isPrivateIPv4(octets) : true;
  }
  return false;
}

/** Would fetching this hostname reach something internal? */
export function isInternalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (host.includes(":") || host.startsWith("[")) return isPrivateIPv6(host);
  const octets = parseIPv4(host);
  if (octets) return isPrivateIPv4(octets);
  // Decimal / octal / hex integer forms of an IPv4 address ("2130706433" is
  // 127.0.0.1). Any all-digit or 0x-prefixed host is refused rather than
  // decoded — nothing legitimate is spelled that way.
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  return false;
}

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

/**
 * Parse and vet a caller-supplied URL. Throws `BlockedUrlError` when the URL is
 * malformed, not http(s), or names something internal.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BlockedUrlError("Invalid URL format");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BlockedUrlError("Only HTTP/HTTPS URLs are supported");
  }
  if (isInternalHostname(parsed.hostname)) {
    throw new BlockedUrlError("That address is not reachable from here");
  }
  return parsed;
}

/** True when the URL is public and http(s) — the non-throwing form. */
export function isPublicHttpUrl(raw: string): boolean {
  try {
    assertPublicHttpUrl(raw);
    return true;
  } catch {
    return false;
  }
}

export interface SafeFetchResult {
  response: Response;
  /** The URL the response actually came from, after redirects. */
  finalUrl: string;
}

/**
 * `fetch` with every hop vetted.
 *
 * Redirects are followed manually — `redirect: "follow"` would hand the
 * runtime a chance to land somewhere rule 1 rejected.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<SafeFetchResult> {
  let current = assertPublicHttpUrl(raw);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const response = await fetch(current.toString(), { ...init, redirect: "manual" });

    const isRedirect = response.status >= 300 && response.status < 400;
    const location = response.headers.get("location");
    if (!isRedirect || !location) {
      return { response, finalUrl: current.toString() };
    }

    // Drain the redirect body so the connection can be reused.
    await response.body?.cancel().catch(() => {});

    const next = new URL(location, current);
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new BlockedUrlError("Redirected to an unsupported protocol");
    }
    if (isInternalHostname(next.hostname)) {
      throw new BlockedUrlError("Redirected to an address that is not reachable from here");
    }
    current = next;
  }

  throw new BlockedUrlError("Too many redirects");
}
