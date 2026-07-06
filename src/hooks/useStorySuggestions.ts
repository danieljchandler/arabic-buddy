import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StorySuggestion {
  title: string;
  title_arabic: string;
  description: string;
  description_arabic: string;
  source_type: string;
  estimated_length: string;
  themes: string[];
}

export function useStorySuggestions() {
  return useMutation({
    mutationFn: async (opts?: { dialect?: string; difficulty?: string }): Promise<StorySuggestion[]> => {
      const { data, error } = await supabase.functions.invoke("suggest-stories", {
        body: {
          dialect: opts?.dialect || "Gulf",
          difficulty: opts?.difficulty || "intermediate",
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.suggestions || !Array.isArray(data.suggestions)) {
        throw new Error("No suggestions returned");
      }
      return data.suggestions as StorySuggestion[];
    },
  });
}
