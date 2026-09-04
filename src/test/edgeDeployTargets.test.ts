import { describe, expect, it } from "vitest";
import { functionsToDeploy, reachableFiles, relativeImports, readFunctionSources } from "../../scripts/edge-functions-to-deploy.mjs";

/**
 * Which edge functions a change requires deploying.
 *
 * Edge functions do not deploy with the app, so a function left behind is a
 * silent difference between the code and the running system — the exact
 * failure that cost several rounds of chasing a transcription bug that had
 * already been fixed. The deploy job in CI takes its list from here, so the
 * bias throughout is toward deploying: missing a function is the expensive
 * mistake, and deploying a spare one costs a few seconds.
 */

const F = "supabase/functions";

const fixture = {
  [`${F}/alpha/index.ts`]: `import { a } from "../_shared/one.ts";`,
  [`${F}/beta/index.ts`]: `import { b } from "../_shared/two.ts";`,
  [`${F}/gamma/index.ts`]: `console.log("no shared imports at all");`,
  [`${F}/_shared/one.ts`]: `import { deep } from "./deep.ts";`,
  [`${F}/_shared/two.ts`]: `export const b = 2;`,
  [`${F}/_shared/deep.ts`]: `export const deep = true;`,
  [`${F}/_test/harness.ts`]: `import "../_shared/one.ts";`,
};

describe("relativeImports", () => {
  it("finds the forms these modules actually use", () => {
    const source = [
      `import { a } from "../_shared/one.ts";`,
      `import type { T } from './two.ts';`,
      `const m = await import("../_shared/lazy.ts");`,
      `import "./side-effect.ts";`,
      `import { serve } from "https://deno.land/std@0.168.0/http/server.ts";`,
      `import { createClient } from "https://esm.sh/@supabase/supabase-js@2";`,
    ].join("\n");

    const found = relativeImports(source);
    expect(found).toContain("../_shared/one.ts");
    expect(found).toContain("./two.ts");
    expect(found).toContain("../_shared/lazy.ts");
    expect(found).toContain("./side-effect.ts");
    // Remote modules cannot be changed by a commit in this repo, so they are
    // not part of the graph.
    expect(found.some((s) => s.startsWith("http"))).toBe(false);
  });
});

describe("reachableFiles", () => {
  it("follows imports as far as they go", () => {
    // A module three hops down is still bundled into whatever imports it, so
    // reachability has to be transitive or a shared change looks harmless.
    const reached = reachableFiles(`${F}/alpha/index.ts`, fixture);
    expect(reached.has(`${F}/_shared/one.ts`)).toBe(true);
    expect(reached.has(`${F}/_shared/deep.ts`)).toBe(true);
    expect(reached.has(`${F}/_shared/two.ts`)).toBe(false);
  });

  it("does not fall over on an import it cannot resolve", () => {
    const reached = reachableFiles(`${F}/alpha/index.ts`, {
      [`${F}/alpha/index.ts`]: `import "../_shared/missing.ts";`,
    });
    expect(reached.has(`${F}/alpha/index.ts`)).toBe(true);
  });
});

describe("functionsToDeploy", () => {
  it("deploys a function whose own code changed", () => {
    expect(functionsToDeploy([`${F}/beta/index.ts`], fixture)).toEqual(["beta"]);
  });

  it("deploys every function that reaches a changed shared module", () => {
    // one.ts is imported by alpha directly; nothing else touches it.
    expect(functionsToDeploy([`${F}/_shared/one.ts`], fixture)).toEqual(["alpha"]);
  });

  it("follows a shared change through another shared module", () => {
    // Nothing imports deep.ts directly except one.ts, which alpha imports.
    // Missing this is exactly how a function gets left behind.
    expect(functionsToDeploy([`${F}/_shared/deep.ts`], fixture)).toEqual(["alpha"]);
  });

  it("deploys nothing for a change to the test harness", () => {
    // _test is how the functions are tested, not what runs in production —
    // even though it imports the same shared modules.
    expect(functionsToDeploy([`${F}/_test/harness.ts`], fixture)).toEqual([]);
  });

  it("ignores changes outside the functions tree", () => {
    expect(functionsToDeploy(["src/pages/admin/AdminVideos.tsx", "README.md"], fixture)).toEqual([]);
  });

  it("combines direct and shared reasons without repeating a function", () => {
    const names = functionsToDeploy([`${F}/alpha/index.ts`, `${F}/_shared/one.ts`], fixture);
    expect(names).toEqual(["alpha"]);
  });

  it("leaves a function alone when nothing it imports changed", () => {
    expect(functionsToDeploy([`${F}/_shared/two.ts`], fixture)).toEqual(["beta"]);
    expect(functionsToDeploy([`${F}/_shared/one.ts`], fixture)).not.toContain("gamma");
  });
});

describe("against the real functions tree", () => {
  const sources = readFunctionSources();

  it("resolves the pipeline's own dependencies", () => {
    // A guard against the walk silently matching nothing: these two are known
    // to import shared modules, and a regex that stopped working would return
    // an empty set here rather than failing loudly.
    const reached = reachableFiles(`${F}/process-approved-video/index.ts`, sources);
    expect(reached.has(`${F}/_shared/cors.ts`)).toBe(true);
    expect(reached.has(`${F}/_shared/asrConfig.ts`)).toBe(true);
  });

  it("deploys the pipeline when the AI gateway changes", () => {
    // aiGateway is reached through aiBrain and modelRegistry by most of the
    // generating functions, so this is the transitive case in production form.
    const names = functionsToDeploy([`${F}/_shared/aiGateway.ts`], sources);
    expect(names).toContain("process-approved-video");
    expect(names).toContain("analyze-gulf-arabic");
    expect(names.length).toBeGreaterThan(5);
  });

  it("deploys only the one function when only its own file changed", () => {
    expect(functionsToDeploy([`${F}/process-approved-video/index.ts`], sources))
      .toEqual(["process-approved-video"]);
  });
});
