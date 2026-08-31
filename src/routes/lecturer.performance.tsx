import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/lecturer/performance")({
  component: LecturerPerformance,
});

function LecturerPerformance() {
  return (
    <main className="container mx-auto max-w-4xl px-4 py-16">
      <h1 className="font-display text-4xl">Performance</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        Reporting on your students&apos; quiz performance will be implemented in a later phase.
      </p>
    </main>
  );
}
