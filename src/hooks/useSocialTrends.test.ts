import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders } from "@/test/support/react/harness";
import {
  aSocialPost,
  aTrendingTopic,
  socialPostId,
  trendingTopicId,
} from "@/test/support/factories";
import {
  engagementLabel,
  latestTopicsByCountry,
  type TrendingTopic,
  useAdminSocialPosts,
  useRunSocialHarvest,
  useSetSocialPostStatus,
  useTrendingTopics,
} from "./useSocialTrends";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The social-trends review hooks, admin-side only: the AI screen fills a
 * queue, and these are the tools a content manager uses to work it. What the
 * hooks own is honest filtering (each tab shows exactly its status, because a
 * pending post rendered under "Approved" would look published when it is not)
 * and the human verdict write — the only path that publishes anything.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const topic = (over: Partial<TrendingTopic>): TrendingTopic =>
  aTrendingTopic(over) as unknown as TrendingTopic;

describe("latestTopicsByCountry", () => {
  it("keeps each country's most recent day independently", () => {
    // Kuwait's harvest failed today, Saudi's ran: Kuwait shows yesterday's
    // list rather than vanishing, and Saudi is not dragged back a day.
    const grouped = latestTopicsByCountry([
      topic({ id: "1", country: "Saudi Arabia", topic: "أ", captured_on: "2026-08-28" }),
      topic({ id: "2", country: "Saudi Arabia", topic: "ب", captured_on: "2026-08-27" }),
      topic({ id: "3", country: "Kuwait", topic: "ج", captured_on: "2026-08-27" }),
    ]);
    expect(grouped.get("Saudi Arabia")?.map((t) => t.topic)).toEqual(["أ"]);
    expect(grouped.get("Kuwait")?.map((t) => t.topic)).toEqual(["ج"]);
  });

  it("orders a country's chips by rank with unranked last", () => {
    const grouped = latestTopicsByCountry([
      topic({ id: "1", country: "Egypt", topic: "ثالث", rank: null }),
      topic({ id: "2", country: "Egypt", topic: "أول", rank: 1 }),
      topic({ id: "3", country: "Egypt", topic: "ثاني", rank: 2 }),
    ]);
    expect(grouped.get("Egypt")?.map((t) => t.topic)).toEqual(["أول", "ثاني", "ثالث"]);
  });
});

describe("engagementLabel", () => {
  it("speaks each platform's own currency", () => {
    expect(engagementLabel("telegram", { views: 14700 })).toBe("14.7K views");
    expect(engagementLabel("reddit", { ups: 42, comments: 7 })).toBe("42 upvotes · 7 comments");
    expect(engagementLabel("reddit", { ups: 1200 })).toBe("1.2K upvotes");
  });

  it("says nothing rather than '0 views' when the harvest captured no count", () => {
    // Cards render the line conditionally; an empty string hides it, while a
    // zero would read as "nobody saw this" — which the harvest cannot know.
    expect(engagementLabel("telegram", {})).toBe("");
    expect(engagementLabel("reddit", null)).toBe("");
    expect(engagementLabel("x", { views: 5 })).toBe("");
  });
});

describe("the trend chips", () => {
  const seedTopics =
    (rows: Record<string, unknown>[]) =>
    (backend: SupabaseBackend) =>
      backend.db.seed("trending_topics", rows);

  it("filters to the selected dialect's countries", async () => {
    const harness = renderHookWithProviders(() => useTrendingTopics("Egyptian"), {
      persona: "content_reviewer",
      seed: seedTopics([
        aTrendingTopic({ id: trendingTopicId(0), country: "Saudi Arabia", dialect: "Gulf" }),
        aTrendingTopic({
          id: trendingTopicId(1),
          country: "Egypt",
          dialect: "Egyptian",
          topic: "#مصر",
        }),
      ]),
    });
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect([...harness.result.current.data!.keys()]).toEqual(["Egypt"]);
  });
});

describe("the review queue", () => {
  const seedPosts =
    (rows: Record<string, unknown>[]) =>
    (backend: SupabaseBackend) =>
      backend.db.seed("social_posts", rows);

  it("shows exactly the requested status, newest capture first", async () => {
    // Each tab is a status. A pending post surfacing under "Approved" would
    // read as published — the exact confusion the human gate exists to end.
    const harness = renderHookWithProviders(
      () => useAdminSocialPosts({ status: "screened" }),
      {
        persona: "content_reviewer",
        seed: seedPosts([
          aSocialPost({
            id: socialPostId(0),
            external_id: "a/1",
            status: "screened",
            captured_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          }),
          aSocialPost({
            id: socialPostId(1),
            external_id: "a/2",
            status: "screened",
            captured_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          }),
          aSocialPost({ id: socialPostId(2), external_id: "a/3", status: "approved" }),
          aSocialPost({ id: socialPostId(3), external_id: "a/4", status: "pending" }),
        ]),
      },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect(harness.result.current.data!.map((p) => p.external_id)).toEqual(["a/2", "a/1"]);
  });

  it("narrows by dialect and platform together", async () => {
    const harness = renderHookWithProviders(
      () => useAdminSocialPosts({ status: "screened", dialect: "Yemeni", platform: "telegram" }),
      {
        persona: "content_reviewer",
        seed: seedPosts([
          aSocialPost({ id: socialPostId(0), external_id: "a/1", dialect: "Yemeni", status: "screened" }),
          aSocialPost({
            id: socialPostId(1),
            external_id: "a/2",
            dialect: "Yemeni",
            platform: "reddit",
            status: "screened",
          }),
          aSocialPost({ id: socialPostId(2), external_id: "a/3", dialect: "Gulf", status: "screened" }),
        ]),
      },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect(harness.result.current.data!.map((p) => p.external_id)).toEqual(["a/1"]);
  });

  it("treats 'All' as no filter rather than a value to match", async () => {
    const harness = renderHookWithProviders(
      () => useAdminSocialPosts({ status: "All", dialect: "All", platform: "All" }),
      {
        persona: "content_reviewer",
        seed: seedPosts([
          aSocialPost({ id: socialPostId(0), external_id: "a/1", status: "screened" }),
          aSocialPost({ id: socialPostId(1), external_id: "a/2", status: "rejected" }),
        ]),
      },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect(harness.result.current.data).toHaveLength(2);
  });

  it("surfaces a read failure instead of an empty queue", async () => {
    const harness = renderHookWithProviders(() => useAdminSocialPosts({ status: "screened" }), {
      persona: "content_reviewer",
      seed: (backend: SupabaseBackend) =>
        backend.db.failAlways("social_posts", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;
    // An error rendered as "review queue is empty" would send the reviewer
    // off to run harvests when the database is what broke.
    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });
});

describe("the human verdict", () => {
  it("writes exactly a status change for the chosen post", async () => {
    const harness = renderHookWithProviders(() => useSetSocialPostStatus(), {
      persona: "content_reviewer",
      seed: (backend: SupabaseBackend) =>
        backend.db.seed("social_posts", [
          aSocialPost({ id: socialPostId(0), status: "screened" }),
        ]),
    });
    cleanup = harness.cleanup;

    await harness.result.current.mutateAsync({ id: socialPostId(0), status: "approved" });

    // Only the status moves: the screen verdict, translation and engagement
    // stay as the harvester wrote them, because they are the audit trail of
    // what the reviewer saw when they decided.
    const write = harness.backend.db.lastWriteTo("social_posts");
    expect(write?.payload[0]).toEqual({ status: "approved" });
  });

  it("reports a refused write instead of pretending it stuck", async () => {
    const harness = renderHookWithProviders(() => useSetSocialPostStatus(), {
      persona: "content_reviewer",
      seed: (backend: SupabaseBackend) =>
        backend.db.failWrites("social_posts", 403, { message: "not allowed" }),
    });
    cleanup = harness.cleanup;

    await expect(
      harness.result.current.mutateAsync({ id: socialPostId(0), status: "rejected" }),
    ).rejects.toBeTruthy();
  });
});

describe("running a harvest", () => {
  it("invokes the edge function and hands back the per-dialect summary", async () => {
    const summary = {
      topics: 12,
      telegramPosts: 9,
      redditPosts: 2,
      screenCalls: 15,
      allTargetsReached: false,
      review: {
        Gulf: { target: 5, have: 3, screenedThisRun: { screened: 3, rejected: 7 }, queueEmpty: true },
      },
    };
    const harness = renderHookWithProviders(() => useRunSocialHarvest(), {
      persona: "content_reviewer",
      seed: (backend: SupabaseBackend) =>
        backend.stubFunction("harvest-social-trends", summary),
    });
    cleanup = harness.cleanup;

    // The summary is the reviewer's feedback loop: "Gulf 3/5, queue empty"
    // says add sources; a bare "done" would hide exactly that signal.
    await expect(harness.result.current.mutateAsync()).resolves.toEqual(summary);
  });

  it("propagates a failed run", async () => {
    const harness = renderHookWithProviders(() => useRunSocialHarvest(), {
      persona: "content_reviewer",
      seed: (backend: SupabaseBackend) =>
        backend.stubFunctionFailure("harvest-social-trends", 500, { error: "boom" }),
    });
    cleanup = harness.cleanup;

    await expect(harness.result.current.mutateAsync()).rejects.toBeTruthy();
  });
});
