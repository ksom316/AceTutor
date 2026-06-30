import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen, Check, Loader2, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { staggerItem } from "@/lib/motion";
import { courseGradient } from "@/lib/course-visuals";

export type CourseCardCourse = {
  id: string;
  slug: string;
  title: string;
  summary?: string | null;
};

/**
 * Enrollment-aware course card shared by the landing-page preview and the
 * /courses page. Renders a gradient thumbnail + title/summary, and adapts its
 * action to the viewer:
 *  - logged in + enrolled  → "Enrolled" badge + "Continue"
 *  - logged in + not yet    → "Enroll" button + "View"
 *  - logged out             → "View course"
 * The whole card is not a single link (it contains buttons), so the thumbnail
 * and title are the navigational links into the course detail page.
 */
export function CourseCard({
  course,
  index = 0,
  loggedIn,
  enrolled,
  enrolling = false,
  onEnroll,
}: {
  course: CourseCardCourse;
  index?: number;
  loggedIn: boolean;
  enrolled: boolean;
  enrolling?: boolean;
  onEnroll?: () => void;
}) {
  const detailLink = { to: "/courses/$slug" as const, params: { slug: course.slug } };

  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -4 }}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all hover:border-primary/40 hover:shadow-lg"
    >
      {/* Gradient thumbnail */}
      <Link
        {...detailLink}
        className="relative block h-24"
        style={{ background: courseGradient(index) }}
        aria-label={course.title}
      >
        <span className="absolute left-4 top-4 grid h-9 w-9 place-items-center rounded-xl bg-white/25 text-white backdrop-blur-sm">
          <BookOpen className="h-5 w-5" />
        </span>
        {loggedIn && enrolled && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-primary shadow-sm">
            <Check className="h-3 w-3" /> Enrolled
          </span>
        )}
      </Link>

      {/* Body */}
      <div className="flex flex-1 flex-col p-5">
        <Link {...detailLink} className="block">
          <h3 className="text-xl font-semibold tracking-tight transition-colors group-hover:text-primary">
            {course.title}
          </h3>
        </Link>
        {course.summary && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{course.summary}</p>}

        {/* Action row */}
        <div className="mt-4 flex items-center gap-2 pt-1">
          {!loggedIn && (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <Link {...detailLink}>
                View course <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          )}

          {loggedIn && enrolled && (
            <Button asChild size="sm" className="rounded-full">
              <Link {...detailLink}>
                <Play className="mr-1.5 h-3.5 w-3.5 fill-current" /> Continue
              </Link>
            </Button>
          )}

          {loggedIn && !enrolled && (
            <>
              <Button size="sm" className="rounded-full" onClick={onEnroll} disabled={enrolling}>
                {enrolling ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                )}
                Enroll
              </Button>
              <Button asChild variant="ghost" size="sm" className="rounded-full">
                <Link {...detailLink}>View</Link>
              </Button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}
