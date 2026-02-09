export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      saved_transcriptions: {
        Row: {
          audio_url: string | null
          created_at: string
          cultural_context: string | null
          grammar_points: Json
          id: string
          lines: Json
          raw_transcript_arabic: string
          title: string
          updated_at: string
          user_id: string
          vocabulary: Json
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          cultural_context?: string | null
          grammar_points?: Json
          id?: string
          lines?: Json
          raw_transcript_arabic: string
          title: string
          updated_at?: string
          user_id: string
          vocabulary?: Json
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          cultural_context?: string | null
          grammar_points?: Json
          id?: string
          lines?: Json
          raw_transcript_arabic?: string
          title?: string
          updated_at?: string
          user_id?: string
          vocabulary?: Json
        }
        Relationships: []
      }
      topics: {
        Row: {
          created_at: string
          display_order: number
          gradient: string
          icon: string
          id: string
          name: string
          name_arabic: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          gradient?: string
          icon?: string
          id?: string
          name: string
          name_arabic: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_order?: number
          gradient?: string
          icon?: string
          id?: string
          name?: string
          name_arabic?: string
          updated_at?: string
        }
        Relationships: []
      }
      tutor_upload_candidates: {
        Row: {
          classification: string | null
          confidence: number | null
          created_at: string
          id: string
          image_url: string | null
          sentence_audio_url: string | null
          sentence_end_ms: number | null
          sentence_english: string | null
          sentence_start_ms: number | null
          sentence_text: string | null
          source_audio_url: string | null
          status: string
          upload_id: string
          user_id: string
          word_audio_url: string | null
          word_end_ms: number | null
          word_english: string | null
          word_standard: string | null
          word_start_ms: number | null
          word_text: string
        }
        Insert: {
          classification?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          sentence_audio_url?: string | null
          sentence_end_ms?: number | null
          sentence_english?: string | null
          sentence_start_ms?: number | null
          sentence_text?: string | null
          source_audio_url?: string | null
          status?: string
          upload_id: string
          user_id: string
          word_audio_url?: string | null
          word_end_ms?: number | null
          word_english?: string | null
          word_standard?: string | null
          word_start_ms?: number | null
          word_text: string
        }
        Update: {
          classification?: string | null
          confidence?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          sentence_audio_url?: string | null
          sentence_end_ms?: number | null
          sentence_english?: string | null
          sentence_start_ms?: number | null
          sentence_text?: string | null
          source_audio_url?: string | null
          status?: string
          upload_id?: string
          user_id?: string
          word_audio_url?: string | null
          word_end_ms?: number | null
          word_english?: string | null
          word_standard?: string | null
          word_start_ms?: number | null
          word_text?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_vocabulary: {
        Row: {
          created_at: string
          ease_factor: number
          id: string
          interval_days: number
          last_reviewed_at: string | null
          next_review_at: string
          repetitions: number
          root: string | null
          sentence_audio_url: string | null
          source: string | null
          source_upload_id: string | null
          updated_at: string
          user_id: string
          word_arabic: string
          word_audio_url: string | null
          word_english: string
        }
        Insert: {
          created_at?: string
          ease_factor?: number
          id?: string
          interval_days?: number
          last_reviewed_at?: string | null
          next_review_at?: string
          repetitions?: number
          root?: string | null
          sentence_audio_url?: string | null
          source?: string | null
          source_upload_id?: string | null
          updated_at?: string
          user_id: string
          word_arabic: string
          word_audio_url?: string | null
          word_english: string
        }
        Update: {
          created_at?: string
          ease_factor?: number
          id?: string
          interval_days?: number
          last_reviewed_at?: string | null
          next_review_at?: string
          repetitions?: number
          root?: string | null
          sentence_audio_url?: string | null
          source?: string | null
          source_upload_id?: string | null
          updated_at?: string
          user_id?: string
          word_arabic?: string
          word_audio_url?: string | null
          word_english?: string
        }
        Relationships: []
      }
      vocabulary_words: {
        Row: {
          audio_url: string | null
          created_at: string
          display_order: number
          id: string
          image_position: string | null
          image_url: string | null
          topic_id: string
          updated_at: string
          word_arabic: string
          word_english: string
        }
        Insert: {
          audio_url?: string | null
          created_at?: string
          display_order?: number
          id?: string
          image_position?: string | null
          image_url?: string | null
          topic_id: string
          updated_at?: string
          word_arabic: string
          word_english: string
        }
        Update: {
          audio_url?: string | null
          created_at?: string
          display_order?: number
          id?: string
          image_position?: string | null
          image_url?: string | null
          topic_id?: string
          updated_at?: string
          word_arabic?: string
          word_english?: string
        }
        Relationships: [
          {
            foreignKeyName: "vocabulary_words_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "topics"
            referencedColumns: ["id"]
          },
        ]
      }
      word_reviews: {
        Row: {
          created_at: string
          ease_factor: number
          id: string
          interval_days: number
          last_reviewed_at: string | null
          next_review_at: string
          repetitions: number
          updated_at: string
          user_id: string
          word_id: string
        }
        Insert: {
          created_at?: string
          ease_factor?: number
          id?: string
          interval_days?: number
          last_reviewed_at?: string | null
          next_review_at?: string
          repetitions?: number
          updated_at?: string
          user_id: string
          word_id: string
        }
        Update: {
          created_at?: string
          ease_factor?: number
          id?: string
          interval_days?: number
          last_reviewed_at?: string | null
          next_review_at?: string
          repetitions?: number
          updated_at?: string
          user_id?: string
          word_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "word_reviews_word_id_fkey"
            columns: ["word_id"]
            isOneToOne: false
            referencedRelation: "vocabulary_words"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: never; Returns: boolean }
      is_recorder: { Args: never; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user" | "recorder"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user", "recorder"],
    },
  },
} as const
