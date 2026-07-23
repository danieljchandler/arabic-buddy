import { useState, useRef, useEffect, type ReactNode } from "react";
import { Sparkles, Send, Loader2, MessageCircleQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDialect } from "@/contexts/DialectContext";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-translation`;

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface AskAISentenceProps {
  arabic: string;
  english?: string;
  /** Visual variant for the trigger button */
  variant?: "icon" | "chip";
  className?: string;
}

const SUGGESTED = [
  "Why is it translated like this?",
  "Explain the grammar",
  "Tell me more",
  "Give me alternatives",
];

/**
 * Tiny markdown renderer for AI replies.
 * Handles: paragraphs, line breaks, **bold**, *italic*, `code`, and simple - / * bullet lists.
 * Skipping react-markdown saves ~35 kB gz on this chunk.
 */
function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const tok = match[0];
    if (tok.startsWith("**")) nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`")) nodes.push(<code key={key++} className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{tok.slice(1, -1)}</code>);
    else nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    last = regex.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function TinyMarkdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="list-disc pl-5 my-1 space-y-0.5">
          {items.map((it, idx) => <li key={idx}>{renderInline(it)}</li>)}
        </ul>
      );
      continue;
    }
    if (line.trim() === "") { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^\s*[-*]\s+/.test(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1">
        {para.map((l, idx) => (
          <span key={idx}>
            {renderInline(l)}
            {idx < para.length - 1 && <br />}
          </span>
        ))}
      </p>
    );
  }
  return <>{blocks}</>;
}

export const AskAISentence = ({
  arabic,
  english,
  variant = "icon",
  className,
}: AskAISentenceProps) => {
  const { activeDialect } = useDialect();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Msg = { role: "user", content: trimmed };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          arabic,
          english,
          dialect: activeDialect,
          messages: nextMessages,
        }),
      });

      if (!resp.ok || !resp.body) {
        if (resp.status === 429) toast.error("Too many requests — wait a moment");
        else if (resp.status === 402) toast.error("AI credits exhausted");
        else toast.error("Couldn't reach the tutor");
        setMessages(nextMessages); // keep user message
        setLoading(false);
        return;
      }

      // Append empty assistant placeholder
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let done = false;

      while (!done) {
        const { value, done: rDone } = await reader.read();
        if (rDone) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") { done = true; break; }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (delta) {
              assistantText += delta;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: assistantText };
                return copy;
              });
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }
    } catch (err) {
      console.error(err);
      toast.error("Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const trigger =
    variant === "chip" ? (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn(
          "h-7 gap-1 rounded-full border-primary/40 bg-primary/5 px-2.5 text-xs font-medium text-primary hover:bg-primary/10 hover:text-primary",
          className,
        )}
      >
        <Sparkles className="h-3 w-3" />
        Ask AI
      </Button>
    ) : (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Ask AI about this sentence"
        className={cn("h-7 w-7 text-muted-foreground hover:text-primary", className)}
      >
        <MessageCircleQuestion className="h-4 w-4" />
      </Button>
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-4 pt-4 pb-2 border-b">
          <DialogTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Ask about this sentence
          </DialogTitle>
          <DialogDescription className="sr-only">
            Ask the AI tutor about this Arabic sentence — its translation, grammar,
            vocabulary, or cultural context.
          </DialogDescription>
          <div className="mt-2 rounded-lg bg-muted/40 p-2 text-right">
            <p className="font-arabic text-base text-foreground" dir="rtl">
              {arabic}
            </p>
            {english && (
              <p className="text-xs text-muted-foreground mt-1 text-left">{english}</p>
            )}
          </div>
        </DialogHeader>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-[180px]">
          {messages.length === 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Ask anything — translation choices, grammar, vocabulary, culture…
              </p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-xs rounded-full border border-border bg-background px-2.5 py-1 hover:bg-primary/10 hover:border-primary/40 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "rounded-lg px-3 py-2 text-sm",
                m.role === "user"
                  ? "bg-primary/10 ml-6"
                  : "bg-muted/50 mr-6 prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1",
              )}
            >
              {m.role === "assistant" ? (
                m.content ? (
                  <TinyMarkdown source={m.content} />
                ) : (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                )
              ) : (
                <p>{m.content}</p>
              )}
            </div>
          ))}
        </div>

        <div className="border-t p-3 flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder="Ask a question…"
            rows={1}
            className="resize-none min-h-[40px] text-sm"
            disabled={loading}
          />
          <Button
            size="icon"
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
