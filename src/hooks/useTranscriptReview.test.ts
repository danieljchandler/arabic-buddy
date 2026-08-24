import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { renderHookWithProviders, TEST_USER_ID } from "@/test/support/react/harness";
import { videoId } from "@/test/support/factories";
import type { SupabaseBackend } from "@/test/support/server/handler";
import { useTranscriptReview } from "./useTranscriptReview";

/**
 * The review workspace's data layer.
 *
 * The backend here is the real emulator running the real diff module, so these
 * are end-to-end assertions about what lands in the database rather than about
 * what the hook asked for. The two that matter most: a tick records the text it
 * approved, and a revision row's `previous_value` comes from what was stored —
 * not from anything the client sent.
 */

const VIDEO = videoId(0);

const LINES = [
  { id: "L1", arabic: "شلونك اليوم", translation: "How are you today", startMs: 0, endMs: 1500 },
  { id: "L2", arabic: "زين الحمدلله", translation: "Fine, thank God", startMs: 1500, endMs: 3000 },
];

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function seedVideo(backend: SupabaseBackend, over: Record<string, unknown> = {}) {
  backend.db.seed("discover_videos", [
    {
      id: VIDEO,
      title: "Greeting",
      source_url: "https://youtu.be/x",
      embed_url: "https://youtube.com/embed/x",
      platform: "youtube",
      dialect: "Gulf",
      difficulty: "Beginner",
      published: false,
      created_by: TEST_USER_ID,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      transcript_lines: LINES,
      vocabulary: [],
      grammar_points: [],
      cultural_context: "A greeting exchange.",
      is_meme: false,
      transcription_status: "completed",
      visual_timeline: [],
      ...over,
    },
  ]);
}

function render(
  persona: "transcriber" | "admin" | "free" = "transcriber",
  seed: (backend: SupabaseBackend) => void = seedVideo,
) {
  const harness = renderHookWithProviders(() => useTranscriptReview(VIDEO), { persona, seed });
  cleanup = harness.cleanup;
  return harness;
}

describe("signing off a line", () => {
  it("records who approved it and what they approved", async () => {
    const { result, backend } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.setReviewed.mutateAsync({ lineId: "L1", reviewed: true });

    const rows = backend.db.rows("transcript_line_reviews");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      line_id: "L1",
      reviewed_by: TEST_USER_ID,
      reviewed_arabic: "شلونك اليوم",
      reviewed_translation: "How are you today",
    });
  });

  it("surfaces the tick to the workspace", async () => {
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.setReviewed.mutateAsync({ lineId: "L1", reviewed: true });

    await waitFor(() => expect(result.current.reviews.get("L1")).toBeDefined());
    expect(result.current.reviews.get("L1")?.reviewedArabic).toBe("شلونك اليوم");
  });

  it("takes a tick back", async () => {
    const { result, backend } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    await result.current.setReviewed.mutateAsync({ lineId: "L1", reviewed: true });
    await result.current.setReviewed.mutateAsync({ lineId: "L1", reviewed: false });

    expect(backend.db.rows("transcript_line_reviews")).toHaveLength(0);
  });

  it("refuses a line that is not in the transcript", async () => {
    const { result } = render();

    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(
      result.current.setReviewed.mutateAsync({ lineId: "nope", reviewed: true }),
    ).rejects.toThrow();
  });
});

describe("the audit trail", () => {
  it("logs an Arabic correction with both versions", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.saveLines.mutateAsync({
      lines: [{ ...LINES[0], arabic: "شخبارك اليوم" }, LINES[1]] as never,
    });

    const rows = backend.db.rows("transcript_line_revisions");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      line_id: "L1",
      field: "arabic",
      previous_value: "شلونك اليوم",
      new_value: "شخبارك اليوم",
      changed_by: TEST_USER_ID,
      source: "human",
    });
  });

  it("diffs against what is stored, not against what the client claims", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Someone else changed the line since this editor loaded it. The log must
    // describe the real transition, not the one the stale client believes in.
    backend.db.seed("discover_videos", [
      { ...backend.db.rows("discover_videos")[0], transcript_lines: [{ ...LINES[0], arabic: "نص ثاني" }, LINES[1]] },
    ]);

    await result.current.saveLines.mutateAsync({
      lines: [{ ...LINES[0], arabic: "نص ثالث" }, LINES[1]] as never,
    });

    expect(backend.db.rows("transcript_line_revisions")[0]).toMatchObject({
      previous_value: "نص ثاني",
    });
  });

  it("groups revisions by the line they touched", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.saveLines.mutateAsync({
      lines: [{ ...LINES[0], arabic: "أول" }, { ...LINES[1], translation: "Good" }] as never,
    });

    await waitFor(() => expect(result.current.revisionsByLine.size).toBe(2));
    expect(result.current.revisionsByLine.get("L1")?.[0].field).toBe("arabic");
    expect(result.current.revisionsByLine.get("L2")?.[0].field).toBe("translation");
  });

  it("writes the new transcript through", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.saveLines.mutateAsync({
      lines: [{ ...LINES[0], arabic: "محدث" }, LINES[1]] as never,
    });

    const stored = backend.db.rows("discover_videos")[0].transcript_lines as Array<{ arabic: string }>;
    expect(stored[0].arabic).toBe("محدث");
  });
});

describe("re-translating one line", () => {
  it("replaces the English and logs it as machine-made", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.retranslateLine.mutateAsync({ lineId: "L1" });

    const stored = backend.db.rows("discover_videos")[0].transcript_lines as Array<{ translation: string }>;
    expect(stored[0].translation).toBe("retranslated");

    const revision = backend.db
      .rows("transcript_line_revisions")
      .find((row) => row.field === "translation");
    expect(revision).toMatchObject({
      previous_value: "How are you today",
      source: "ai_retranslate",
    });
  });
});

describe("comments", () => {
  it("stores a suggestion against its author", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.addComment.mutateAsync({
      lineId: "L1",
      body: "‘How's it going’ reads better.",
      kind: "suggestion",
      suggestedTranslation: "How's it going?",
    });

    expect(backend.db.rows("transcript_line_comments")[0]).toMatchObject({
      line_id: "L1",
      kind: "suggestion",
      author_id: TEST_USER_ID,
      suggested_translation: "How's it going?",
    });
  });

  it("groups comments by line and tracks which are still open", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.addComment.mutateAsync({ lineId: "L2", body: "Is this Kuwaiti?" });

    await waitFor(() => expect(result.current.commentsByLine.get("L2")).toHaveLength(1));
    expect(result.current.openCommentLineIds.has("L2")).toBe(true);
  });

  it("closes a comment off", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.addComment.mutateAsync({ lineId: "L2", body: "Check this" });
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    await result.current.resolveComment.mutateAsync({
      commentId: result.current.comments[0].id,
      resolved: true,
    });

    await waitFor(() => expect(result.current.openCommentLineIds.has("L2")).toBe(false));
  });

  it("rejects an empty comment", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      result.current.addComment.mutateAsync({ lineId: "L1", body: "   " }),
    ).rejects.toThrow();
  });

  it("keeps a whole-video comment out of the per-line index", async () => {
    const { result } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.addComment.mutateAsync({ body: "The audio is clipped throughout." });

    await waitFor(() => expect(result.current.comments).toHaveLength(1));
    expect(result.current.commentsByLine.size).toBe(0);
  });
});

describe("notes", () => {
  it("saves a cultural note and logs the change", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.saveNotes.mutateAsync({
      culturalContext: "A greeting between neighbours.",
    });

    expect(backend.db.rows("discover_videos")[0].cultural_context).toBe(
      "A greeting between neighbours.",
    );
    expect(backend.db.rows("transcript_line_revisions")[0]).toMatchObject({
      field: "cultural_context",
      previous_value: "A greeting exchange.",
      line_id: null,
    });
  });

  it("logs nothing when a note is resubmitted unchanged", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.saveNotes.mutateAsync({ culturalContext: "A greeting exchange." });

    expect(backend.db.rows("transcript_line_revisions")).toHaveLength(0);
  });

  it("saves grammar points", async () => {
    const { result, backend } = render();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.saveNotes.mutateAsync({
      grammarPoints: [{ title: "Negation", explanation: "ما before a verb." }],
    });

    expect(backend.db.rows("discover_videos")[0].grammar_points).toHaveLength(1);
  });
});

describe("access", () => {
  it("lets an admin review", async () => {
    const { result } = render("admin");
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      result.current.setReviewed.mutateAsync({ lineId: "L1", reviewed: true }),
    ).resolves.toBeTruthy();
  });

  it("refuses a learner with no reviewer role", async () => {
    const { result } = render("free");
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      result.current.setReviewed.mutateAsync({ lineId: "L1", reviewed: true }),
    ).rejects.toThrow();
  });
});
