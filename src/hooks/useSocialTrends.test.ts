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
  useSocialPosts,
  useTrendingTopics,
} from "./useSocialTrends";
import type { SupabaseBackend } from "@/test/support/server/handler";

/**
 * The Trending feed: per-country trend chips plus social posts that survived
 * the dialect screen.
 *
 * The screen happens server-side in harvest-social-trends; what this hook owns
 * is never *undoing* it — the feed must show approved rows only, whatever else
 * the table holds — and keeping a partial harvest partial: one country's
 * failed scrape shows that country's yesterday, not everyone's.
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
      persona: "anonymous",
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

  it("shows everything to a signed-out visitor", async () => {
    // /trending is a public page like /discover: the chips are the hook, and
    // the door has to open before anyone has an account.
    const harness = renderHookWithProviders(() => useTrendingTopics("All"), {
      persona: "anonymous",
      seed: seedTopics([aTrendingTopic({ id: trendingTopicId(0) })]),
    });
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect(harness.result.current.data!.size).toBe(1);
  });
});

describe("the screened feed", () => {
  const seedPosts =
    (rows: Record<string, unknown>[]) =>
    (backend: SupabaseBackend) =>
      backend.db.seed("social_posts", rows);

  it("shows approved posts only, newest capture first", async () => {
    const harness = renderHookWithProviders(() => useSocialPosts(), {
      persona: "free",
      seed: seedPosts([
        aSocialPost({
          id: socialPostId(0),
          external_id: "a/1",
          captured_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        }),
        aSocialPost({
          id: socialPostId(1),
          external_id: "a/2",
          captured_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        }),
        // The screen's leftovers. RLS hides these from learners in
        // production; the explicit filter keeps the page honest for content
        // managers too, whose role lets pending rows through.
        aSocialPost({ id: socialPostId(2), external_id: "a/3", status: "pending" }),
        aSocialPost({ id: socialPostId(3), external_id: "a/4", status: "rejected" }),
      ]),
    });
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect(harness.result.current.data!.map((p) => p.external_id)).toEqual(["a/2", "a/1"]);
  });

  it("narrows by dialect and platform together", async () => {
    const harness = renderHookWithProviders(
      () => useSocialPosts({ dialect: "Yemeni", platform: "telegram" }),
      {
        persona: "free",
        seed: seedPosts([
          aSocialPost({ id: socialPostId(0), external_id: "a/1", dialect: "Yemeni" }),
          aSocialPost({
            id: socialPostId(1),
            external_id: "a/2",
            dialect: "Yemeni",
            platform: "reddit",
          }),
          aSocialPost({ id: socialPostId(2), external_id: "a/3", dialect: "Gulf" }),
        ]),
      },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect(harness.result.current.data!.map((p) => p.external_id)).toEqual(["a/1"]);
  });

  it("treats 'All' as no filter rather than a value to match", async () => {
    const harness = renderHookWithProviders(
      () => useSocialPosts({ dialect: "All", platform: "All" }),
      {
        persona: "free",
        seed: seedPosts([
          aSocialPost({ id: socialPostId(0), external_id: "a/1", dialect: "Gulf" }),
          aSocialPost({
            id: socialPostId(1),
            external_id: "a/2",
            dialect: "Egyptian",
            platform: "reddit",
          }),
        ]),
      },
    );
    cleanup = harness.cleanup;
    await waitFor(() => expect(harness.result.current.isSuccess).toBe(true));
    expect(harness.result.current.data).toHaveLength(2);
  });

  it("surfaces a read failure instead of an empty feed", async () => {
    const harness = renderHookWithProviders(() => useSocialPosts(), {
      persona: "free",
      seed: (backend: SupabaseBackend) =>
        backend.db.failAlways("social_posts", 500, { message: "boom" }),
    });
    cleanup = harness.cleanup;
    // An error rendered as "nothing has passed the screen yet" would send
    // someone to check the harvester when the database is what broke.
    await waitFor(() => expect(harness.result.current.isError).toBe(true));
  });
});
