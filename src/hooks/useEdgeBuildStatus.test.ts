import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import { EDGE_BUILD } from "@/lib/edgeBuildStatus";
import { useEdgeBuildStatus } from "./useEdgeBuildStatus";

/**
 * Asking the backend which build it is running.
 *
 * The probe stands in for "did the deploy happen", which on Lovable Cloud is a
 * separate manual step and was previously answerable only by uploading a video
 * and reading the symptoms.
 */

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

function renderStatus(enabled = true) {
  const rendered = renderHookWithProviders(() => useEdgeBuildStatus({ enabled }), {
    persona: "admin",
  });
  cleanups.push(rendered.cleanup);
  return rendered;
}

describe("useEdgeBuildStatus", () => {
  it("reports current when the backend matches this app", async () => {
    const { result, backend } = renderStatus();
    backend.stubFunction("process-approved-video", { success: true, build: EDGE_BUILD });

    await waitFor(() => expect(result.current.data?.state).toBe("current"));
    expect(result.current.data?.needsDeploy).toBe(false);
    expect(backend.lastCallTo("process-approved-video")?.body).toEqual({ probe: true });
  });

  it("reports stale when the backend is behind", async () => {
    const { result, backend } = renderStatus();
    backend.stubFunction("process-approved-video", { success: true, build: "an-older-build" });

    await waitFor(() => expect(result.current.data?.state).toBe("stale"));
    expect(result.current.data?.needsDeploy).toBe(true);
    expect(result.current.data?.deployed).toBe("an-older-build");
  });

  it("does not report a failed probe as a stale backend", async () => {
    const { result, backend } = renderStatus();
    backend.stubFunctionFailure("process-approved-video", 500);

    await waitFor(() => expect(result.current.data?.state).toBe("unreachable"));
    expect(result.current.data?.needsDeploy).toBe(false);
  });

  it("asks nothing when the viewer could not act on the answer", async () => {
    const { backend } = renderStatus(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(backend.callsTo("process-approved-video")).toHaveLength(0);
  });
});
