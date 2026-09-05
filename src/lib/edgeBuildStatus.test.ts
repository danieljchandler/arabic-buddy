import { describe, expect, it } from "vitest";
import {
  EDGE_BUILD,
  PIPELINE_FUNCTIONS,
  deployInstruction,
  readEdgeBuildStatus,
} from "./edgeBuildStatus";
import { EDGE_BUILD as SHARED_EDGE_BUILD } from "../../supabase/functions/_shared/edgeBuild";

/**
 * Telling "the backend is behind" apart from "the backend is fine".
 *
 * Getting this wrong in either direction is costly: a false "stale" sends an
 * admin to ask for a deploy they do not need, and a false "current" is the
 * three-round debugging loop this exists to prevent.
 */

describe("readEdgeBuildStatus", () => {
  it("is current when the deployed build matches this app", () => {
    const status = readEdgeBuildStatus({ build: EDGE_BUILD });
    expect(status.state).toBe("current");
    expect(status.needsDeploy).toBe(false);
  });

  it("is stale when the backend reports an older build", () => {
    const status = readEdgeBuildStatus({ build: "2026-01-01.1" }, "2026-09-04.2");
    expect(status.state).toBe("stale");
    expect(status.needsDeploy).toBe(true);
    // Both values are surfaced, because "which one is running" is the first
    // thing anyone asks next.
    expect(status.deployed).toBe("2026-01-01.1");
    expect(status.expected).toBe("2026-09-04.2");
  });

  it("treats a reply with no build as a deployment old enough not to know", () => {
    // The marker is the newer thing, so its absence dates the deployment.
    const status = readEdgeBuildStatus({ success: true } as { build?: unknown });
    expect(status.state).toBe("unknown");
    expect(status.needsDeploy).toBe(true);
  });

  it("does not call an unreachable backend stale", () => {
    // A network blip must not send someone to ask for a deploy of a backend
    // that is perfectly current.
    const status = readEdgeBuildStatus(null);
    expect(status.state).toBe("unreachable");
    expect(status.needsDeploy).toBe(false);
    expect(status.deployed).toBeNull();
  });

  it("ignores a blank or non-string build", () => {
    expect(readEdgeBuildStatus({ build: "   " }).state).toBe("unknown");
    expect(readEdgeBuildStatus({ build: 42 }).state).toBe("unknown");
  });
});

describe("deployInstruction", () => {
  it("names the functions, since that is the part that is actionable", () => {
    // "Redeploy the edge functions" is not actionable when there are 119 of
    // them and the reader has to ask someone else to do it.
    const text = deployInstruction(PIPELINE_FUNCTIONS);
    expect(text).toContain("process-approved-video");
    expect(text).toContain("analyze-gulf-arabic");
    expect(text).toContain("Merging does not deploy them");
  });
});

describe("EDGE_BUILD", () => {
  it("is a non-empty marker", () => {
    expect(typeof EDGE_BUILD).toBe("string");
    expect(EDGE_BUILD.length).toBeGreaterThan(0);
  });

  it("is the same value the edge functions compile in", () => {
    // The whole check rests on one definition reaching both halves. A marker
    // the frontend declared for itself would compare against itself and read
    // "current" against any backend at all, which is worse than no check.
    expect(EDGE_BUILD).toBe(SHARED_EDGE_BUILD);
  });
});
