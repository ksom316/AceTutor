export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      attempt_answers: {
        Row: {
          attempt_id: string;
          id: string;
          is_correct: boolean;
          question_id: string;
          selected_index: number;
          time_ms: number | null;
        };
        Insert: {
          attempt_id: string;
          id?: string;
          is_correct: boolean;
          question_id: string;
          selected_index: number;
          time_ms?: number | null;
        };
        Update: {
          attempt_id?: string;
          id?: string;
          is_correct?: boolean;
          question_id?: string;
          selected_index?: number;
          time_ms?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "attempt_answers_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: false;
            referencedRelation: "quiz_attempts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attempt_answers_question_id_fkey";
            columns: ["question_id"];
            isOneToOne: false;
            referencedRelation: "questions";
            referencedColumns: ["id"];
          },
        ];
      };
      courses: {
        Row: {
          cover_url: string | null;
          created_at: string;
          id: string;
          order_index: number;
          slug: string;
          summary: string | null;
          title: string;
        };
        Insert: {
          cover_url?: string | null;
          created_at?: string;
          id?: string;
          order_index?: number;
          slug: string;
          summary?: string | null;
          title: string;
        };
        Update: {
          cover_url?: string | null;
          created_at?: string;
          id?: string;
          order_index?: number;
          slug?: string;
          summary?: string | null;
          title?: string;
        };
        Relationships: [];
      };
      enrollments: {
        Row: {
          course_id: string;
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          course_id: string;
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "enrollments_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      lecturer_slots: {
        Row: {
          claimed_at: string | null;
          claimed_by: string | null;
          course_id: string;
          created_at: string;
          lecturer_id: string;
        };
        Insert: {
          claimed_at?: string | null;
          claimed_by?: string | null;
          course_id: string;
          created_at?: string;
          lecturer_id: string;
        };
        Update: {
          claimed_at?: string | null;
          claimed_by?: string | null;
          course_id?: string;
          created_at?: string;
          lecturer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lecturer_slots_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: true;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      lessons: {
        Row: {
          body_md: string | null;
          duration_sec: number | null;
          id: string;
          media_url: string | null;
          modality: Database["public"]["Enums"]["modality"];
          order_index: number;
          title: string;
          topic_id: string;
        };
        Insert: {
          body_md?: string | null;
          duration_sec?: number | null;
          id?: string;
          media_url?: string | null;
          modality: Database["public"]["Enums"]["modality"];
          order_index?: number;
          title: string;
          topic_id: string;
        };
        Update: {
          body_md?: string | null;
          duration_sec?: number | null;
          id?: string;
          media_url?: string | null;
          modality?: Database["public"]["Enums"]["modality"];
          order_index?: number;
          title?: string;
          topic_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lessons_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          course_id: string;
          kind: string;
          title: string;
          message: string;
          created_at: string;
          read_at: string | null;
          audience: string;
          topic_id: string | null;
          quiz_id: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          course_id: string;
          kind: string;
          title: string;
          message: string;
          created_at?: string;
          read_at?: string | null;
          audience?: string;
          topic_id?: string | null;
          quiz_id?: string | null;
        };
        Update: { read_at?: string | null };
        Relationships: [
          {
            foreignKeyName: "notifications_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          vark_primary: Database["public"]["Enums"]["vark_style"] | null;
          vark_scores: Json | null;
        };
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          vark_primary?: Database["public"]["Enums"]["vark_style"] | null;
          vark_scores?: Json | null;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          vark_primary?: Database["public"]["Enums"]["vark_style"] | null;
          vark_scores?: Json | null;
        };
        Relationships: [];
      };
      progress: {
        Row: {
          completed_at: string | null;
          id: string;
          lesson_id: string;
          updated_at: string;
          user_id: string;
          watched_seconds: number;
        };
        Insert: {
          completed_at?: string | null;
          id?: string;
          lesson_id: string;
          updated_at?: string;
          user_id: string;
          watched_seconds?: number;
        };
        Update: {
          completed_at?: string | null;
          id?: string;
          lesson_id?: string;
          updated_at?: string;
          user_id?: string;
          watched_seconds?: number;
        };
        Relationships: [
          {
            foreignKeyName: "progress_lesson_id_fkey";
            columns: ["lesson_id"];
            isOneToOne: false;
            referencedRelation: "lessons";
            referencedColumns: ["id"];
          },
        ];
      };
      course_quizzes: {
        Row: {
          course_id: string;
          created_at: string;
          deadline: string | null;
          description: string | null;
          duration_minutes: number;
          id: string;
          max_attempts: number | null;
          title: string;
        };
        Insert: {
          course_id: string;
          created_at?: string;
          deadline?: string | null;
          description?: string | null;
          duration_minutes?: number;
          id?: string;
          max_attempts?: number | null;
          title?: string;
        };
        Update: {
          course_id?: string;
          created_at?: string;
          deadline?: string | null;
          description?: string | null;
          duration_minutes?: number;
          id?: string;
          max_attempts?: number | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "course_quizzes_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      questions: {
        Row: {
          choices: Json;
          correct_index: number;
          course_quiz_id: string | null;
          difficulty: number;
          explanation: string | null;
          id: string;
          order_index: number;
          prompt: string;
          topic_id: string | null;
        };
        Insert: {
          choices: Json;
          correct_index: number;
          course_quiz_id?: string | null;
          difficulty?: number;
          explanation?: string | null;
          id?: string;
          order_index?: number;
          prompt: string;
          topic_id?: string | null;
        };
        Update: {
          choices?: Json;
          correct_index?: number;
          course_quiz_id?: string | null;
          difficulty?: number;
          explanation?: string | null;
          id?: string;
          order_index?: number;
          prompt?: string;
          topic_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "questions_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "questions_course_quiz_id_fkey";
            columns: ["course_quiz_id"];
            isOneToOne: false;
            referencedRelation: "course_quizzes";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_attempts: {
        Row: {
          answered_count: number | null;
          course_quiz_id: string | null;
          expires_at: string | null;
          finished_at: string | null;
          id: string;
          score: number;
          started_at: string;
          timed_out: boolean;
          topic_id: string | null;
          total: number;
          user_id: string;
        };
        Insert: {
          answered_count?: number | null;
          course_quiz_id?: string | null;
          expires_at?: string | null;
          finished_at?: string | null;
          id?: string;
          score?: number;
          started_at?: string;
          timed_out?: boolean;
          topic_id?: string | null;
          total?: number;
          user_id: string;
        };
        Update: {
          answered_count?: number | null;
          course_quiz_id?: string | null;
          expires_at?: string | null;
          finished_at?: string | null;
          id?: string;
          score?: number;
          started_at?: string;
          timed_out?: boolean;
          topic_id?: string | null;
          total?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quiz_attempts_course_quiz_id_fkey";
            columns: ["course_quiz_id"];
            isOneToOne: false;
            referencedRelation: "course_quizzes";
            referencedColumns: ["id"];
          },
        ];
      };
      study_paths: {
        Row: {
          id: string;
          user_id: string;
          topic_id: string | null;
          course_id: string;
          attempt_id: string;
          weak_question_ids: string[];
          content: Json;
          created_at: string;
          saved_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          topic_id?: string | null;
          course_id: string;
          attempt_id: string;
          weak_question_ids?: string[];
          content: Json;
          created_at?: string;
          saved_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          topic_id?: string | null;
          course_id?: string;
          attempt_id?: string;
          weak_question_ids?: string[];
          content?: Json;
          created_at?: string;
          saved_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "study_paths_topic_id_fkey";
            columns: ["topic_id"];
            isOneToOne: false;
            referencedRelation: "topics";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_paths_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_paths_attempt_id_fkey";
            columns: ["attempt_id"];
            isOneToOne: true;
            referencedRelation: "quiz_attempts";
            referencedColumns: ["id"];
          },
        ];
      };
      study_sessions: {
        Row: {
          course_id: string | null;
          id: string;
          last_seen_at: string;
          seconds: number;
          started_at: string;
          surface: string;
          user_id: string;
        };
        Insert: {
          course_id?: string | null;
          id?: string;
          last_seen_at?: string;
          seconds?: number;
          started_at?: string;
          surface?: string;
          user_id: string;
        };
        Update: {
          course_id?: string | null;
          id?: string;
          last_seen_at?: string;
          seconds?: number;
          started_at?: string;
          surface?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "study_sessions_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      topics: {
        Row: {
          course_id: string;
          id: string;
          order_index: number;
          quiz_duration_minutes: number;
          slug: string;
          summary: string | null;
          title: string;
        };
        Insert: {
          course_id: string;
          id?: string;
          order_index?: number;
          quiz_duration_minutes?: number;
          slug: string;
          summary?: string | null;
          title: string;
        };
        Update: {
          course_id?: string;
          id?: string;
          order_index?: number;
          quiz_duration_minutes?: number;
          slug?: string;
          summary?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "topics_course_id_fkey";
            columns: ["course_id"];
            isOneToOne: false;
            referencedRelation: "courses";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      vark_responses: {
        Row: {
          answers: Json;
          computed_style: Database["public"]["Enums"]["vark_style"];
          created_at: string;
          id: string;
          user_id: string;
        };
        Insert: {
          answers: Json;
          computed_style: Database["public"]["Enums"]["vark_style"];
          created_at?: string;
          id?: string;
          user_id: string;
        };
        Update: {
          answers?: Json;
          computed_style?: Database["public"]["Enums"]["vark_style"];
          created_at?: string;
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      claim_lecturer_slot: {
        Args: { _lecturer_id: string };
        Returns: string;
      };
      current_lecturer_course: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      create_module_with_quiz: {
        Args: {
          _duration_minutes?: number;
          _lessons: Json;
          _questions: Json;
          _summary: string;
          _title: string;
        };
        Returns: string;
      };
      finalize_expired_quiz_attempts: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      create_course_quiz: {
        Args: {
          _deadline?: string | null;
          _description?: string | null;
          _duration_minutes?: number;
          _max_attempts?: number | null;
          _title: string;
        };
        Returns: string;
      };
      create_course_quiz_with_questions: {
        Args: {
          _deadline?: string | null;
          _description?: string | null;
          _duration_minutes?: number;
          _max_attempts?: number | null;
          _questions: Json;
          _title: string;
        };
        Returns: string;
      };
      update_course_quiz: {
        Args: {
          _deadline?: string | null;
          _description?: string | null;
          _duration_minutes?: number;
          _max_attempts?: number | null;
          _quiz_id: string;
          _title: string;
        };
        Returns: undefined;
      };
      delete_course_quiz: {
        Args: { _quiz_id: string };
        Returns: undefined;
      };
      course_quiz_has_attempts: {
        Args: { _quiz_id: string };
        Returns: boolean;
      };
      list_course_quizzes: {
        Args: { _course_id: string };
        Returns: {
          created_at: string;
          deadline: string | null;
          description: string | null;
          duration_minutes: number;
          id: string;
          max_attempts: number | null;
          question_count: number;
          title: string;
        }[];
      };
      get_course_quiz_questions: {
        Args: { _limit?: number; _quiz_id: string };
        Returns: {
          choices: Json;
          difficulty: number;
          id: string;
          prompt: string;
        }[];
      };
      get_course_quiz_performance: {
        Args: Record<PropertyKey, never>;
        Returns: {
          answered_count: number;
          attempt_id: string;
          completed: boolean;
          course_quiz_id: string;
          expired: boolean;
          finished_at: string;
          pct: number;
          quiz_title: string;
          quiz_type: string;
          score: number;
          started_at: string;
          student: string;
          timed_out: boolean;
          topic: string;
          topic_id: string;
          total: number;
        }[];
      };
      get_course_students: {
        Args: Record<PropertyKey, never>;
        Returns: {
          attempts: number;
          avatar_url: string;
          avg_pct: number;
          enrolled_at: string;
          full_name: string;
          last_active: string;
          user_id: string;
        }[];
      };
      get_quiz_questions: {
        Args: { _limit?: number; _topic_id: string };
        Returns: {
          choices: Json;
          difficulty: number;
          id: string;
          prompt: string;
        }[];
      };
      grade_quiz: {
        Args: { _answers: Json; _attempt_id: string; _timed_out?: boolean };
        Returns: {
          correct_index: number;
          explanation: string;
          is_correct: boolean;
          question_id: string;
        }[];
      };
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      lecturer_id_available: {
        Args: { _lecturer_id: string };
        Returns: string;
      };
      publish_teacher_note: {
        Args: { _body_md: string; _course_id: string; _lesson_title: string; _topic_title: string };
        Returns: string;
      };
      publish_teacher_quiz: {
        Args: { _course_id: string; _questions: Json; _quiz_title: string; _topic_title: string };
        Returns: string;
      };
      replace_topic_quiz: {
        Args: { _questions: Json; _topic_id: string };
        Returns: undefined;
      };
      replace_course_quiz: {
        Args: { _questions: Json; _quiz_id: string };
        Returns: string;
      };
      save_study_path: {
        Args: { _attempt_id: string; _content: Json; _weak_question_ids: string[] };
        Returns: {
          id: string;
          user_id: string;
          topic_id: string | null;
          course_id: string;
          attempt_id: string;
          weak_question_ids: string[];
          content: Json;
          created_at: string;
          saved_at: string | null;
          completed_at: string | null;
        };
      };
      mark_study_path_completed: {
        Args: { _id: string };
        Returns: {
          id: string;
          user_id: string;
          topic_id: string | null;
          course_id: string;
          attempt_id: string;
          weak_question_ids: string[];
          content: Json;
          created_at: string;
          saved_at: string | null;
          completed_at: string | null;
        };
      };
      set_study_path_saved: {
        Args: { _id: string; _saved: boolean };
        Returns: {
          id: string;
          user_id: string;
          topic_id: string | null;
          course_id: string;
          attempt_id: string;
          weak_question_ids: string[];
          content: Json;
          created_at: string;
          saved_at: string | null;
          completed_at: string | null;
        };
      };
    };
    Enums: {
      app_role: "student" | "teacher" | "admin";
      modality: "text" | "video" | "audio" | "slides";
      vark_style: "visual" | "aural" | "read_write" | "kinesthetic";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["student", "admin"],
      modality: ["text", "video", "audio", "slides"],
      vark_style: ["visual", "aural", "read_write", "kinesthetic"],
    },
  },
} as const;
