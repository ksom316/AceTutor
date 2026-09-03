import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export type AppRole = "student" | "teacher" | "admin";

type RoleData = { role: AppRole; lecturerCourseId: string | null };

/**
 * The authenticated user's role and lecturer-course assignment, read straight
 * from the database (`user_roles` + `lecturer_slots`) — never from localStorage,
 * signup form state, user metadata or the URL.
 *
 * A lecturer is a `teacher`-role account that has claimed a `lecturer_slots`
 * row; `lecturerCourseId` is that slot's fixed course. `loading` stays true
 * until auth has settled AND (when signed in) the role query has resolved, so
 * callers can gate redirects on it and avoid flashing the wrong interface.
 *
 * Shared query key `["user-role", userId]` so every consumer hits one cache.
 */
export function useRole() {
  const { user, loading: authLoading } = useAuth();

  const query = useQuery({
    queryKey: ["user-role", user?.id],
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<RoleData> => {
      const [roleRes, slotRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user!.id).maybeSingle(),
        // RLS (lecturer_slots_select_own) already scopes this to the caller's row.
        supabase.from("lecturer_slots").select("course_id").maybeSingle(),
      ]);
      const role = (roleRes.data?.role as AppRole | undefined) ?? "student";
      return { role, lecturerCourseId: slotRes.data?.course_id ?? null };
    },
  });

  const loading = authLoading || (!!user && query.isLoading);
  const role: AppRole = query.data?.role ?? "student";
  const lecturerCourseId = query.data?.lecturerCourseId ?? null;
  const isLecturer = !loading && !!user && role === "teacher" && !!lecturerCourseId;
  const isStudent = !loading && !!user && !isLecturer;

  return { role, isLecturer, isStudent, lecturerCourseId, loading };
}
