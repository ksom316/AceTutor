import { createFileRoute } from "@tanstack/react-router";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { AppShell } from "@/components/site/AppShell";
import { TeacherUploadPanel } from "@/components/teachers/TeacherUploadPanel";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/teachers")({
  head: () => ({
    meta: [
      { title: "Teachers — AceTutor" },
      {
        name: "description",
        content:
          "Upload course notes and quiz banks for your students. AceTutor delivers them across text, video, and audio modalities.",
      },
    ],
  }),
  component: TeachersPage,
});

function TeachersPage() {
  const { user } = useAuth();

  if (user) {
    return (
      <AppShell user={user}>
        <TeacherUploadPanel authed />
      </AppShell>
    );
  }

  return (
    <div className="min-h-screen">
      <Header />
      <TeacherUploadPanel />
      <Footer />
    </div>
  );
}
