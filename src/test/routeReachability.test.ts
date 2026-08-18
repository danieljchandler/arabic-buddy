import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES } from "./support/routes/manifest";

/**
 * Every learner route has a way in that does not involve typing a URL.
 *
 * This exists because of a bug the hub removal makes possible and nothing
 * else can catch. When Ingleezy replaced its three hub screens with the dock,
 * it deleted the only links to six working features — the daily dashboard,
 * the conversation simulator, grammar drills, the daily challenge, mistakes
 * and native feedback. All six kept their routes, their pages, their hooks
 * and their tests, and every one of those tests kept passing, because a test
 * navigates by URL and never asks how a person would have got there.
 *
 * So the failure mode is a feature that still works perfectly and that nobody
 * can reach. It costs nothing to run and is invisible in review, which is
 * exactly the profile of a check worth automating. Hakiya runs it from the
 * same commit that removes the hubs, not after.
 *
 * The allow-list below is the interesting part: a route on it is a claim that
 * this route is *meant* to be reached some other way, and the reason has to be
 * written down.
 */

/** Routes deliberately without an in-app link, and why. */
const NO_LINK_NEEDED: Record<string, string> = {
  "/": "the front door — nothing links to it because everything starts there",
  "/index": "a redirect kept for old bookmarks",
  "/learn-hub": "a redirect kept for old bookmarks",
  "/practice": "a redirect kept for old bookmarks",
  "/auth": "reached by the guard on every protected route, not by a link",
  "/onboarding": "entered once, straight after sign-up",
  "/reset-password": "arrived at from a link in an email",
  "/quiz/:lessonId": "opened from inside a lesson, which builds the path from data",
  "/today/story": "opened from the daily dashboard, which builds the path from data",
  "/share": "the target of the native share sheet, not of any in-app link",
  "/share-target": "the PWA share_target endpoint — the OS links here, the app does not",
};

// Resolved from the working directory rather than import.meta.url: under the
// jsdom environment this file is served to the test as an http URL, so
// fileURLToPath on it throws. Vitest always runs from the repo root.
const SRC = resolve(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Which route each page file implements, read off App.tsx.
 *
 * Needed because "something links to it" is too weak a test on its own: a
 * feature whose only inbound links come from inside itself is an island, and
 * an island has no door. /reading-library was exactly that — the library
 * linked its stories, a story linked back to the library, and the hub that
 * used to link the library was deleted. Nothing outside the feature pointed
 * at it, and the check passed anyway.
 */
function routesByPageFile(): Map<string, string[]> {
  const app = readFileSync(join(SRC, "App.tsx"), "utf8");

  const fileOf = new Map<string, string>();
  for (const [, name, mod] of app.matchAll(/const\s+(\w+)\s*=\s*[^;]*?import\("\.\/(pages\/[^"]+)"\)/g)) {
    fileOf.set(name, `${mod}.tsx`);
  }

  const routes = new Map<string, string[]>();
  // The tail is a lookahead so it is not consumed: matching it normally would
  // swallow the next few <Route> tags and quietly drop them from the map.
  for (const match of app.matchAll(/<Route\s+path="(\/[^"]*)"(?=([\s\S]{0,400}))/g)) {
    const [, path, tail] = match;
    // The first referenced component that is actually a page — skipping the
    // ErrorBoundary/ProtectedRoute/subscription wrappers around it.
    const page = [...tail.matchAll(/<([A-Z]\w+)/g)].map(([, n]) => n).find((n) => fileOf.has(n));
    if (!page) continue;
    const file = fileOf.get(page)!;
    routes.set(file, [...(routes.get(file) ?? []), path]);
  }
  return routes;
}

/** Strip ":param" segments so "/x/:id" and "/x" compare as the same feature. */
const base = (path: string) => path.replace(/\/:[^/]+/g, "");

/** Every internal path the app links to, and the files each link came from. */
function linkedPaths(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const patterns = [
    /\bto="(\/[^"]*)"/g,
    /\bto='(\/[^']*)'/g,
    /\bto:\s*"(\/[^"]*)"/g,
    /\bto:\s*'(\/[^']*)'/g,
    /navigate\("(\/[^"]*)"/g,
    /navigate\('(\/[^']*)'/g,
    /navigate\(`(\/[^`$]*)/g,
    /\bhref="(\/[^"]*)"/g,
    /\bto=\{`(\/[^`$]*)/g,
  ];
  for (const file of walk(SRC)) {
    const rel = file.replace(`${SRC}/`, "");
    const text = readFileSync(file, "utf8");
    for (const pattern of patterns) {
      for (const [, path] of text.matchAll(pattern)) {
        if (!found.has(path)) found.set(path, new Set());
        found.get(path)!.add(rel);
      }
    }
  }
  return found;
}

/**
 * "/stories/:id" is reachable if anything links to "/stories/..." at all —
 * but only counting links from outside the feature itself. A page that is only
 * reachable *through* the route it links to cannot be the way in to it, so
 * links from the route's own page, or from a page nested underneath it, do not
 * open a door.
 */
function isReachable(
  routePath: string,
  linked: Map<string, Set<string>>,
  routesOf: Map<string, string[]>,
): boolean {
  const target = base(routePath);
  const inside = (file: string) => {
    const own = routesOf.get(file);
    // A component with no route of its own — the dock, a card, surfaces.ts —
    // is chrome, reachable from wherever it is mounted. It always counts.
    if (!own?.length) return false;
    return own.every((r) => base(r) === target || base(r).startsWith(`${target}/`));
  };
  const from = (path: string) => [...(linked.get(path) ?? [])].some((f) => !inside(f));

  if (from(routePath) || from(target)) return true;
  const prefix = target.endsWith("/") ? target : `${target}/`;
  return [...linked.keys()].some((l) => l.startsWith(prefix) && from(l));
}

describe("route reachability", () => {
  const learnerRoutes = ROUTES.filter(
    (r) =>
      r.gate !== "admin" &&
      r.gate !== "admin-or-reviewer" &&
      !r.path.startsWith("/admin") &&
      // The catch-all is not an address; it is what happens to the addresses
      // that do not exist.
      r.path !== "*",
  );

  it("gives every learner route a way in from the app itself", () => {
    const linked = linkedPaths();
    const routesOf = routesByPageFile();
    const orphaned = learnerRoutes
      .map((r) => r.path)
      .filter((path) => !(path in NO_LINK_NEEDED) && !isReachable(path, linked, routesOf));

    expect(
      orphaned,
      `Nothing outside the feature itself links to ${orphaned.join(", ")}. Either link it ` +
        `from a surface a learner can find, or add it to NO_LINK_NEEDED with the reason it ` +
        `is reached another way. Links from the route's own page, or from a page nested ` +
        `under it, do not count: a feature that only points at itself has no way in.`,
    ).toEqual([]);
  });

  it("keeps the allow-list from outliving the routes it excuses", () => {
    // An entry left behind after its route is deleted quietly excuses a path
    // that no longer exists, and the next route to take that path inherits the
    // excuse without anyone deciding to give it one.
    const paths = new Set(ROUTES.map((r) => r.path));
    const stale = Object.keys(NO_LINK_NEEDED).filter((p) => !paths.has(p));

    expect(stale, `NO_LINK_NEEDED names routes that no longer exist: ${stale.join(", ")}`)
      .toEqual([]);
  });
});
