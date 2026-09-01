import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { GULF_DIALECTS } from "@/hooks/useShadowQueue";
import {
  collectCompoundCandidates,
  filterNewCandidates,
  type CompoundCandidate,
} from "@/lib/transcriptChunks";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { TranscriptLine } from "@/types/transcript";

/**
 * /admin/chunks — the chunk-candidate promotion queue.
 *
 * Native reviewers mark multi-word units in transcripts (the compound marks
 * in the video workspace), and those marks are the only dialect-native
 * formulaic-sequence inventory in existence — no published chunk list covers
 * any spoken Arabic dialect. This page surfaces every marked compound the
 * set-phrase deck doesn't hold yet, ranked by how often reviewers marked it,
 * and promotes one to a set_phrases DRAFT in a click. The draft then goes
 * through the ordinary editorial pass on /admin/set-phrases (gloss, reply,
 * occasion, publish) — promotion is sourcing, not publishing.
 */

interface VideoRow {
  id: string;
  title: string | null;
  dialect: string;
  transcript_lines: TranscriptLine[] | null;
}

const AdminChunkCandidates = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const queryClient = useQueryClient();
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promoted, setPromoted] = useState<Set<string>>(new Set());

  const wantedDialects = activeDialect === "Gulf" ? [...GULF_DIALECTS] : [activeDialect];

  const videosQuery = useQuery({
    queryKey: ["admin-chunk-videos", activeDialect],
    queryFn: async (): Promise<VideoRow[]> => {
      const { data, error } = await supabase
        .from("discover_videos")
        .select("id, title, dialect, transcript_lines")
        .eq("published", true)
        .in("dialect", wantedDialects)
        .limit(200);
      if (error) throw error;
      return (data ?? []) as VideoRow[];
    },
  });

  const phrasesQuery = useQuery({
    queryKey: ["admin-chunk-existing", activeDialect],
    queryFn: async (): Promise<string[]> => {
      // Every status counts as existing: a draft someone already promoted is
      // done being sourced.
      const { data, error } = await supabase
        .from("set_phrases")
        .select("phrase_arabic")
        .eq("dialect", activeDialect);
      if (error) throw error;
      return ((data ?? []) as Array<{ phrase_arabic: string | null }>).map(
        (r) => r.phrase_arabic ?? "",
      );
    },
  });

  const candidates = useMemo(() => {
    if (!videosQuery.data || !phrasesQuery.data) return null;
    const all = collectCompoundCandidates(
      videosQuery.data.map((v) => ({
        id: v.id,
        title: v.title ?? "Untitled clip",
        lines: v.transcript_lines ?? [],
      })),
    );
    return filterNewCandidates(all, phrasesQuery.data);
  }, [videosQuery.data, phrasesQuery.data]);

  const promote = async (candidate: CompoundCandidate) => {
    setPromoting(candidate.arabic);
    const { error } = await supabase.from("set_phrases").insert({
      dialect: activeDialect,
      phrase_arabic: candidate.arabic,
      phrase_english: candidate.gloss,
      // The first example line's translation is honest scenario raw material;
      // the editorial pass rewrites it.
      scenario_english: candidate.contexts[0]?.lineTranslation ?? null,
      status: "draft",
      tags: ["transcript"],
      created_by: user?.id ?? null,
    });
    setPromoting(null);
    if (error) {
      toast.error(`Couldn't promote: ${error.message}`);
      return;
    }
    setPromoted((prev) => new Set(prev).add(candidate.arabic));
    toast.success("Added as a draft set phrase.");
    void queryClient.invalidateQueries({ queryKey: ["admin-phrases"] });
  };

  const loading = videosQuery.isLoading || phrasesQuery.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate("/admin/set-phrases")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-xl font-bold">Chunk candidates</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Multi-word phrases native reviewers marked in {activeDialect} transcripts, not yet in
            the set-phrase deck. Promoting creates a draft for the editorial pass.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !candidates || candidates.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Nothing to promote — every compound marked in the reviewed {activeDialect} transcripts is
          already in the deck. New candidates appear as reviewers mark phrases in the video
          workspace.
        </Card>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate) => (
            <Card key={candidate.arabic} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p dir="rtl" className="font-arabic text-xl font-semibold">
                    {candidate.arabic}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {candidate.gloss ?? "no gloss recorded — add one in the editorial pass"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    marked {candidate.count}×
                  </Badge>
                  {promoted.has(candidate.arabic) ? (
                    <Badge className="gap-1 text-xs">
                      <Check className="h-3 w-3" /> drafted
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => void promote(candidate)}
                      disabled={promoting !== null}
                    >
                      {promoting === candidate.arabic ? (
                        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="mr-1 h-3.5 w-3.5" />
                      )}
                      Promote
                    </Button>
                  )}
                </div>
              </div>
              {candidate.contexts.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-border/60 pt-2">
                  {candidate.contexts.map((context, i) => (
                    <p key={i} className="text-xs text-muted-foreground">
                      <span dir="rtl" className="font-arabic">{context.lineArabic}</span>
                      {context.lineTranslation ? ` — ${context.lineTranslation}` : ""}
                      <span className="text-muted-foreground/60"> · {context.videoTitle}</span>
                    </p>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminChunkCandidates;
