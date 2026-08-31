import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/teachers/auth")({
  component: TeacherAuthRedirect,
});

/**
 * Compatibility alias. Lecturer signup/login now lives on the shared /signup
 * and /login pages; there is no independent teacher auth flow (that path could
 * previously self-assign the teacher role). Old links land on /signup with the
 * lecturer option pre-selected.
 */
function TeacherAuthRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/signup", search: { role: "lecturer" }, replace: true });
  }, [navigate]);
  return null;
}
