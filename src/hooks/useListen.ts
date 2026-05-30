import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useDialect } from "@/contexts/DialectContext";

export type ListenFormat = "podcast" | "ted" | "interview" | "story";
export type ListenLength = "short" | "medium" | "long";
export type ListenAudioMode = "full" | "on_demand";

export interface ListenScriptLine {
  speaker: string;
  speaker_role: string;
  arabic: string;
  english: string;
  transliteration?: string;
}

export interface ListenVocabItem {
  arabic: string;
  english: string;
  note?: string;
}

export interface ListenEpisode {
  id: string;
  creator_id: string;
  dialect: string;
  format: ListenFormat;
  topic: string;
  topic_category: string | null;
  length_bucket: ListenLength;
  title: string;
  summary: string | null;
  script: ListenScriptLine[];
  key_vocabulary: ListenVocabItem[];
  audio_mode: ListenAudioMode;
  full_audio_url: string | null;
  line_durations: number[] | null;
  duration_seconds: number | null;
  audio_status: "none" | "pending" | "ready" | "failed";
  play_count: number;
  created_at: string;
  updated_at: string;
}

export function useListenEpisodes(opts?: { format?: ListenFormat | "all"; mineOnly?: boolean }) {
  const { user } = useAuth();
  const { activeDialect } = useDialect();
  const format = opts?.format ?? "all";
  const mineOnly = opts?.mineOnly ?? false;

  return useQuery({
    queryKey: ["listen-episodes", activeDialect, format, mineOnly, user?.id],
    queryFn: async (): Promise<ListenEpisode[]> => {
      let q = supabase
        .from("listen_episodes" as never)
        .select("*")
        .eq("dialect", activeDialect)
        .order("created_at", { ascending: false })
        .limit(100) as any;
      if (format !== "all") q = q.eq("format", format);
      if (mineOnly && user) q = q.eq("creator_id", user.id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as ListenEpisode[];
    },
    staleTime: 30_000,
  });
}

export function useListenEpisode(id: string | undefined) {
  return useQuery({
    queryKey: ["listen-episode", id],
    enabled: !!id,
    queryFn: async (): Promise<ListenEpisode | null> => {
      const { data, error } = await supabase
        .from("listen_episodes" as never)
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return (data as ListenEpisode | null) ?? null;
    },
    refetchInterval: (q) => {
      const ep = q.state.data as ListenEpisode | null | undefined;
      return ep && ep.audio_mode === "full" && ep.audio_status === "pending" ? 4000 : false;
    },
  });
}

export function useGenerateListenEpisode() {
  const qc = useQueryClient();
  const { activeDialect } = useDialect();
  return useMutation({
    mutationFn: async (input: {
      format: ListenFormat;
      topic: string;
      topicCategory?: string | null;
      length: ListenLength;
      audioMode: ListenAudioMode;
    }): Promise<ListenEpisode> => {
      const { data, error } = await supabase.functions.invoke("generate-listen-script", {
        body: { ...input, dialect: activeDialect },
      });
      if (error) throw error;
      if (!data?.episode) throw new Error(data?.message || data?.error || "No episode returned");
      return data.episode as ListenEpisode;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["listen-episodes"] });
    },
  });
}

export function useGenerateListenLineAudio() {
  return useMutation({
    mutationFn: async (input: { episodeId: string; lineIndex: number }): Promise<string> => {
      const { data, error } = await supabase.functions.invoke("generate-listen-line-audio", {
        body: input,
      });
      if (error) throw error;
      if (!data?.audio_url) throw new Error(data?.error ?? "No audio");
      return data.audio_url as string;
    },
  });
}

export function useIncrementPlayCount() {
  return useMutation({
    mutationFn: async (episodeId: string) => {
      await supabase.rpc("increment_listen_play_count" as never, { _episode_id: episodeId } as never);
    },
  });
}

export function useDeleteListenEpisode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("listen_episodes" as never).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["listen-episodes"] }),
  });
}
