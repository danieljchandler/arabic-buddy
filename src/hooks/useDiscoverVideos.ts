import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export interface DiscoverVideo {
  id: string;
  title: string;
  title_arabic: string | null;
  source_url: string;
  platform: string;
  embed_url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  dialect: string;
  difficulty: string;
  transcript_lines: Json;
  vocabulary: Json;
  grammar_points: Json;
  cultural_context: string | null;
  published: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export function useDiscoverVideos(filters?: { dialect?: string; difficulty?: string; search?: string }) {
  return useQuery({
    queryKey: ["discover-videos", filters],
    queryFn: async () => {
      let query = supabase
        .from("discover_videos" as any)
        .select("*")
        .eq("published", true)
        .order("created_at", { ascending: false });

      if (filters?.dialect) {
        query = query.eq("dialect", filters.dialect);
      }
      if (filters?.difficulty) {
        query = query.eq("difficulty", filters.difficulty);
      }
      if (filters?.search) {
        query = query.ilike("title", `%${filters.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as DiscoverVideo[];
    },
  });
}

export function useDiscoverVideo(videoId: string | undefined) {
  return useQuery({
    queryKey: ["discover-video", videoId],
    queryFn: async () => {
      if (!videoId) return null;
      const { data, error } = await supabase
        .from("discover_videos" as any)
        .select("*")
        .eq("id", videoId)
        .single();
      if (error) throw error;
      return data as unknown as DiscoverVideo;
    },
    enabled: !!videoId,
  });
}

export function useAdminDiscoverVideos() {
  return useQuery({
    queryKey: ["admin-discover-videos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("discover_videos" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DiscoverVideo[];
    },
  });
}

export function useDeleteDiscoverVideo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("discover_videos" as any) as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-discover-videos"] }),
  });
}

export function useTogglePublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, published }: { id: string; published: boolean }) => {
      const { error } = await (supabase.from("discover_videos" as any) as any)
        .update({ published })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-discover-videos"] }),
  });
}
