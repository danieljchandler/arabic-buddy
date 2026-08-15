// The shape of "what the learner is looking at", and the rules for fitting it
// into a prompt. Pure — no Deno, no DOM — because all three sides need the same
// answer: the client builds it, `assistant-chat` re-derives it, and
// `realtime-session-token` bakes it into a voice session's instructions.
//
// This replaces a flat 1500-character `content` string. That string could only
// ever hold the line under the cursor, so the assistant was blind to the video
// it was sitting in: "what did he mean earlier?" had nothing to answer from.
// The model here separates the two:
//
//   focus     the material in front of the learner right now
//   document  the whole thing that focus sits inside
//   meta      what the app already knows about the content
//   position  where in the document the learner is
//
// The document is the expensive half, so it is budgeted rather than truncated.
// `slice(0, N)` on a transcript keeps the opening and throws away the part the
// learner is actually watching; `windowDocument` keeps the part around the
// focus and says how much it dropped.

/** One line of a document. Everything but the text is optional — a prose
 *  article has no timings, a vocabulary list has no translations. */
export interface PageContextLine {
  /** 1-based, as numbered for the learner. Absent for unnumbered prose. */
  index?: number;
  arabic?: string;
  english?: string;
  /** Offset into the media, in seconds, when the document is timed. */
  atSeconds?: number;
}

/** A run of lines dropped to stay inside the budget, kept in place so the
 *  model can see that something is missing rather than infer continuity. */
export interface PageContextElision {
  elided: number;
}

export type PageContextEntry = PageContextLine | PageContextElision;

export const isElision = (entry: PageContextEntry): entry is PageContextElision =>
  typeof (entry as PageContextElision).elided === "number";

export interface PageContextDocument {
  /** What this document is, in the assistant's words: "Full transcript". */
  label: string;
  lines?: PageContextLine[];
  /** Prose alternative for documents with no line structure. */
  text?: string;
  /** Where the material came from, so the assistant can offer to read it. */
  sourceUrl?: string;
  /**
   * The row id of the content on screen, when it has one.
   *
   * Not for the prompt — it never appears in the rendered block. It tells the
   * retrieval layer which source the learner is already looking at, so
   * "elsewhere in the library" can't cite the video they are watching.
   */
  sourceId?: string;
}

export interface PageContextVocabItem {
  arabic: string;
  english?: string;
}

/** Editorial metadata the app already holds about this content. All of it was
 *  generated at ingest and then never shown to the tutor. */
export interface PageContextMeta {
  /** CEFR band, e.g. "A2". */
  level?: string;
  dialect?: string;
  vocabulary?: PageContextVocabItem[];
  grammarPoints?: string[];
  culturalContext?: string;
  /** What is on screen at this moment — scene description, on-screen text. */
  visualContext?: string;
  /** Anything else worth one line, e.g. "the learner has this word due today". */
  notes?: string[];
}

export interface PageContextPosition {
  /** 1-based line number the learner is on. */
  index?: number;
  total?: number;
  atSeconds?: number;
  durationSeconds?: number;
}

/** The wire format: what the client posts and what the functions re-clamp. */
export interface PageContextPayload {
  route?: string;
  title?: string;
  summary?: string;
  /** The material in focus — current subtitle, selected sentence, the word. */
  content?: string;
  document?: PageContextDocument;
  meta?: PageContextMeta;
  position?: PageContextPosition;
}

/**
 * Per-field ceilings. Every one of these is a cost control *and* a blast-radius
 * control: transcripts and scraped articles are third-party text, so the amount
 * of it that can reach a prompt is a number worth being deliberate about.
 */
export interface PageContextBudget {
  title: number;
  summary: number;
  content: number;
  /** Total characters the rendered document may occupy. */
  document: number;
  documentLine: number;
  culturalContext: number;
  visualContext: number;
  vocabulary: number;
  grammarPoints: number;
  notes: number;
  sourceUrl: number;
  route: number;
}

/**
 * Text chat. The document allowance is the one number here that changed the
 * product: 8000 characters covers a whole short-video transcript or a full
 * news article, which is the difference between a tutor that can follow a
 * conversation and one that can only gloss a line.
 */
export const CHAT_BUDGET: PageContextBudget = {
  title: 120,
  summary: 400,
  content: 1500,
  document: 8000,
  documentLine: 400,
  culturalContext: 800,
  visualContext: 600,
  vocabulary: 30,
  grammarPoints: 15,
  notes: 8,
  sourceUrl: 300,
  route: 100,
};

/**
 * Live voice. Deliberately tighter than chat: these instructions are carried by
 * a Realtime session and re-sent on every context update, and a voice tutor
 * answers in one or two spoken sentences — it cannot spend a long transcript
 * usefully the way a written answer can.
 */
export const VOICE_BUDGET: PageContextBudget = {
  ...CHAT_BUDGET,
  document: 4000,
  culturalContext: 500,
};

const clip = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
};

const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

/** mm:ss, or h:mm:ss past an hour. Timestamps are for the learner's benefit as
 *  much as the model's — "at 0:47" is something they can go and check. */
export function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** Render one line the way it appears in the prompt. */
function renderLine(line: PageContextLine, budget: PageContextBudget, focused: boolean): string {
  const number = line.index !== undefined ? `${line.index}. ` : "";
  const marker = focused ? "▶ " : "";
  const time = line.atSeconds !== undefined ? `[${formatTimestamp(line.atSeconds)}] ` : "";
  const arabic = clip(line.arabic, budget.documentLine) ?? "";
  const english = clip(line.english, budget.documentLine);
  const body = english ? `${arabic} — ${english}` : arabic;
  return `${marker}${number}${time}${body}`.trim();
}

/**
 * Fit a document's lines into `maxChars`, keeping the ones that matter.
 *
 * Truncation would keep the opening and drop the rest, which is exactly
 * backwards: the learner is asking about the line they are on. So the window
 * grows outward from the focus, and — when the focus is far enough in that the
 * opening would otherwise vanish — a short head is reserved first, because
 * "what is this video even about" is answered by its first few lines.
 *
 * Dropped runs are reported as elisions rather than silently closed up. A model
 * shown two non-adjacent lines with no gap marker will read them as
 * consecutive, and then explain a transition that never happened.
 */
export function windowDocument(
  lines: PageContextLine[],
  focusIndex: number,
  maxChars: number,
  budget: PageContextBudget = CHAT_BUDGET,
): PageContextEntry[] {
  if (lines.length === 0) return [];

  const cost = lines.map((line) => renderLine(line, budget, false).length + 1);
  const total = cost.reduce((a, b) => a + b, 0);
  if (total <= maxChars) return [...lines];

  // A focus outside the array (or unknown) means "no particular line" — start
  // from the top, which is the only defensible default.
  const focus = focusIndex >= 0 && focusIndex < lines.length ? focusIndex : 0;

  const keep = new Set<number>();
  let spent = 0;

  const take = (i: number): boolean => {
    if (i < 0 || i >= lines.length || keep.has(i)) return false;
    if (spent + cost[i] > maxChars) return false;
    keep.add(i);
    spent += cost[i];
    return true;
  };

  // The head, but only when it is not already part of the window we are about
  // to grow — and never more than a fifth of the budget, so orientation can
  // never crowd out the thing being asked about.
  const HEAD_LINES = 2;
  if (focus > HEAD_LINES + 1) {
    const headCap = maxChars / 5;
    for (let i = 0; i < HEAD_LINES && spent < headCap; i++) take(i);
  }

  take(focus);

  // Grow outward from the focus, forward first: the next line is what the
  // learner is about to hear, and is the more common follow-up question. The
  // window stays contiguous — a window with holes in it reads as a document
  // with holes in it — and stops the moment neither direction fits.
  let lo = focus;
  let hi = focus;
  for (;;) {
    let progressed = false;
    // Step over anything the head reservation already claimed, so meeting it
    // doesn't look like a budget refusal.
    while (hi < lines.length - 1 && keep.has(hi + 1)) hi++;
    if (hi < lines.length - 1 && take(hi + 1)) {
      hi++;
      progressed = true;
    }
    while (lo > 0 && keep.has(lo - 1)) lo--;
    if (lo > 0 && take(lo - 1)) {
      lo--;
      progressed = true;
    }
    if (!progressed) break;
  }

  const out: PageContextEntry[] = [];
  let gap = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (gap > 0) {
        out.push({ elided: gap });
        gap = 0;
      }
      out.push(lines[i]);
    } else {
      gap++;
    }
  }
  if (gap > 0) out.push({ elided: gap });
  return out;
}

/**
 * Sanitize and cap a payload from the client. This is the trust boundary: both
 * edge functions run it on whatever arrives, so a page that publishes something
 * enormous costs its own request and nothing else.
 */
export function clampPageContext(
  raw: PageContextPayload | null | undefined,
  budget: PageContextBudget = CHAT_BUDGET,
): PageContextPayload {
  const input = raw ?? {};
  const out: PageContextPayload = {};

  const route = clip(input.route, budget.route);
  if (route) out.route = route;
  const title = clip(input.title, budget.title);
  if (title) out.title = title;
  const summary = clip(input.summary, budget.summary);
  if (summary) out.summary = summary;
  const content = clip(input.content, budget.content);
  if (content) out.content = content;

  const position = input.position;
  if (position) {
    const p: PageContextPosition = {
      index: finite(position.index),
      total: finite(position.total),
      atSeconds: finite(position.atSeconds),
      durationSeconds: finite(position.durationSeconds),
    };
    if (Object.values(p).some((v) => v !== undefined)) out.position = p;
  }

  const doc = input.document;
  if (doc) {
    const label = clip(doc.label, 80) ?? "Content";
    const lines = Array.isArray(doc.lines)
      ? doc.lines
          .filter((l): l is PageContextLine => !!l && (typeof l.arabic === "string" || typeof l.english === "string"))
          .map((l) => {
            const line: PageContextLine = {
              index: finite(l.index),
              atSeconds: finite(l.atSeconds),
            };
            const arabic = clip(l.arabic, budget.documentLine);
            if (arabic) line.arabic = arabic;
            const english = clip(l.english, budget.documentLine);
            if (english) line.english = english;
            return line;
          })
      : undefined;
    const text = clip(doc.text, budget.document);
    const sourceUrl = clip(doc.sourceUrl, budget.sourceUrl);
    const sourceId = clip(doc.sourceId, 100);
    if ((lines && lines.length > 0) || text) {
      out.document = { label };
      if (lines && lines.length > 0) out.document.lines = lines;
      if (text) out.document.text = text;
      if (sourceUrl) out.document.sourceUrl = sourceUrl;
      if (sourceId) out.document.sourceId = sourceId;
    }
  }

  const meta = input.meta;
  if (meta) {
    const m: PageContextMeta = {};
    const level = clip(meta.level, 20);
    if (level) m.level = level;
    const dialect = clip(meta.dialect, 40);
    if (dialect) m.dialect = dialect;
    const cultural = clip(meta.culturalContext, budget.culturalContext);
    if (cultural) m.culturalContext = cultural;
    const visual = clip(meta.visualContext, budget.visualContext);
    if (visual) m.visualContext = visual;
    if (Array.isArray(meta.vocabulary)) {
      const vocab = meta.vocabulary
        .filter((v) => v && typeof v.arabic === "string")
        .slice(0, budget.vocabulary)
        .map((v) => {
          const item: PageContextVocabItem = { arabic: clip(v.arabic, 80) ?? "" };
          const english = clip(v.english, 120);
          if (english) item.english = english;
          return item;
        })
        .filter((v) => v.arabic);
      if (vocab.length > 0) m.vocabulary = vocab;
    }
    if (Array.isArray(meta.grammarPoints)) {
      const points = meta.grammarPoints
        .map((g) => clip(g, 200))
        .filter((g): g is string => !!g)
        .slice(0, budget.grammarPoints);
      if (points.length > 0) m.grammarPoints = points;
    }
    if (Array.isArray(meta.notes)) {
      const notes = meta.notes
        .map((n) => clip(n, 200))
        .filter((n): n is string => !!n)
        .slice(0, budget.notes);
      if (notes.length > 0) m.notes = notes;
    }
    if (Object.keys(m).length > 0) out.meta = m;
  }

  return out;
}

/**
 * Flatten a payload into the plain-text block that goes into a prompt.
 *
 * Ordering is deliberate. Position and focus come before the document so the
 * model reads "you are here" before it reads eight thousand characters of
 * transcript, and the focused line is marked again inside the document so the
 * two references are unmistakably the same line.
 */
export function serializePageContext(
  payload: PageContextPayload,
  budget: PageContextBudget = CHAT_BUDGET,
): string {
  const lines: string[] = [];

  if (payload.route) lines.push(`Route: ${payload.route}`);
  if (payload.title) lines.push(`Page: ${payload.title}`);
  if (payload.summary) lines.push(`About this page: ${payload.summary}`);

  const pos = payload.position;
  if (pos) {
    const parts: string[] = [];
    if (pos.index !== undefined) {
      parts.push(pos.total !== undefined ? `line ${pos.index} of ${pos.total}` : `line ${pos.index}`);
    }
    if (pos.atSeconds !== undefined) {
      parts.push(
        pos.durationSeconds !== undefined
          ? `${formatTimestamp(pos.atSeconds)} of ${formatTimestamp(pos.durationSeconds)}`
          : `at ${formatTimestamp(pos.atSeconds)}`,
      );
    }
    if (parts.length > 0) lines.push(`Where the learner is: ${parts.join(" · ")}`);
  }

  if (payload.content) lines.push(`In focus right now: ${payload.content}`);

  const meta = payload.meta;
  if (meta?.visualContext) lines.push(`On screen at this moment: ${meta.visualContext}`);

  const doc = payload.document;
  if (doc) {
    const header = doc.sourceUrl ? `${doc.label} (source: ${doc.sourceUrl})` : doc.label;
    if (doc.lines && doc.lines.length > 0) {
      // The focus is matched by the learner-facing line number, not by array
      // position: a windowed document has holes in it, and pages number their
      // lines from 1 while arrays start at 0.
      const focusArrayIndex = pos?.index !== undefined
        ? doc.lines.findIndex((l) => l.index === pos.index)
        : -1;
      const entries = windowDocument(doc.lines, focusArrayIndex, budget.document, budget);
      lines.push(`${header}:`);
      for (const entry of entries) {
        if (isElision(entry)) {
          lines.push(`  … ${entry.elided} line${entry.elided === 1 ? "" : "s"} omitted …`);
          continue;
        }
        const focused = entry.index !== undefined && entry.index === pos?.index;
        lines.push(`  ${renderLine(entry, budget, focused)}`);
      }
    } else if (doc.text) {
      lines.push(`${header}:`);
      lines.push(doc.text);
    }
  }

  if (meta) {
    const badges = [meta.level && `Level: ${meta.level}`, meta.dialect && `Dialect: ${meta.dialect}`]
      .filter(Boolean)
      .join(" · ");
    if (badges) lines.push(badges);
    if (meta.vocabulary?.length) {
      lines.push(
        `Key vocabulary in this content: ${meta.vocabulary
          .map((v) => (v.english ? `${v.arabic} (${v.english})` : v.arabic))
          .join(", ")}`,
      );
    }
    if (meta.grammarPoints?.length) {
      lines.push(`Grammar in this content: ${meta.grammarPoints.join("; ")}`);
    }
    if (meta.culturalContext) lines.push(`Cultural context: ${meta.culturalContext}`);
    for (const note of meta.notes ?? []) lines.push(note);
  }

  return lines.join("\n");
}

/** True when there is anything worth putting in a prompt. */
export function hasPageContext(payload: PageContextPayload): boolean {
  return serializePageContext(payload).length > 0;
}

/**
 * The short form: where the learner is now, and what is in front of them.
 *
 * Sent mid-call to a live voice session, where the full document already went
 * out with the session's instructions and re-sending it every time a subtitle
 * advances would be several thousand characters per line of video. What
 * actually changes is the position and the focus, so that is all this carries.
 *
 * Empty when there is no position and no focus — nothing to say.
 */
export function serializeFocusUpdate(
  payload: PageContextPayload,
  budget: PageContextBudget = VOICE_BUDGET,
): string {
  const clamped = clampPageContext(payload, budget);
  const lines: string[] = [];

  const pos = clamped.position;
  if (pos?.index !== undefined) {
    lines.push(
      pos.total !== undefined
        ? `The learner is now on line ${pos.index} of ${pos.total}.`
        : `The learner is now on line ${pos.index}.`,
    );
  }
  if (pos?.atSeconds !== undefined) {
    lines.push(`Playback is at ${formatTimestamp(pos.atSeconds)}.`);
  }
  if (clamped.content) lines.push(`In focus right now: ${clamped.content}`);
  if (clamped.meta?.visualContext) {
    lines.push(`On screen at this moment: ${clamped.meta.visualContext}`);
  }

  // A title on its own is not an update — the page hasn't moved, and a note
  // saying so would just be noise in the middle of a conversation.
  if (lines.length === 0) return "";
  return lines.join("\n");
}
