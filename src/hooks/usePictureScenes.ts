import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useDialect } from "@/contexts/DialectContext";
import { toast } from "sonner";

export interface PictureSceneHotspot {
  id: string;
  scene_id: string;
  word_arabic: string;
  word_english: string;
  root: string | null;
  word_audio_url: string | null;
  x_pct: number | null;
  y_pct: number | null;
  radius_pct: number;
  display_order: number;
}

export interface PictureScene {
  id: string;
  dialect: string;
  theme: string;
  title: string;
  title_arabic: string;
  description: string | null;
  image_url: string | null;
  cefr_level: string | null;
  display_order: number;
  status: "draft" | "published";
  session_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface SceneWithHotspots extends PictureScene {
  hotspots: PictureSceneHotspot[];
}

/* ─────────── Learner queries ─────────── */

export const usePublishedScenes = () => {
  const { activeDialect } = useDialect();
  return useQuery({
    queryKey: ["picture-scenes", "published", activeDialect],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("picture_scenes")
        .select("*")
        .eq("status", "published")
        .eq("dialect", activeDialect)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as PictureScene[];
    },
  });
};

export const useScene = (sceneId: string | undefined) =>
  useQuery({
    queryKey: ["picture-scene", sceneId],
    queryFn: async (): Promise<SceneWithHotspots | null> => {
      if (!sceneId) return null;
      const [sceneRes, hsRes] = await Promise.all([
        supabase.from("picture_scenes").select("*").eq("id", sceneId).single(),
        supabase
          .from("picture_scene_hotspots")
          .select("*")
          .eq("scene_id", sceneId)
          .order("display_order", { ascending: true }),
      ]);
      if (sceneRes.error) throw sceneRes.error;
      if (hsRes.error) throw hsRes.error;
      return {
        ...(sceneRes.data as PictureScene),
        hotspots: (hsRes.data ?? []) as PictureSceneHotspot[],
      };
    },
    enabled: !!sceneId,
  });

export const useSceneProgress = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["picture-scene-progress", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("user_picture_scene_progress")
        .select("scene_id, last_score, last_total, completed_at, last_played_at")
        .eq("user_id", user.id);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
};

export const useRecordSceneCompletion = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { sceneId: string; score: number; total: number }) => {
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("user_picture_scene_progress")
        .upsert(
          {
            user_id: user.id,
            scene_id: args.sceneId,
            last_score: args.score,
            last_total: args.total,
            completed_at: new Date().toISOString(),
            last_played_at: new Date().toISOString(),
          },
          { onConflict: "user_id,scene_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["picture-scene-progress"] });
    },
  });
};

/* ─────────── Admin mutations ─────────── */

export interface DraftSceneInput {
  dialect: string;
  theme: string;
  title: string;
  title_arabic: string;
  description?: string;
  cefr_level?: string;
  session_id?: string | null;
  words: Array<{ word_arabic: string; word_english: string; root?: string }>;
}

export const useCreateDraftScene = () => {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: DraftSceneInput) => {
      if (!user) throw new Error("Not signed in");
      const { data: scene, error } = await supabase
        .from("picture_scenes")
        .insert({
          dialect: input.dialect,
          theme: input.theme,
          title: input.title,
          title_arabic: input.title_arabic,
          description: input.description ?? null,
          cefr_level: input.cefr_level ?? null,
          session_id: input.session_id ?? null,
          status: "draft",
          created_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;

      const inserts = input.words.map((w, i) => ({
        scene_id: (scene as PictureScene).id,
        word_arabic: w.word_arabic,
        word_english: w.word_english,
        root: w.root ?? null,
        display_order: i,
        radius_pct: 8,
      }));
      const { error: hsErr } = await supabase
        .from("picture_scene_hotspots")
        .insert(inserts);
      if (hsErr) throw hsErr;

      return scene as PictureScene;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["picture-scenes"] });
    },
  });
};

export const useGenerateSceneImage = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { sceneId: string; customInstructions?: string; regenerateHotspots?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("regenerate-scene-image", {
        body: args,
      });
      if (error) throw error;
      return data as { imageUrl: string; relocated: boolean };
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ["picture-scene", args.sceneId] });
      qc.invalidateQueries({ queryKey: ["picture-scenes"] });
    },
    onError: (err: Error) => toast.error("Image generation failed", { description: err.message }),
  });
};

export const useGenerateSceneAudio = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { sceneId: string; force?: boolean }) => {
      const { data, error } = await supabase.functions.invoke("generate-scene-audio", {
        body: args,
      });
      if (error) throw error;
      return data as { generated: number; errors?: string[] };
    },
    onSuccess: (data, args) => {
      qc.invalidateQueries({ queryKey: ["picture-scene", args.sceneId] });
      toast.success(`Audio generated for ${data.generated} word${data.generated === 1 ? "" : "s"}`);
    },
    onError: (err: Error) => toast.error("Audio generation failed", { description: err.message }),
  });
};

export const useUpdateHotspot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; sceneId: string; patch: Partial<PictureSceneHotspot> }) => {
      const { error } = await supabase
        .from("picture_scene_hotspots")
        .update(args.patch)
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ["picture-scene", args.sceneId] });
    },
  });
};

export const useDeleteHotspot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; sceneId: string }) => {
      const { error } = await supabase
        .from("picture_scene_hotspots")
        .delete()
        .eq("id", args.id);
      if (error) throw error;
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ["picture-scene", args.sceneId] });
      toast.success("Hotspot deleted");
    },
    onError: (err: Error) => toast.error("Delete failed", { description: err.message }),
  });
};

export const useAddHotspot = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      sceneId: string;
      word_arabic: string;
      word_english: string;
      root?: string;
      display_order: number;
    }) => {
      const { data, error } = await supabase
        .from("picture_scene_hotspots")
        .insert({
          scene_id: args.sceneId,
          word_arabic: args.word_arabic,
          word_english: args.word_english,
          root: args.root ?? null,
          display_order: args.display_order,
          radius_pct: 8,
        })
        .select()
        .single();
      if (error) throw error;
      return data as PictureSceneHotspot;
    },
    onSuccess: (_d, args) => {
      qc.invalidateQueries({ queryKey: ["picture-scene", args.sceneId] });
      toast.success("Hotspot added — click image to place it");
    },
    onError: (err: Error) => toast.error("Add failed", { description: err.message }),
  });
};

export const usePublishScene = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (sceneId: string) => {
      const { error } = await supabase
        .from("picture_scenes")
        .update({ status: "published" })
        .eq("id", sceneId);
      if (error) throw error;
    },
    onSuccess: (_d, sceneId) => {
      qc.invalidateQueries({ queryKey: ["picture-scene", sceneId] });
      qc.invalidateQueries({ queryKey: ["picture-scenes"] });
      toast.success("Scene published");
    },
  });
};
