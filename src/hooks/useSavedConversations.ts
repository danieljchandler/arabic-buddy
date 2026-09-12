import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import type { AssistantMsg, AssistantSeed } from "@/contexts/AiAssistantContext";

/**
 * Ask AI conversation history — every chat the learner has had, newest first,
 * over `saved_chat_conversations` (owner-only via RLS).
 *
 * This started as an opt-in "keep this one" bookmark, which is why the table is
 * named the way it is. It is now the history: `ChatTab` writes each completed
 * turn as it lands, so a conversation survives being closed, navigated away
 * from, or reloaded, and can be picked back up from the panel's History list or
 * from /saved-chats. Saving per turn rather than on a timer is deliberate — a
 * conversation ends when the learner leaves the page it was about, and a
 * debounce would lose the last answer to exactly that navigation.
 *
 * `useSaveConversation` is an upsert: pass the row id to update an ongoing
 * conversation, omit it to start one. Rename and delete are the learner's own
 * housekeeping.
 */

export interface SavedConversation {
  id: string;
  user_id: string;
  dialect: string;
  title: string;
  seed: AssistantSeed | null;
  page_context: { route?: string; title?: string } | null;
  messages: AssistantMsg[];
  created_at: string;
  updated_at: string;
}

const KEY = "saved-chat-conversations";

export const useSavedConversations = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: [KEY, user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("saved_chat_conversations")
        .select("*")
        .eq("user_id", user.id)
        // By last activity, not by when it started: a conversation picked
        // back up is updated in place, and ordering on `created_at` left it
        // buried at its original position while both views showed its fresh
        // timestamp.
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as SavedConversation[];
    },
    enabled: !!user,
  });
};

export const useSaveConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (args: {
      /** Present when re-saving an already-saved conversation. */
      id?: string | null;
      dialect: string;
      seed: AssistantSeed | null;
      pageContext: { route?: string; title?: string } | null;
      messages: AssistantMsg[];
    }) => {
      if (!user) throw new Error("Must be logged in");

      const firstUserMsg = args.messages.find((m) => m.role === "user")?.content ?? "Conversation";
      const title = firstUserMsg.length > 80 ? `${firstUserMsg.slice(0, 80)}…` : firstUserMsg;

      if (args.id) {
        const { data, error } = await supabase
          .from("saved_chat_conversations")
          .update({
            messages: args.messages as never,
            updated_at: new Date().toISOString(),
          })
          .eq("id", args.id)
          .eq("user_id", user.id)
          .select()
          .single();
        if (error) throw error;
        return data as unknown as SavedConversation;
      }

      const { data, error } = await supabase
        .from("saved_chat_conversations")
        .insert({
          user_id: user.id,
          dialect: args.dialect,
          title,
          seed: (args.seed ?? null) as never,
          page_context: (args.pageContext ?? null) as never,
          messages: args.messages as never,
        })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as SavedConversation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
    },
  });
};

export const useRenameConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      if (!user) throw new Error("Must be logged in");
      const { error } = await supabase
        .from("saved_chat_conversations")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
    },
  });
};

export const useDeleteConversation = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user) throw new Error("Must be logged in");
      const { error } = await supabase
        .from("saved_chat_conversations")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
    },
  });
};
