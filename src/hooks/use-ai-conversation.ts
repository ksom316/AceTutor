import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { askCourse } from "@/lib/course-chat.functions";
import { hasClearableConversation } from "@/lib/clear-conversation";

export type TutorMode = "ask" | "explain" | "summarize" | "test" | "general" | "guide";

export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode: string;
  created_at: string;
};

export type SendVars = {
  mode: TutorMode;
  question?: string;
  courseTitle: string;
  courseSummary?: string;
  moduleTitle?: string;
  moduleSummary?: string;
  moduleTopicId?: string;
  /** topic to stamp on a freshly created conversation (soft association). */
  topicId?: string | null;
  signal?: AbortSignal;
};

/**
 * A single persistent AI-tutor conversation for the current (student, course).
 *
 * - Loads the most recent conversation for the course; "New conversation" starts
 *   an empty one, and the first send creates the row.
 * - `send()` posts one turn through `askCourse` (server persists the pair on
 *   success and returns the reply); the transcript is then refetched from
 *   Supabase, so a reload restores everything.
 * - Nothing here trusts another course: the query is scoped to `courseId`, and
 *   the server re-checks `conversation.course_id === courseId`.
 */
export function useAiConversation(courseId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const ask = useServerFn(askCourse);

  // "latest" → use the most recent conversation; "new" → an empty one; a string
  // → that specific conversation id (set after a fresh row is created).
  const [selection, setSelection] = useState<"latest" | "new" | string>("latest");

  // Course isolation: if the course changes under a persisted component, drop
  // any conversation the previous course selected. (The route also re-keys the
  // chat, and the server re-checks course_id — this is defence in depth.)
  useEffect(() => {
    setSelection("latest");
  }, [courseId]);

  const latestQuery = useQuery({
    queryKey: ["ai-conversation", user?.id, courseId],
    enabled: !!user && !!courseId,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("ai_conversations")
        .select("id")
        .eq("user_id", user!.id)
        .eq("course_id", courseId!)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.id ?? null;
    },
  });

  const conversationId =
    selection === "new" ? null : selection === "latest" ? (latestQuery.data ?? null) : selection;

  const messagesQuery = useQuery({
    queryKey: ["ai-messages", conversationId],
    enabled: !!conversationId,
    queryFn: async (): Promise<AiMessage[]> => {
      const { data } = await supabase
        .from("ai_messages")
        .select("id, role, content, mode, created_at")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true });
      return (data ?? []) as AiMessage[];
    },
  });

  const send = useMutation({
    mutationFn: async (vars: SendVars) => {
      if (!user || !courseId) throw new Error("Please sign in to use the AI tutor.");

      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        throw new Error("Your session has expired. Please refresh the page and sign in again.");
      }

      let cid = conversationId;
      if (!cid) {
        const { data: created, error } = await supabase
          .from("ai_conversations")
          .insert({ user_id: user.id, course_id: courseId, topic_id: vars.topicId ?? null })
          .select("id")
          .single();
        if (error) throw error;
        cid = created.id;
      }

      const res = await ask({
        signal: vars.signal,
        data: {
          conversationId: cid,
          courseId,
          courseTitle: vars.courseTitle,
          courseSummary: vars.courseSummary,
          mode: vars.mode,
          question: vars.question,
          moduleTitle: vars.moduleTitle,
          moduleSummary: vars.moduleSummary,
          moduleTopicId: vars.moduleTopicId,
        },
      });
      return { res, cid };
    },
    onSuccess: ({ cid }) => {
      setSelection(cid);
      qc.invalidateQueries({ queryKey: ["ai-messages", cid] });
      qc.invalidateQueries({ queryKey: ["ai-conversation", user?.id, courseId] });
    },
  });

  const startNewConversation = useCallback(() => {
    send.reset();
    setSelection("new");
  }, [send]);

  // Clear Conversation — delete ALL of this student's AI conversations for the
  // current course (server-side RPC, auth.uid()-scoped) and drop to a fresh one.
  const clearCourseConversations = useMutation({
    mutationFn: async () => {
      if (!courseId) throw new Error("No course selected.");
      const { error } = await supabase.rpc("clear_course_conversations", { _course_id: courseId });
      if (error) throw error;
    },
    onSuccess: async () => {
      send.reset();
      setSelection("new");
      qc.removeQueries({ queryKey: ["ai-messages"] });
      // Flip "has clearable content" to false immediately (before the refetch),
      // so Clear Conversation disables the moment the clear lands.
      qc.setQueryData(["ai-conversation", user?.id, courseId], null);
      await qc.invalidateQueries({ queryKey: ["ai-conversation", user?.id, courseId] });
    },
  });

  // Whether "Clear conversation" has anything to act on: real messages in the
  // current thread, or a prior conversation still on record for this course.
  // Derived from the SAME state the UI already reads — no separate counter.
  const hasConversationContent = hasClearableConversation({
    messageCount: messagesQuery.data?.length ?? 0,
    hasLatestConversation: !!latestQuery.data,
  });

  return {
    conversationId,
    messages: messagesQuery.data ?? [],
    isLoading: latestQuery.isLoading || (!!conversationId && messagesQuery.isLoading),
    hasConversationContent,
    send,
    startNewConversation,
    clearCourseConversations,
  };
}
