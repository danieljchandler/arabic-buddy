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
      achievements: {
        Row: {
          created_at: string
          description: string
          display_order: number
          icon: string
          id: string
          name: string
          name_arabic: string
          requirement_type: string
          requirement_value: number | null
          xp_reward: number
        }
        Insert: {
          created_at?: string
          description: string
          display_order?: number
          icon?: string
          id?: string
          name: string
          name_arabic: string
          requirement_type?: string
          requirement_value?: number | null
          xp_reward?: number
        }
        Update: {
          created_at?: string
          description?: string
          display_order?: number
          icon?: string
          id?: string
          name?: string
          name_arabic?: string
          requirement_type?: string
          requirement_value?: number | null
          xp_reward?: number
        }
        Relationships: []
      }
      challenges: {
        Row: {
          challenge_type: string
          challenged_id: string
          challenged_progress: number
          challenger_id: string
          challenger_progress: number
          completed_at: string | null
          created_at: string
          duration_days: number
          expires_at: string
          id: string
          status: string
          target_xp: number
          winner_id: string | null
        }
        Insert: {
          challenge_type?: string
          challenged_id: string
          challenged_progress?: number
          challenger_id: string
          challenger_progress?: number
          completed_at?: string | null
          created_at?: string
          duration_days?: number
          expires_at?: string
          id?: string
          status?: string
          target_xp?: number
          winner_id?: string | null
        }
        Update: {
          challenge_type?: string
          challenged_id?: string
          challenged_progress?: number
          challenger_id?: string
          challenger_progress?: number
          completed_at?: string | null
          created_at?: string
          duration_days?: number
          expires_at?: string
          id?: string
          status?: string
          target_xp?: number
          winner_id?: string | null
        }
        Relationships: []
      }
      content_import_logs: {
        Row: {
          created_at: string
          id: string
          platform: string
          url: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          platform?: string
          url: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          platform?: string
          url?: string
          user_id?: string | null
        }
        Relationships: []
      }
      content_requests: {
        Row: {
          body: string
          created_at: string
          id: string
          request_type: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          request_type?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          request_type?: string
          user_id?: string
        }
        Relationships: []
      }
      conversation_scenarios: {
        Row: {
          created_at: string
          created_by: string
          description: string
          dialect: string
          difficulty: string
          example_exchanges: Json
          icon_name: string
          id: string
          session_id: string | null
          status: string
          system_prompt: string
          title: string
          title_arabic: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          description?: string
          dialect?: string
          difficulty?: string
          example_exchanges?: Json
          icon_name?: string
          id?: string
          session_id?: string | null
          status?: string
          system_prompt?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          description?: string
          dialect?: string
          difficulty?: string
          example_exchanges?: Json
          icon_name?: string
          id?: string
          session_id?: string | null
          status?: string
          system_prompt?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Relationships: []
      }
      daily_challenge_completions: {
        Row: {
          challenge_date: string
          challenge_type: string
          completed_at: string
          id: string
          max_score: number
          score: number
          user_id: string
          xp_earned: number
        }
        Insert: {
          challenge_date?: string
          challenge_type?: string
          completed_at?: string
          id?: string
          max_score?: number
          score?: number
          user_id: string
          xp_earned?: number
        }
        Update: {
          challenge_date?: string
          challenge_type?: string
          completed_at?: string
          id?: string
          max_score?: number
          score?: number
          user_id?: string
          xp_earned?: number
        }
        Relationships: []
      }
      daily_challenges: {
        Row: {
          challenge_date: string | null
          challenge_type: string
          created_at: string
          created_by: string
          dialect: string
          difficulty: string
          id: string
          questions: Json
          session_id: string | null
          status: string
          title: string
          title_arabic: string
          updated_at: string
        }
        Insert: {
          challenge_date?: string | null
          challenge_type?: string
          created_at?: string
          created_by: string
          dialect?: string
          difficulty?: string
          id?: string
          questions?: Json
          session_id?: string | null
          status?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Update: {
          challenge_date?: string | null
          challenge_type?: string
          created_at?: string
          created_by?: string
          dialect?: string
          difficulty?: string
          id?: string
          questions?: Json
          session_id?: string | null
          status?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Relationships: []
      }
      discover_videos: {
        Row: {
          created_at: string
          created_by: string
          cultural_context: string | null
          dialect: string
          difficulty: string
          duration_seconds: number | null
          embed_url: string
          grammar_points: Json
          id: string
          platform: string
          published: boolean
          source_url: string
          thumbnail_url: string | null
          title: string
          title_arabic: string | null
          transcript_lines: Json
          transcription_error: string | null
          transcription_status: string
          trending_candidate_id: string | null
          updated_at: string
          vocabulary: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          cultural_context?: string | null
          dialect?: string
          difficulty?: string
          duration_seconds?: number | null
          embed_url: string
          grammar_points?: Json
          id?: string
          platform?: string
          published?: boolean
          source_url: string
          thumbnail_url?: string | null
          title: string
          title_arabic?: string | null
          transcript_lines?: Json
          transcription_error?: string | null
          transcription_status?: string
          trending_candidate_id?: string | null
          updated_at?: string
          vocabulary?: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          cultural_context?: string | null
          dialect?: string
          difficulty?: string
          duration_seconds?: number | null
          embed_url?: string
          grammar_points?: Json
          id?: string
          platform?: string
          published?: boolean
          source_url?: string
          thumbnail_url?: string | null
          title?: string
          title_arabic?: string | null
          transcript_lines?: Json
          transcription_error?: string | null
          transcription_status?: string
          trending_candidate_id?: string | null
          updated_at?: string
          vocabulary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "discover_videos_trending_candidate_id_fkey"
            columns: ["trending_candidate_id"]
            isOneToOne: false
            referencedRelation: "trending_video_candidates"
            referencedColumns: ["id"]
          },
        ]
      }
      grammar_exercises: {
        Row: {
          category: string
          choices: Json
          correct_index: number
          created_at: string
          created_by: string
          dialect: string
          difficulty: string
          explanation: string
          grammar_point: string
          id: string
          question_arabic: string
          question_english: string
          session_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          category?: string
          choices?: Json
          correct_index?: number
          created_at?: string
          created_by: string
          dialect?: string
          difficulty?: string
          explanation?: string
          grammar_point?: string
          id?: string
          question_arabic: string
          question_english: string
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          category?: string
          choices?: Json
          correct_index?: number
          created_at?: string
          created_by?: string
          dialect?: string
          difficulty?: string
          explanation?: string
          grammar_point?: string
          id?: string
          question_arabic?: string
          question_english?: string
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      human_review_requests: {
        Row: {
          admin_response: string | null
          ai_response: string
          conversation_context: string
          created_at: string
          id: string
          status: string
          user_id: string
        }
        Insert: {
          admin_response?: string | null
          ai_response: string
          conversation_context: string
          created_at?: string
          id?: string
          status?: string
          user_id: string
        }
        Update: {
          admin_response?: string | null
          ai_response?: string
          conversation_context?: string
          created_at?: string
          id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      institutions: {
        Row: {
          created_at: string
          id: string
          institution_type: string
          logo_url: string | null
          name: string
          name_arabic: string | null
          updated_at: string
          verified: boolean
        }
        Insert: {
          created_at?: string
          id?: string
          institution_type?: string
          logo_url?: string | null
          name: string
          name_arabic?: string | null
          updated_at?: string
          verified?: boolean
        }
        Update: {
          created_at?: string
          id?: string
          institution_type?: string
          logo_url?: string | null
          name?: string
          name_arabic?: string | null
          updated_at?: string
          verified?: boolean
        }
        Relationships: []
      }
      interactive_stories: {
        Row: {
          cover_image_url: string | null
          created_at: string
          created_by: string
          description: string
          description_arabic: string
          dialect: string
          difficulty: string
          display_order: number
          icon_name: string
          id: string
          session_id: string | null
          status: string
          title: string
          title_arabic: string
          updated_at: string
        }
        Insert: {
          cover_image_url?: string | null
          created_at?: string
          created_by: string
          description?: string
          description_arabic?: string
          dialect?: string
          difficulty?: string
          display_order?: number
          icon_name?: string
          id?: string
          session_id?: string | null
          status?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Update: {
          cover_image_url?: string | null
          created_at?: string
          created_by?: string
          description?: string
          description_arabic?: string
          dialect?: string
          difficulty?: string
          display_order?: number
          icon_name?: string
          id?: string
          session_id?: string | null
          status?: string
          title?: string
          title_arabic?: string
          updated_at?: string
        }
        Relationships: []
      }
      learning_paths: {
        Row: {
          completed_at: string | null
          created_at: string
          current_week: number
          curriculum: Json
          goal_description: string
          goal_type: string
          id: string
          last_activity_at: string | null
          started_at: string
          status: string
          target_dialect: string
          target_level: string
          timeline_weeks: number
          updated_at: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          current_week?: number
          curriculum?: Json
          goal_description?: string
          goal_type?: string
          id?: string
          last_activity_at?: string | null
          started_at?: string
          status?: string
          target_dialect?: string
          target_level?: string
          timeline_weeks?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          current_week?: number
          curriculum?: Json
          goal_description?: string
          goal_type?: string
          id?: string
          last_activity_at?: string | null
          started_at?: string
          status?: string
          target_dialect?: string
          target_level?: string
          timeline_weeks?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      listening_exercises: {
        Row: {
          audio_text: string
          audio_text_english: string
          created_at: string
          created_by: string
          dialect: string
          difficulty: string
          hint: string | null
          id: string
          mode: string
          questions: Json
          session_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          audio_text?: string
          audio_text_english?: string
          created_at?: string
          created_by: string
          dialect?: string
          difficulty?: string
          hint?: string | null
          id?: string
          mode?: string
          questions?: Json
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          audio_text?: string
          audio_text_english?: string
          created_at?: string
          created_by?: string
          dialect?: string
          difficulty?: string
          hint?: string | null
          id?: string
          mode?: string
          questions?: Json
          session_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      processed_videos: {
        Row: {
          content_hash: string
          created_at: string
          dialect: string | null
          duration_seconds: number | null
          id: string
          original_url: string
          platform: string
          processed_at: string
          processing_engines: string[] | null
          source_language: string | null
          transcription_data: Json
          updated_at: string
          video_id: string
        }
        Insert: {
          content_hash: string
          created_at?: string
          dialect?: string | null
          duration_seconds?: number | null
          id?: string
          original_url: string
          platform: string
          processed_at?: string
          processing_engines?: string[] | null
          source_language?: string | null
          transcription_data?: Json
          updated_at?: string
          video_id: string
        }
        Update: {
          content_hash?: string
          created_at?: string
          dialect?: string | null
          duration_seconds?: number | null
          id?: string
          original_url?: string
          platform?: string
          processed_at?: string
          processing_engines?: string[] | null
          source_language?: string | null
          transcription_data?: Json
          updated_at?: string
          video_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          custom_institution: string | null
          display_name: string | null
          id: string
          institution_id: string | null
          learning_reason: string | null
          onboarding_completed: boolean
          preferred_dialect: string | null
          proficiency_level: string | null
          show_institution: boolean
          show_on_leaderboard: boolean
          updated_at: string
          user_id: string
          weekly_goal: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          custom_institution?: string | null
          display_name?: string | null
          id?: string
          institution_id?: string | null
          learning_reason?: string | null
          onboarding_completed?: boolean
          preferred_dialect?: string | null
          proficiency_level?: string | null
          show_institution?: boolean
          show_on_leaderboard?: boolean
          updated_at?: string
          user_id: string
          weekly_goal?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          custom_institution?: string | null
          display_name?: string | null
          id?: string
          institution_id?: string | null
          learning_reason?: string | null
          onboarding_completed?: boolean
          preferred_dialect?: string | null
          proficiency_level?: string | null
          show_institution?: boolean
          show_on_leaderboard?: boolean
          updated_at?: string
          user_id?: string
          weekly_goal?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_institution_id_fkey"
            columns: ["institution_id"]
            isOneToOne: false
            referencedRelation: "institutions"
            referencedColumns: ["id"]
          },
        ]
      }
      reading_passages: {
        Row: {
          created_at: string
          created_by: string
          cultural_note: string | null
          dialect: string
          difficulty: string
          id: string
          passage: string
          passage_english: string
          questions: Json
          session_id: string | null
          status: string
          title: string
          title_english: string
          updated_at: string
          vocabulary: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          cultural_note?: string | null
          dialect?: string
          difficulty?: string
          id?: string
          passage?: string
          passage_english?: string
          questions?: Json
          session_id?: string | null
          status?: string
          title?: string
          title_english?: string
          updated_at?: string
          vocabulary?: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          cultural_note?: string | null
          dialect?: string
          difficulty?: string
          id?: string
          passage?: string
          passage_english?: string
          questions?: Json
          session_id?: string | null
          status?: string
          title?: string
          title_english?: string
          updated_at?: string
          vocabulary?: Json
        }
        Relationships: []
      }
      review_streaks: {
        Row: {
          created_at: string
          current_streak: number
          id: string
          last_review_date: string | null
          longest_streak: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_streak?: number
          id?: string
          last_review_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_streak?: number
          id?: string
          last_review_date?: string | null
          longest_streak?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
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
      story_progress: {
        Row: {
          completed: boolean
          completed_at: string | null
          current_scene_id: string | null
          id: string
          path_taken: Json
          started_at: string
          story_id: string
          user_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          current_scene_id?: string | null
          id?: string
          path_taken?: Json
          started_at?: string
          story_id: string
          user_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          current_scene_id?: string | null
          id?: string
          path_taken?: Json
          started_at?: string
          story_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_progress_current_scene_id_fkey"
            columns: ["current_scene_id"]
            isOneToOne: false
            referencedRelation: "story_scenes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_progress_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "interactive_stories"
            referencedColumns: ["id"]
          },
        ]
      }
      story_scenes: {
        Row: {
          choices: Json
          created_at: string
          ending_message: string | null
          ending_message_arabic: string | null
          id: string
          is_ending: boolean
          narrative_arabic: string
          narrative_english: string
          scene_order: number
          story_id: string
          updated_at: string
          vocabulary: Json
        }
        Insert: {
          choices?: Json
          created_at?: string
          ending_message?: string | null
          ending_message_arabic?: string | null
          id?: string
          is_ending?: boolean
          narrative_arabic?: string
          narrative_english?: string
          scene_order?: number
          story_id: string
          updated_at?: string
          vocabulary?: Json
        }
        Update: {
          choices?: Json
          created_at?: string
          ending_message?: string | null
          ending_message_arabic?: string | null
          id?: string
          is_ending?: boolean
          narrative_arabic?: string
          narrative_english?: string
          scene_order?: number
          story_id?: string
          updated_at?: string
          vocabulary?: Json
        }
        Relationships: [
          {
            foreignKeyName: "story_scenes_story_id_fkey"
            columns: ["story_id"]
            isOneToOne: false
            referencedRelation: "interactive_stories"
            referencedColumns: ["id"]
          },
        ]
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
      trending_video_candidates: {
        Row: {
          created_at: string | null
          creator_handle: string | null
          creator_name: string
          detected_topic: string | null
          discovered_at: string | null
          duration_seconds: number | null
          id: string
          platform: string
          processed: boolean | null
          region_code: string | null
          rejected: boolean | null
          rejection_reason: string | null
          thumbnail_url: string | null
          title: string
          trending_score: number | null
          updated_at: string | null
          url: string
          video_id: string
          view_count: number | null
        }
        Insert: {
          created_at?: string | null
          creator_handle?: string | null
          creator_name: string
          detected_topic?: string | null
          discovered_at?: string | null
          duration_seconds?: number | null
          id?: string
          platform: string
          processed?: boolean | null
          region_code?: string | null
          rejected?: boolean | null
          rejection_reason?: string | null
          thumbnail_url?: string | null
          title: string
          trending_score?: number | null
          updated_at?: string | null
          url: string
          video_id: string
          view_count?: number | null
        }
        Update: {
          created_at?: string | null
          creator_handle?: string | null
          creator_name?: string
          detected_topic?: string | null
          discovered_at?: string | null
          duration_seconds?: number | null
          id?: string
          platform?: string
          processed?: boolean | null
          region_code?: string | null
          rejected?: boolean | null
          rejection_reason?: string | null
          thumbnail_url?: string | null
          title?: string
          trending_score?: number | null
          updated_at?: string | null
          url?: string
          video_id?: string
          view_count?: number | null
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
      user_achievements: {
        Row: {
          achievement_id: string
          earned_at: string
          id: string
          user_id: string
        }
        Insert: {
          achievement_id: string
          earned_at?: string
          id?: string
          user_id: string
        }
        Update: {
          achievement_id?: string
          earned_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_achievements_achievement_id_fkey"
            columns: ["achievement_id"]
            isOneToOne: false
            referencedRelation: "achievements"
            referencedColumns: ["id"]
          },
        ]
      }
      user_difficulty: {
        Row: {
          id: string
          listening_difficulty: number
          listening_history: Json
          reading_difficulty: number
          reading_history: Json
          speaking_difficulty: number
          speaking_history: Json
          updated_at: string
          user_id: string
          vocab_difficulty: number
          vocab_history: Json
        }
        Insert: {
          id?: string
          listening_difficulty?: number
          listening_history?: Json
          reading_difficulty?: number
          reading_history?: Json
          speaking_difficulty?: number
          speaking_history?: Json
          updated_at?: string
          user_id: string
          vocab_difficulty?: number
          vocab_history?: Json
        }
        Update: {
          id?: string
          listening_difficulty?: number
          listening_history?: Json
          reading_difficulty?: number
          reading_history?: Json
          speaking_difficulty?: number
          speaking_history?: Json
          updated_at?: string
          user_id?: string
          vocab_difficulty?: number
          vocab_history?: Json
        }
        Relationships: []
      }
      user_follows: {
        Row: {
          created_at: string
          follower_id: string
          following_id: string
          id: string
        }
        Insert: {
          created_at?: string
          follower_id: string
          following_id: string
          id?: string
        }
        Update: {
          created_at?: string
          follower_id?: string
          following_id?: string
          id?: string
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
          correct_count: number
          created_at: string
          ease_factor: number
          id: string
          image_url: string | null
          interval_days: number
          last_result: string | null
          last_reviewed_at: string | null
          next_review_at: string
          repetitions: number
          review_count: number
          root: string | null
          sentence_audio_url: string | null
          sentence_english: string | null
          sentence_text: string | null
          source: string | null
          source_upload_id: string | null
          stage: string
          updated_at: string
          user_id: string
          word_arabic: string
          word_audio_url: string | null
          word_english: string
        }
        Insert: {
          correct_count?: number
          created_at?: string
          ease_factor?: number
          id?: string
          image_url?: string | null
          interval_days?: number
          last_result?: string | null
          last_reviewed_at?: string | null
          next_review_at?: string
          repetitions?: number
          review_count?: number
          root?: string | null
          sentence_audio_url?: string | null
          sentence_english?: string | null
          sentence_text?: string | null
          source?: string | null
          source_upload_id?: string | null
          stage?: string
          updated_at?: string
          user_id: string
          word_arabic: string
          word_audio_url?: string | null
          word_english: string
        }
        Update: {
          correct_count?: number
          created_at?: string
          ease_factor?: number
          id?: string
          image_url?: string | null
          interval_days?: number
          last_result?: string | null
          last_reviewed_at?: string | null
          next_review_at?: string
          repetitions?: number
          review_count?: number
          root?: string | null
          sentence_audio_url?: string | null
          sentence_english?: string | null
          sentence_text?: string | null
          source?: string | null
          source_upload_id?: string | null
          stage?: string
          updated_at?: string
          user_id?: string
          word_arabic?: string
          word_audio_url?: string | null
          word_english?: string
        }
        Relationships: []
      }
      user_xp: {
        Row: {
          created_at: string
          id: string
          level: number
          total_xp: number
          updated_at: string
          user_id: string
          week_start_date: string
          xp_this_week: number
        }
        Insert: {
          created_at?: string
          id?: string
          level?: number
          total_xp?: number
          updated_at?: string
          user_id: string
          week_start_date?: string
          xp_this_week?: number
        }
        Update: {
          created_at?: string
          id?: string
          level?: number
          total_xp?: number
          updated_at?: string
          user_id?: string
          week_start_date?: string
          xp_this_week?: number
        }
        Relationships: []
      }
      video_likes: {
        Row: {
          created_at: string
          id: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_likes_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "discover_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      video_ratings: {
        Row: {
          created_at: string
          id: string
          rating: number
          updated_at: string
          user_id: string
          video_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          rating: number
          updated_at?: string
          user_id: string
          video_id: string
        }
        Update: {
          created_at?: string
          id?: string
          rating?: number
          updated_at?: string
          user_id?: string
          video_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_ratings_video_id_fkey"
            columns: ["video_id"]
            isOneToOne: false
            referencedRelation: "discover_videos"
            referencedColumns: ["id"]
          },
        ]
      }
      vocab_battles: {
        Row: {
          challenger_id: string
          challenger_played_at: string | null
          challenger_score: number | null
          challenger_time_ms: number | null
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          opponent_id: string
          opponent_played_at: string | null
          opponent_score: number | null
          opponent_time_ms: number | null
          question_count: number
          questions: Json
          status: string
          time_limit_seconds: number
          winner_id: string | null
        }
        Insert: {
          challenger_id: string
          challenger_played_at?: string | null
          challenger_score?: number | null
          challenger_time_ms?: number | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          opponent_id: string
          opponent_played_at?: string | null
          opponent_score?: number | null
          opponent_time_ms?: number | null
          question_count?: number
          questions?: Json
          status?: string
          time_limit_seconds?: number
          winner_id?: string | null
        }
        Update: {
          challenger_id?: string
          challenger_played_at?: string | null
          challenger_score?: number | null
          challenger_time_ms?: number | null
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          opponent_id?: string
          opponent_played_at?: string | null
          opponent_score?: number | null
          opponent_time_ms?: number | null
          question_count?: number
          questions?: Json
          status?: string
          time_limit_seconds?: number
          winner_id?: string | null
        }
        Relationships: []
      }
      vocab_game_sets: {
        Row: {
          created_at: string
          created_by: string
          dialect: string
          difficulty: string
          game_type: string
          id: string
          session_id: string | null
          status: string
          title: string
          updated_at: string
          word_pairs: Json
        }
        Insert: {
          created_at?: string
          created_by: string
          dialect?: string
          difficulty?: string
          game_type?: string
          id?: string
          session_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          word_pairs?: Json
        }
        Update: {
          created_at?: string
          created_by?: string
          dialect?: string
          difficulty?: string
          game_type?: string
          id?: string
          session_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          word_pairs?: Json
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
      weekly_goals: {
        Row: {
          completed_reviews: number
          created_at: string
          earned_xp: number
          id: string
          target_reviews: number
          target_xp: number
          updated_at: string
          user_id: string
          week_start_date: string
        }
        Insert: {
          completed_reviews?: number
          created_at?: string
          earned_xp?: number
          id?: string
          target_reviews?: number
          target_xp?: number
          updated_at?: string
          user_id: string
          week_start_date?: string
        }
        Update: {
          completed_reviews?: number
          created_at?: string
          earned_xp?: number
          id?: string
          target_reviews?: number
          target_xp?: number
          updated_at?: string
          user_id?: string
          week_start_date?: string
        }
        Relationships: []
      }
      weekly_recommendations: {
        Row: {
          created_at: string
          difficulty_adjustment: string | null
          focus_areas: Json
          id: string
          learning_path_id: string | null
          motivation_message: string | null
          motivation_message_arabic: string | null
          performance_summary: Json
          suggested_content: Json
          user_id: string
          viewed_at: string | null
          vocab_to_review: Json
          week_start: string
        }
        Insert: {
          created_at?: string
          difficulty_adjustment?: string | null
          focus_areas?: Json
          id?: string
          learning_path_id?: string | null
          motivation_message?: string | null
          motivation_message_arabic?: string | null
          performance_summary?: Json
          suggested_content?: Json
          user_id: string
          viewed_at?: string | null
          vocab_to_review?: Json
          week_start?: string
        }
        Update: {
          created_at?: string
          difficulty_adjustment?: string | null
          focus_areas?: Json
          id?: string
          learning_path_id?: string | null
          motivation_message?: string | null
          motivation_message_arabic?: string | null
          performance_summary?: Json
          suggested_content?: Json
          user_id?: string
          viewed_at?: string | null
          vocab_to_review?: Json
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_recommendations_learning_path_id_fkey"
            columns: ["learning_path_id"]
            isOneToOne: false
            referencedRelation: "learning_paths"
            referencedColumns: ["id"]
          },
        ]
      }
      word_reviews: {
        Row: {
          correct_count: number
          created_at: string
          ease_factor: number
          id: string
          interval_days: number
          last_result: string | null
          last_reviewed_at: string | null
          next_review_at: string
          repetitions: number
          review_count: number
          stage: string
          updated_at: string
          user_id: string
          word_id: string
        }
        Insert: {
          correct_count?: number
          created_at?: string
          ease_factor?: number
          id?: string
          interval_days?: number
          last_result?: string | null
          last_reviewed_at?: string | null
          next_review_at?: string
          repetitions?: number
          review_count?: number
          stage?: string
          updated_at?: string
          user_id: string
          word_id: string
        }
        Update: {
          correct_count?: number
          created_at?: string
          ease_factor?: number
          id?: string
          interval_days?: number
          last_result?: string | null
          last_reviewed_at?: string | null
          next_review_at?: string
          repetitions?: number
          review_count?: number
          stage?: string
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
