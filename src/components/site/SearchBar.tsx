import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, FileText, Loader2, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type CourseHit = { kind: "course"; id: string; slug: string; title: string };
type TopicHit = { kind: "topic"; id: string; title: string; courseTitle: string | null };
type Hit = CourseHit | TopicHit;

/**
 * Top-bar search across courses and topics. Debounces input, queries Supabase
 * by title, and shows a results dropdown; selecting a result navigates to the
 * course detail or topic page. Enter selects the first result.
 */
export function SearchBar() {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  // Debounce the typed query.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["global-search", debounced],
    enabled: debounced.length >= 2,
    staleTime: 30_000,
    queryFn: async (): Promise<Hit[]> => {
      const like = `%${debounced}%`;
      const [coursesRes, topicsRes] = await Promise.all([
        supabase.from("courses").select("id, slug, title").ilike("title", like).limit(5),
        supabase.from("topics").select("id, title, courses(title)").ilike("title", like).limit(6),
      ]);

      const courses: Hit[] = (coursesRes.data ?? []).map((c) => ({
        kind: "course",
        id: c.id,
        slug: c.slug,
        title: c.title,
      }));
      const topics: Hit[] = (topicsRes.data ?? []).map((t) => {
        const rel = (t as { courses: { title: string } | { title: string }[] | null }).courses;
        const course = Array.isArray(rel) ? rel[0] : rel;
        return { kind: "topic", id: t.id, title: t.title, courseTitle: course?.title ?? null };
      });
      return [...courses, ...topics];
    },
  });

  const results = data ?? [];
  const showPanel = open && debounced.length >= 2;

  // Reset the highlighted row whenever the result set changes.
  useEffect(() => {
    setActive(0);
  }, [debounced, results.length]);

  // Close the dropdown when clicking outside.
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const goTo = (hit: Hit) => {
    setQuery("");
    setDebounced("");
    setOpen(false);
    inputRef.current?.blur();
    if (hit.kind === "course") {
      navigate({ to: "/courses/$slug", params: { slug: hit.slug } });
    } else {
      navigate({ to: "/topic/$topicId", params: { topicId: hit.id } });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!showPanel || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[active] ?? results[0];
      if (hit) goTo(hit);
    }
  };

  return (
    <div ref={containerRef} className="relative hidden flex-1 sm:block">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search courses, topics, quizzes…"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        className="h-10 w-full max-w-md rounded-full border border-border bg-card pl-9 pr-4 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/15"
      />

      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 top-12 z-50 w-full max-w-md overflow-hidden rounded-2xl border border-border bg-popover shadow-lg"
        >
          {isFetching && results.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              No results for “{debounced}”.
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1.5">
              {results.map((hit, i) => {
                const isActive = i === active;
                const Icon = hit.kind === "course" ? BookOpen : FileText;
                return (
                  <li key={`${hit.kind}-${hit.id}`} role="option" aria-selected={isActive}>
                    <button
                      type="button"
                      // onMouseDown (not onClick) so the input's blur doesn't
                      // close the panel before navigation fires.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        goTo(hit);
                      }}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        isActive ? "bg-secondary" : "hover:bg-secondary/60"
                      }`}
                    >
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {hit.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {hit.kind === "course"
                            ? "Course"
                            : hit.courseTitle
                              ? `Topic · ${hit.courseTitle}`
                              : "Topic"}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
