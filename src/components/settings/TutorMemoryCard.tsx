import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * What the AI tutor remembers about this learner, and the way to erase it.
 *
 * The notes are written by the assistant after conversations — that the same
 * construction keeps confusing them, which kind of explanation lands — and
 * they are carried into every later session. A record of someone's own
 * confusions, kept about them, should be readable by them and deletable
 * without asking anyone.
 *
 * Read and delete only. Nothing here writes: a learner-supplied "here is what
 * you remember about me" would be a prompt-injection surface with a database
 * behind it, which is why the table has no INSERT or UPDATE policy either.
 */

interface MemoryRow {
  summary: string;
  open_questions: string[];
  updated_at: string;
}

export function TutorMemoryCard() {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const queryClient = useQueryClient();
  const queryKey = ["tutor-memory", user?.id, activeDialect];

  const { data, isLoading } = useQuery({
    queryKey,
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learner_ai_memory")
        .select("summary, open_questions, updated_at")
        .eq("user_id", user!.id)
        .eq("dialect", activeDialect)
        .maybeSingle();
      if (error) throw error;
      return (data as MemoryRow | null) ?? null;
    },
  });

  const forget = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("learner_ai_memory")
        .delete()
        .eq("user_id", user!.id)
        .eq("dialect", activeDialect);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.setQueryData(queryKey, null);
      toast.success("The tutor has forgotten what it knew about your learning.");
    },
    onError: () => toast.error("Couldn't clear the tutor's notes — try again in a moment."),
  });

  const questions = Array.isArray(data?.open_questions) ? data!.open_questions : [];

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <p className="text-sm font-medium text-foreground">What the AI tutor remembers</p>
      </div>

      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      ) : data?.summary ? (
        <>
          <p className="whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
            {data.summary}
          </p>
          {questions.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Still open:</span> {questions.join("; ")}
            </p>
          )}
          <p className="text-[10px] text-muted-foreground/70">
            Notes for {activeDialect}, last updated {data.updated_at.slice(0, 10)}. Written by the
            tutor after your conversations, and used to pitch its explanations.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => forget.mutate()}
            disabled={forget.isPending}
          >
            {forget.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Clear the tutor's notes
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Nothing yet. After a few conversations with Ask AI, the tutor keeps short notes on how you
          learn — what keeps tripping you up, which explanations land — so it doesn't start from
          scratch each time. You can read and clear them here.
        </p>
      )}
    </div>
  );
}
