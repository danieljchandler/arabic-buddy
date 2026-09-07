import { useState } from "react";
import { BookOpen, ChevronDown, Landmark, MessagesSquare } from "lucide-react";
import type { LessonArabicLine, LessonCultureNote, LessonDialogueLine, LessonGrammarNote } from "@/hooks/useTopic";
import { cn } from "@/lib/utils";

/**
 * The curriculum-track sections of a lesson: one grammar pattern explained
 * through dialect examples, the cultural custom with the phrases that go with
 * it, and the lesson's words in a short dialogue.
 *
 * Every section renders nothing when empty — lessons authored in the admin UI
 * or imported from a spreadsheet carry none of these, and an empty card would
 * only tell the learner something is missing.
 */

const ArabicLine = ({ line }: { line: LessonArabicLine }) => (
  <div className="rounded-lg bg-muted/50 px-3 py-2">
    <p className="font-arabic text-lg leading-relaxed text-foreground" dir="rtl">
      {line.arabic}
    </p>
    {(line.transliteration || line.english) && (
      <p className="text-xs text-muted-foreground leading-relaxed">
        {line.transliteration && <span className="italic">{line.transliteration}</span>}
        {line.transliteration && line.english && " — "}
        {line.english}
      </p>
    )}
  </div>
);

interface SectionProps {
  title: string;
  icon: typeof BookOpen;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const Section = ({ title, icon: Icon, defaultOpen = false, children }: SectionProps) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </span>
        <ChevronDown
          className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0", open && "rotate-180")}
        />
      </button>
      {open && <div className="px-4 pb-4 space-y-4">{children}</div>}
    </div>
  );
};

export const GrammarNotes = ({ notes }: { notes: LessonGrammarNote[] }) => {
  const usable = notes.filter((n) => n.title);
  if (usable.length === 0) return null;
  return (
    <Section title="The pattern" icon={BookOpen} defaultOpen>
      {usable.map((note, i) => (
        <div key={`${note.title}-${i}`} className="space-y-2">
          <p className="text-sm font-semibold text-foreground">{note.title}</p>
          {note.explanation && (
            <p className="text-xs text-muted-foreground leading-relaxed">{note.explanation}</p>
          )}
          <div className="space-y-1.5">
            {note.examples.map((ex, j) => (
              <ArabicLine key={`${ex.arabic}-${j}`} line={ex} />
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
};

export const CultureNotes = ({ notes }: { notes: LessonCultureNote[] }) => {
  const usable = notes.filter((n) => n.title);
  if (usable.length === 0) return null;
  return (
    <Section title="How it's done" icon={Landmark}>
      {usable.map((note, i) => (
        <div key={`${note.title}-${i}`} className="space-y-2">
          <p className="text-sm font-semibold text-foreground">{note.title}</p>
          {note.note && <p className="text-xs text-muted-foreground leading-relaxed">{note.note}</p>}
          {note.phrases.length > 0 && (
            <div className="space-y-1.5">
              {note.phrases.map((ph, j) => (
                <ArabicLine key={`${ph.arabic}-${j}`} line={ph} />
              ))}
            </div>
          )}
        </div>
      ))}
    </Section>
  );
};

export const LessonDialogue = ({ lines }: { lines: LessonDialogueLine[] }) => {
  const usable = lines.filter((l) => l.arabic);
  if (usable.length === 0) return null;
  return (
    <Section title="Hear it in a conversation" icon={MessagesSquare}>
      <ol className="space-y-2">
        {usable.map((line, i) => (
          <li key={`${line.arabic}-${i}`} className="flex gap-2.5">
            <span className="shrink-0 mt-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground w-14 truncate">
              {line.speaker ?? `${i % 2 === 0 ? "A" : "B"}`}
            </span>
            <div className="flex-1 min-w-0">
              <ArabicLine line={line} />
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
};
