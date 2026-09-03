import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Loader2, Target } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageCorner } from "@/components/shell/PageCorner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { useUserLevel } from "@/hooks/useUserLevel";
import { buildCTest, scoreCTest, type CTest as CTestModel } from "@/lib/cTest";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/utils";

/**
 * C-test — a level-controlled passage with the second half of every second
 * word deleted; the learner restores them.
 *
 * The second outcome instrument from the Duolingo efficacy battery
 * (docs/language-learning-research-2026-09.md §6). It needs no new
 * generation: the passage comes from reading-passage, already pitched at the
 * learner's level and gated for dialect, and the deletions and scoring are
 * pure (src/lib/cTest.ts). The result is a percentage, not a level, stored
 * beside the placements so the analytics page can show both moving.
 */

interface PassageLine { arabic?: string }

function linesFrom(raw: unknown): string[] {
  const data = raw as { lines?: PassageLine[]; passage?: string } | null;
  if (Array.isArray(data?.lines) && data.lines.length > 0) {
    return data.lines.map((l) => (typeof l?.arabic === "string" ? l.arabic : "")).filter(Boolean);
  }
  if (typeof data?.passage === "string" && data.passage.trim()) {
    return data.passage.split(/(?<=[.!؟،])\s+/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

const CTestPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const { difficulty } = useUserLevel();
  const [test, setTest] = useState<CTestModel | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReturnType<typeof scoreCTest> | null>(null);
  const [saving, setSaving] = useState(false);
  const requested = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: e } = await supabase.functions.invoke("reading-passage", {
        body: { difficulty, dialect: activeDialect },
      });
      if (e) throw e;
      const lines = linesFrom(data);
      const built = buildCTest(lines);
      if (built.items.length === 0) throw new Error("The passage was too short to make a test from.");
      setTest(built);
      setAnswers(built.items.map(() => ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load a passage");
    } finally {
      setLoading(false);
    }
  }, [difficulty, activeDialect]);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void load();
  }, [load]);

  const gapByIndex = useMemo(() => new Map((test?.items ?? []).map((item, i) => [item.index, i])), [test]);

  const submit = async () => {
    if (!test) return;
    const score = scoreCTest(test, answers);
    setResult(score);
    track("c_test_completed", { difficulty, dialect: activeDialect, percent: score.percent, total: score.total });
    if (!user) return;
    setSaving(true);
    try {
      const { count } = await supabase
        .from("review_log")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .not("rating", "is", null);
      const { error: e } = await supabase.from("placement_results").insert({
        user_id: user.id,
        dialect: activeDialect,
        instrument: "c_test",
        cefr_level: null,
        score: score.percent,
        detail: { difficulty, total: score.total, correct: score.correct },
        reviews_at_time: count ?? null,
      });
      if (e) console.warn("c_test insert failed:", e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <PageCorner />
      <div className="space-y-4 pb-10">
        <header className="flex items-center justify-between pt-2">
          <Link to="/analytics" className="text-xs text-muted-foreground">← Progress</Link>
          <span className="text-xs text-muted-foreground capitalize">{difficulty} · {activeDialect}</span>
        </header>
        <h1 className="flex items-center gap-2 text-[28px] font-bold leading-tight">
          <Target className="h-6 w-6 text-primary" aria-hidden />
          C-test
        </h1>
        <p className="text-sm text-muted-foreground">
          Half of every second word is missing. Type the missing half of each. The first sentence is
          whole, to give you the thread.
        </p>

        {loading && (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" /> Writing a passage at your level…
          </div>
        )}
        {error && (
          <div className="space-y-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4" role="alert">
            <p className="text-sm">{error}</p>
            <Button size="sm" variant="outline" onClick={() => { requested.current = true; void load(); }}>Try again</Button>
          </div>
        )}

        {test && !loading && (
          <div className="space-y-4">
            <p dir="rtl" lang="ar" className="font-arabic text-2xl leading-[2.4] text-right">
              {test.words.map((word, index) => {
                const gap = gapByIndex.get(index);
                if (gap === undefined) return <span key={index}>{word} </span>;
                const item = test.items[gap];
                const state = result ? (result.results[gap] ? "right" : "wrong") : "open";
                return (
                  <span key={index} className="inline-flex items-baseline gap-0.5 whitespace-nowrap">
                    <span>{item.stem}</span>
                    {result ? (
                      <span className={cn("rounded px-1", state === "right" ? "bg-emerald-500/15 text-emerald-700" : "bg-rose-500/15 text-rose-700")}>
                        {item.answer}
                      </span>
                    ) : (
                      <input
                        aria-label={`Complete word ${gap + 1}`}
                        dir="rtl"
                        lang="ar"
                        value={answers[gap]}
                        onChange={(e) => setAnswers((prev) => prev.map((a, i) => (i === gap ? e.target.value : a)))}
                        className="w-16 rounded border border-border bg-background px-1 text-center font-arabic text-xl focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                    )}
                    <span> </span>
                  </span>
                );
              })}
            </p>

            {!result ? (
              <Button className="w-full" onClick={submit} disabled={saving}>Check my answers</Button>
            ) : (
              <div className="space-y-3 rounded-2xl border border-border bg-card p-4" role="status">
                <p className="text-2xl font-bold">{result.correct} of {result.total} · {result.percent}%</p>
                <p className="text-sm text-muted-foreground">
                  {user
                    ? "Saved beside your placements. Take another after a stretch of practice and compare."
                    : "Sign in to keep this beside your placements."}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => navigate("/analytics")}>Progress</Button>
                  <Button onClick={() => { requested.current = true; void load(); }}>Another passage</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
};

export default CTestPage;
