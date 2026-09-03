import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Search, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { fadeUp } from "@/lib/motion";

export const Route = createFileRoute("/lecturer/students")({
  component: LecturerStudents,
});

/**
 * One row from get_course_students(). The generated RPC type over-narrows the
 * nullable profile columns to `string`; widen them here.
 */
type Student = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  enrolled_at: string;
  attempts: number;
  avg_pct: number;
  last_active: string | null;
};

type SortKey = "name" | "enrolled" | "avg" | "active";

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "S"
  );
}

function formatEnrolled(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function lastActiveLabel(iso: string | null): string {
  if (!iso) return "No activity yet";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StudentRow({ student }: { student: Student }) {
  const name = student.full_name?.trim() || "Unnamed student";
  // The lecturer can only sign avatars in their own storage folder (RLS), so
  // only already-absolute avatar URLs (e.g. Google) are shown; everything else
  // falls back to initials.
  const imageSrc = student.avatar_url?.startsWith("http") ? student.avatar_url : undefined;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar className="h-10 w-10">
            <AvatarImage src={imageSrc} alt={name} />
            <AvatarFallback className="text-xs">{initialsOf(name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-xs text-muted-foreground">
              Enrolled {formatEnrolled(student.enrolled_at)}
            </p>
          </div>
        </div>
        <dl className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 text-sm">
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Quiz attempts</dt>
            <dd className="font-medium tabular-nums">{student.attempts}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Avg score</dt>
            <dd className="font-medium tabular-nums">
              {student.attempts > 0 ? `${student.avg_pct}%` : "—"}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-muted-foreground">Last activity</dt>
            <dd className="font-medium">{lastActiveLabel(student.last_active)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function LecturerStudents() {
  const { lecturerCourseId } = useRole();
  const enabled = !!lecturerCourseId;
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("name");

  // Same key + select as the Phase 5 dashboard so the course-name cache is shared.
  const courseQuery = useQuery({
    queryKey: ["lecturer-course", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("title, summary")
        .eq("id", lecturerCourseId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Authoritative student list. get_course_students() takes NO arguments — it
  // derives the course from current_lecturer_course() server-side. Same query
  // key the dashboard uses, so navigating here reuses the warm cache.
  const studentsQuery = useQuery({
    queryKey: ["lecturer-students", lecturerCourseId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_course_students");
      if (error) throw error;
      return (data ?? []) as Student[];
    },
  });

  // Stable empty-array fallback so the sort/filter memo doesn't re-run every
  // render (matches the pattern in analytics.tsx / the Phase 5 dashboard).
  const students = useMemo<Student[]>(() => studentsQuery.data ?? [], [studentsQuery.data]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = term
      ? students.filter((s) => (s.full_name ?? "").toLowerCase().includes(term))
      : students.slice();

    list.sort((a, b) => {
      switch (sort) {
        case "enrolled":
          return new Date(b.enrolled_at).getTime() - new Date(a.enrolled_at).getTime();
        case "avg": {
          // Students with no completed attempts sort last.
          const av = a.attempts > 0 ? a.avg_pct : -1;
          const bv = b.attempts > 0 ? b.avg_pct : -1;
          return bv - av;
        }
        case "active": {
          const at = a.last_active ? new Date(a.last_active).getTime() : 0;
          const bt = b.last_active ? new Date(b.last_active).getTime() : 0;
          return bt - at;
        }
        case "name":
        default:
          return (a.full_name ?? "").localeCompare(b.full_name ?? "");
      }
    });
    return list;
  }, [students, search, sort]);

  const courseName = courseQuery.data?.title;

  return (
    <motion.main
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="container mx-auto max-w-4xl px-4 py-10"
    >
      <h1 className="font-display text-4xl">Students</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Students enrolled in{" "}
        <span className="font-medium text-foreground">{courseName ?? "your assigned course"}</span>.
      </p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name"
            className="rounded-xl pl-9"
            aria-label="Search students by name"
          />
        </div>
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger className="rounded-xl sm:w-52" aria-label="Sort students">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: Name</SelectItem>
            <SelectItem value="enrolled">Sort: Enrollment date</SelectItem>
            <SelectItem value="avg">Sort: Average score</SelectItem>
            <SelectItem value="active">Sort: Last activity</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-6">
        {studentsQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-xl border border-border bg-card p-4"
              >
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : studentsQuery.isError ? (
          <div className="rounded-2xl border border-border bg-card/50 p-10 text-center">
            <h2 className="font-display text-xl">Couldn&apos;t load students</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Student information could not be loaded right now. Please try again.
            </p>
            <Button
              variant="outline"
              className="mt-5 rounded-full"
              onClick={() => studentsQuery.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : students.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center">
            <Users className="mx-auto h-10 w-10 text-muted-foreground" />
            <h2 className="mt-4 font-display text-2xl">No students yet</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              There are currently no students enrolled in this course.
            </p>
          </div>
        ) : visible.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
            No students match your search.
          </p>
        ) : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              {visible.length} of {students.length}{" "}
              {students.length === 1 ? "student" : "students"}
            </p>
            <div className="space-y-3">
              {visible.map((s) => (
                <StudentRow key={s.user_id} student={s} />
              ))}
            </div>
          </>
        )}
      </div>
    </motion.main>
  );
}
