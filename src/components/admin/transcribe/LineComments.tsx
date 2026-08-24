import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { TranscriptCommentRow } from "@/hooks/useTranscriptReview";

export type CommentKind = TranscriptCommentRow["kind"];

interface LineCommentsProps {
  comments: TranscriptCommentRow[];
  /** Disabled while a write is in flight. */
  busy?: boolean;
  nameFor?: (userId: string | null) => string;
  onAdd: (input: {
    body: string;
    kind: CommentKind;
    suggestedTranslation?: string;
  }) => Promise<unknown> | void;
  onResolve: (commentId: string, resolved: boolean) => void;
  /** Apply a suggested translation to the line. Absent for whole-video threads. */
  onApplySuggestion?: (suggestion: string) => void;
}

const KIND_LABELS: Record<CommentKind, string> = {
  comment: "Note",
  suggestion: "Better translation",
  concern: "Concern",
};

const KIND_STYLES: Record<CommentKind, string> = {
  comment: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  suggestion: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
  concern: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
};

/**
 * The reviewer's channel back to whoever owns the content.
 *
 * A native speaker checking a transcript hits two kinds of thing they cannot
 * simply fix: a translation that is defensible but wrong in register, and a
 * worry about the clip itself. Both need somewhere to go that is not a silent
 * edit — hence a kind on every comment, and a `suggestion` that carries the
 * proposed English as its own field so it can be applied with one click rather
 * than copied out of a paragraph.
 */
export function LineComments({
  comments,
  busy = false,
  nameFor,
  onAdd,
  onResolve,
  onApplySuggestion,
}: LineCommentsProps) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<CommentKind>("comment");
  const [suggestion, setSuggestion] = useState("");

  const submit = async () => {
    const text = body.trim();
    if (!text) return;
    await onAdd({
      body: text,
      kind,
      suggestedTranslation: kind === "suggestion" ? suggestion.trim() || undefined : undefined,
    });
    setBody("");
    setSuggestion("");
    setKind("comment");
  };

  const open = comments.filter((c) => !c.resolvedAt);
  const resolved = comments.filter((c) => c.resolvedAt);

  const renderComment = (comment: TranscriptCommentRow) => (
    <li
      key={comment.id}
      className={cn(
        "rounded-lg border p-3",
        comment.resolvedAt
          ? "border-gray-200 opacity-60 dark:border-gray-800"
          : "border-gray-200 dark:border-gray-700",
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span className={cn("rounded px-1.5 py-0.5 font-medium", KIND_STYLES[comment.kind])}>
          {KIND_LABELS[comment.kind]}
        </span>
        {nameFor && <span>{nameFor(comment.authorId)}</span>}
        <span>{new Date(comment.createdAt).toLocaleDateString()}</span>
        {comment.resolvedAt && <span className="font-medium">· resolved</span>}
      </div>

      <p className="whitespace-pre-wrap text-sm">{comment.body}</p>

      {comment.suggestedTranslation && (
        <div className="mt-2 rounded border border-sky-200 bg-sky-50/60 px-2 py-1.5 dark:border-sky-800 dark:bg-sky-950/20">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Suggested translation
          </p>
          <p className="text-sm">{comment.suggestedTranslation}</p>
          {onApplySuggestion && !comment.resolvedAt && (
            <Button
              size="sm"
              variant="outline"
              className="mt-1.5 h-6 text-[11px]"
              disabled={busy}
              onClick={() => onApplySuggestion(comment.suggestedTranslation!)}
            >
              Use this translation
            </Button>
          )}
        </div>
      )}

      <Button
        size="sm"
        variant="ghost"
        className="mt-1.5 h-6 text-[11px]"
        disabled={busy}
        onClick={() => onResolve(comment.id, !comment.resolvedAt)}
      >
        {comment.resolvedAt ? "Reopen" : "Mark resolved"}
      </Button>
    </li>
  );

  return (
    <div className="space-y-3">
      {comments.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No comments on this line yet.
        </p>
      )}

      {open.length > 0 && <ul className="space-y-2">{open.map(renderComment)}</ul>}

      {resolved.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {resolved.length} resolved
          </summary>
          <ul className="mt-2 space-y-2">{resolved.map(renderComment)}</ul>
        </details>
      )}

      <div className="space-y-2 rounded-lg border border-dashed border-gray-300 p-3 dark:border-gray-700">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(KIND_LABELS) as CommentKind[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={kind === option}
              onClick={() => setKind(option)}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] transition-colors",
                kind === option
                  ? KIND_STYLES[option]
                  : "bg-white text-muted-foreground hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800",
              )}
            >
              {KIND_LABELS[option]}
            </button>
          ))}
        </div>

        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            kind === "suggestion"
              ? "Why is the current translation wrong?"
              : kind === "concern"
                ? "What is the problem with this line?"
                : "Anything worth noting about this line…"
          }
          rows={3}
          aria-label="Comment"
        />

        {kind === "suggestion" && (
          <Input
            value={suggestion}
            onChange={(e) => setSuggestion(e.target.value)}
            placeholder="Your suggested English"
            aria-label="Suggested translation"
          />
        )}

        <Button size="sm" disabled={busy || !body.trim()} onClick={submit}>
          {busy ? "Saving…" : "Add comment"}
        </Button>
      </div>
    </div>
  );
}

export default LineComments;
