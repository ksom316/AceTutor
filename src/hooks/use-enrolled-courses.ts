import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Shared enrollment state for the current user, used by any "courses" listing
 * (landing-page preview, /courses page) so they reflect the logged-in user
 * consistently. The query key `["enrolled-courses", userId]` matches the
 * invalidation already fired by the course-detail enroll mutation
 * (src/routes/courses.$slug.tsx), so enrolling anywhere keeps every list in sync.
 */
export function useEnrolledCourses() {
  const { user, loading } = useAuth();
  const qc = useQueryClient();

  const { data: enrolledIds } = useQuery({
    queryKey: ["enrolled-courses", user?.id],
    enabled: !!user,
    queryFn: async () => {
      // RLS scopes enrollments to the current user, so no explicit filter needed.
      const { data, error } = await supabase.from("enrollments").select("course_id");
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.course_id as string));
    },
  });

  const ids = enrolledIds ?? new Set<string>();

  const enroll = useMutation({
    mutationFn: async (courseId: string) => {
      if (!user) throw new Error("Sign in to enroll");
      const { error } = await supabase
        .from("enrollments")
        .insert({ user_id: user.id, course_id: courseId });
      if (error) throw error;
      return courseId;
    },
    onSuccess: (courseId) => {
      toast.success("Enrolled — find it under My Courses");
      qc.invalidateQueries({ queryKey: ["enrolled-courses", user?.id] });
      qc.invalidateQueries({ queryKey: ["enrollment", user?.id, courseId] });
      // Keep the dashboard / home / my-courses surfaces (which read the dash-*
      // queries) in sync with the new enrollment.
      qc.invalidateQueries({ queryKey: ["dash-enrollments", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    user,
    authLoading: loading,
    loggedIn: !!user,
    isEnrolled: (courseId: string) => ids.has(courseId),
    enroll,
  };
}
