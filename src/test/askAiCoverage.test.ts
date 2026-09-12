import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ROUTES, type RouteSpec } from "./support/routes/manifest";
import { ASSISTANT_OFF_ROUTES, isAssistantOffRoute } from "@/lib/assistantRoutes";
import { hintKeyForPath } from "@/lib/pageAiContext";
import { PAGE_HINTS } from "@/lib/pageHints";

/**
 * The Ask AI assistant has to be on every page, and on every page it has to
 * know what it is looking at.
 *
 * Both halves kept regressing the same way: a route was added, nobody thought
 * about the tutor, and the gap was invisible — the disc is mounted globally, so
 * a page with no context of its own still *looks* right. It just answers "what
 * am I looking at?" with the app's name and a URL. This is the drift guard for
 * that, in the shape of the others in this directory: the manifest is the
 * source of truth for what routes exist, and every learner route has to be
 * accounted for here or the fast unit job goes red.
 *
 * Deliberately shallow, like its neighbours. It cannot tell a rich context
 * from a thin one — only that the page has some way to say what it is showing.
 * Whether that description is any good is what review is for.
 */

const SRC = resolve(process.cwd(), "src");

/** The routes a learner actually walks around in. */
function learnerRoutes(): RouteSpec[] {
  return ROUTES.filter(
    (route) =>
      (route.gate === "public" || route.gate === "auth" || route.gate === "in-page") &&
      !route.redirectsTo &&
      route.path !== "*",
  );
}

/** Route path → the page file that serves it, read off App.tsx. */
function pageFileByRoute(): Map<string, string> {
  const app = readFileSync(join(SRC, "App.tsx"), "utf8");

  const fileOf = new Map<string, string>();
  for (const [, name, mod] of app.matchAll(/const\s+(\w+)\s*=\s*[^;]*?import\("\.\/(pages\/[^"]+)"\)/g)) {
    fileOf.set(name, `${mod}.tsx`);
  }

  const byRoute = new Map<string, string>();
  // Lookahead so the tail isn't consumed — matching it normally swallows the
  // next few <Route> tags and drops them silently.
  for (const [, path, tail] of app.matchAll(/<Route\s+path="(\/[^"]*)"(?=([\s\S]{0,400}))/g)) {
    const page = [...tail.matchAll(/<([A-Z]\w+)/g)].map(([, n]) => n).find((n) => fileOf.has(n));
    if (page) byRoute.set(path, fileOf.get(page)!);
  }
  return byRoute;
}

/** Does this page publish a context of its own? */
function publishesContext(file: string): boolean {
  return readFileSync(join(SRC, file), "utf8").includes("usePageAiContext");
}

/**
 * The learner routes the assistant is deliberately absent from, and why.
 *
 * Kept here rather than derived from ASSISTANT_OFF_ROUTES on purpose: reading
 * the answer off the same list that produces it would assert nothing. This is
 * the second signature. A new route that lands under an off prefix — or a new
 * prefix — fails until somebody writes down that they meant it.
 */
const ASSISTANT_OFF_BY_DESIGN: Record<string, string> = {
  "/auth": "the sign-in form; there is no learner yet and nothing to ask about",
  "/login/id": "the ID sign-in form, same as /auth",
  "/reset-password": "reached from an email link; a password form is not a lesson",
  "/onboarding": "a guided first run that asks its own questions",
  "/admin/login": "the staff console's door — public only so staff can reach it",
};

describe("the Ask AI button reaches every page", () => {
  it("leaves no learner route without the assistant", () => {
    const missing = learnerRoutes()
      .map((route) => route.path)
      .filter((path) => isAssistantOffRoute(path) && !(path in ASSISTANT_OFF_BY_DESIGN));

    expect(
      missing,
      `The assistant is switched off on ${missing.join(", ")}. The disc, the Cmd/Ctrl+K ` +
        `shortcut and the panel all read ASSISTANT_OFF_ROUTES, so a learner route that ` +
        `matches one of those prefixes has no way into the tutor at all. Either take the ` +
        `route off that list, or — if a tutor really has no business there — add it to ` +
        `ASSISTANT_OFF_BY_DESIGN above with the reason.`,
    ).toEqual([]);
  });

  it("keeps that exemption list from quietly covering a live page", () => {
    // The other direction: an entry here for a route the assistant is actually
    // on would excuse a future regression before it happened.
    const notActuallyOff = Object.keys(ASSISTANT_OFF_BY_DESIGN).filter(
      (path) => !isAssistantOffRoute(path),
    );

    expect(
      notActuallyOff,
      `${notActuallyOff.join(", ")} is listed as assistant-free but the assistant is on ` +
        `there. Drop the entry.`,
    ).toEqual([]);
  });

  it("keeps the off-list from outliving the routes it excuses", () => {
    // An entry left behind after its route is renamed quietly switches the
    // assistant off for whatever takes that prefix next.
    const paths = ROUTES.map((route) => route.path);
    const stale = ASSISTANT_OFF_ROUTES.map(([prefix]) => prefix).filter(
      (prefix) => !paths.some((path) => path === prefix || path.startsWith(`${prefix}/`)),
    );

    expect(stale, `No route matches ${stale.join(", ")} any more.`).toEqual([]);
  });

  it("makes every exemption give a reason", () => {
    const unreasoned = ASSISTANT_OFF_ROUTES.filter(([, reason]) => reason.trim().length < 20).map(
      ([prefix]) => prefix,
    );

    expect(
      unreasoned,
      `${unreasoned.join(", ")} switches the assistant off without saying why. The default ` +
        `is on; turning it off is a decision, and the reason is how the next person knows ` +
        `whether it still holds.`,
    ).toEqual([]);
  });
});

describe("the Ask AI panel knows what page it is on", () => {
  it("gives every learner route something to say about itself", () => {
    const pageFiles = pageFileByRoute();

    const blind = learnerRoutes()
      .filter((route) => !isAssistantOffRoute(route.path))
      .filter((route) => {
        const file = pageFiles.get(route.path);
        // A page that publishes its own context beats any hint.
        if (file && publishesContext(file)) return false;
        const key = hintKeyForPath(route.path);
        return !key || !PAGE_HINTS[key];
      })
      .map((route) => route.path);

    expect(
      blind,
      `Ask AI has nothing to tell the tutor about ${blind.join(", ")}. Either publish what ` +
        `the page is showing with usePageAiContext (best — it can name the actual video, ` +
        `story or word on screen), or add a route prefix to ROUTE_HINTS in ` +
        `src/lib/pageAiContext.ts pointing at a PAGE_HINTS entry that describes the screen. ` +
        `Without one of the two the assistant is handed the app's name and a URL.`,
    ).toEqual([]);
  });

  it("keeps every route hint pointing at a hint that exists", () => {
    // ROUTE_HINTS names PAGE_HINTS keys as strings, so a renamed hint key fails
    // silently: the route resolves, the lookup misses, and the tutor gets the
    // generic fallback on a page that was supposed to be described.
    const routes = learnerRoutes().filter((route) => !isAssistantOffRoute(route.path));
    const dangling = routes
      .map((route) => [route.path, hintKeyForPath(route.path)] as const)
      .filter(([, key]) => key !== null && !PAGE_HINTS[key])
      .map(([path, key]) => `${path} → ${key}`);

    expect(dangling, `These route hints name a PAGE_HINTS key that is gone: ${dangling.join(", ")}`)
      .toEqual([]);
  });

  it("publishes a real context on the pages built around one thing", () => {
    // The hint fallback describes a *kind* of page. It cannot name the video
    // being watched, the story being read or the word being drilled, so on the
    // pages whose whole point is one piece of content it is not enough — those
    // have to publish. Listed explicitly rather than inferred: this is the set
    // somebody decided the tutor must be able to see into.
    const mustPublish = [
      "/discover/:videoId",
      "/stories/:storyId",
      "/reading-library/:id",
      "/listen/:id",
      "/today/story",
      "/alphabet/:letterCode",
      "/learn/:lessonId",
      "/quiz/:lessonId",
      "/review",
      "/review/my-words",
      "/review/my-phrases",
      "/grammar",
      "/translate",
      "/transcribe",
      "/meme",
      "/mistakes",
      "/placement",
      "/bridge",
      "/dialect-compare",
      "/vocab-games",
    ];

    const pageFiles = pageFileByRoute();
    const declared = new Set(ROUTES.map((route) => route.path));

    // The list itself has to stay honest about what the app declares.
    const gone = mustPublish.filter((path) => !declared.has(path));
    expect(gone, `These routes no longer exist: ${gone.join(", ")}`).toEqual([]);

    const silent = mustPublish.filter((path) => {
      const file = pageFiles.get(path);
      return !file || !publishesContext(file);
    });

    expect(
      silent,
      `${silent.join(", ")} is built around one piece of content and does not publish it. ` +
        `Call usePageAiContext with what is on screen — the hint fallback can only say what ` +
        `kind of page this is, which leaves the tutor guessing at the actual material.`,
    ).toEqual([]);
  });
});
