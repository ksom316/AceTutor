import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRole } from "@/hooks/use-role";

export const Route = createFileRoute("/teachers")({
  head: () => ({
    meta: [
      { title: "Lecturers — AceTutor" },
      {
        name: "description",
        content:
          "Lecturers manage their assigned course on AceTutor — materials, quizzes, enrolled students and quiz performance.",
      },
    ],
  }),
  component: TeachersRedirect,
});

/**
 * Compatibility redirect. The old standalone teacher upload interface has been
 * replaced by the lecturer workspace (/lecturer); the obsolete self-serve
 * teacher signup no longer exists. Route people to the right place by their
 * database-backed role.
 */
function TeachersRedirect() {
  const { user, loading } = useAuth();
  const { isLecturer, loading: roleLoading } = useRole();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || (user && roleLoading)) return;
    if (isLecturer) {
      navigate({ to: "/lecturer", replace: true });
    } else if (user) {
      navigate({ to: "/dashboard", replace: true });
    } else {
      navigate({ to: "/signup", search: { role: "lecturer" }, replace: true });
    }
  }, [user, loading, roleLoading, isLecturer, navigate]);

  return <div className="min-h-screen" />;
}
