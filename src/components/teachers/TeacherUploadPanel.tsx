import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ClipboardList,
  FileUp,
  HelpCircle,
  Sparkles,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileDropZone } from "@/components/teachers/FileDropZone";
import { useAuth } from "@/hooks/use-auth";
import { goBackToTop } from "@/lib/go-back";
import { fadeUp, staggerContainer, staggerItem, viewportOnce } from "@/lib/motion";
import { supabase } from "@/integrations/supabase/client";

const DRAFT_KEY = "acetutor:teacher-draft";

type UploadKind = "notes" | "quiz";

type TeacherDraft = {
  kind: UploadKind;
  courseId: string;
  topicTitle: string;
  title: string;
  fileName: string;
};

const teacherFacts = [
  {
    icon: BookOpen,
    title: "Course notes",
    body: "Upload markdown, PDF, or Word docs — AceTutor turns them into readable lessons.",
  },
  {
    icon: ClipboardList,
    title: "Quiz banks",
    body: "Import JSON or CSV question sets and attach them to any topic in your course.",
  },
  {
    icon: CheckCircle2,
    title: "One shared backend",
    body: "Materials you publish appear for students on web and mobile with the same account.",
  },
];

const notesAccept = ".md,.txt,.pdf,.doc,.docx";
const quizAccept = ".json,.csv";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readTextFile(file: File) {
  return file.text();
}

function parseQuizQuestions(text: string, fileName: string) {
  if (fileName.toLowerCase().endsWith(".json")) {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) throw new Error("Quiz JSON must be an array of questions.");
    return parsed.map((question) => {
      const item = question as { prompt?: string; choices?: string[]; correct_index?: number; explanation?: string; difficulty?: number };
      if (!item.prompt || !Array.isArray(item.choices) || typeof item.correct_index !== "number") {
        throw new Error("Each question needs a prompt, choices, and correct_index.");
      }
      return item;
    });
  }

  const [header, ...rows] = text.split(/\r?\n/).filter((line) => line.trim());
  const columns = header.split(",").map((column) => column.trim());
  const index = (name: string) => columns.indexOf(name);
  return rows.map((row) => {
    const values = row.split(",").map((value) => value.trim());
    const prompt = values[index("prompt")];
    const choices = ["choice1", "choice2", "choice3", "choice4"]
      .map((name) => values[index(name)])
      .filter(Boolean);
    const correctIndex = Number(values[index("correct_index")]);
    if (!prompt || choices.length < 2 || !Number.isInteger(correctIndex)) {
      throw new Error("CSV questions need prompt, choices, and correct_index columns.");
    }
    return { prompt, choices, correct_index: correctIndex, explanation: values[index("explanation")] ?? null };
  });
}

export function TeacherUploadPanel({ authed = false }: { authed?: boolean }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<UploadKind>("notes");
  const [courseId, setCourseId] = useState("");
  const [topicTitle, setTopicTitle] = useState("");
  const [title, setTitle] = useState("");
  const [notesFile, setNotesFile] = useState<File | null>(null);
  const [quizFile, setQuizFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: role, isLoading: roleLoading } = useQuery({
    queryKey: ["teacher-role", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "teacher")
        .maybeSingle();
      if (error) throw error;
      return data?.role;
    },
  });

  const { data: courses } = useQuery({
    queryKey: ["courses"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, slug, title")
        .order("order_index");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const draft = JSON.parse(raw) as TeacherDraft;
      setTab(draft.kind);
      setCourseId(draft.courseId);
      setTopicTitle(draft.topicTitle);
      setTitle(draft.title);
      sessionStorage.removeItem(DRAFT_KEY);
      toast.message("Draft restored — re-attach your file to publish.");
    } catch {
      sessionStorage.removeItem(DRAFT_KEY);
    }
  }, []);

  const activeFile = tab === "notes" ? notesFile : quizFile;

  const selectedCourse = useMemo(
    () => courses?.find((c) => c.id === courseId),
    [courses, courseId],
  );

  const validate = () => {
    if (!courseId) {
      toast.error("Choose a course");
      return false;
    }
    if (!topicTitle.trim()) {
      toast.error("Enter a topic name");
      return false;
    }
    if (!title.trim()) {
      toast.error(tab === "notes" ? "Enter a lesson title" : "Enter a quiz title");
      return false;
    }
    if (!activeFile) {
      toast.error("Attach a file to upload");
      return false;
    }
    return true;
  };

  const requireAuth = () => {
    const draft: TeacherDraft = {
      kind: tab,
      courseId,
      topicTitle: topicTitle.trim(),
      title: title.trim(),
      fileName: activeFile!.name,
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    toast.info("Sign in to publish your materials");
    navigate({ to: "/teachers/auth", search: { redirect: "/teachers" } });
  };

  const publish = async () => {
    if (!validate() || !activeFile) return;

    if (!user) {
      requireAuth();
      return;
    }
    if (role !== "teacher") {
      toast.error("Only teacher accounts can publish materials.");
      return;
    }

    setSubmitting(true);
    try {
      const text = await readTextFile(activeFile);
      if (tab === "quiz") {
        const questions = parseQuizQuestions(text, activeFile.name);
        const count = questions.length;
        if (count === 0) throw new Error("No quiz questions found in that file.");
        const { error } = await supabase.rpc("publish_teacher_quiz", {
          _course_id: courseId,
          _topic_title: topicTitle.trim(),
          _quiz_title: title.trim(),
          _questions: questions,
        });
        if (error) throw error;
        toast.success(`${count} question${count === 1 ? "" : "s"} ready for "${selectedCourse?.title}"`);
      } else {
        const { error } = await supabase.rpc("publish_teacher_note", {
          _course_id: courseId,
          _topic_title: topicTitle.trim(),
          _lesson_title: title.trim(),
          _body_md: text,
        });
        if (error) throw error;
        toast.success(`Notes "${title.trim()}" submitted for "${selectedCourse?.title}"`);
      }

      toast.message("Published. Enrolled students have been notified.");

      setTopicTitle("");
      setTitle("");
      if (tab === "notes") setNotesFile(null);
      else setQuizFile(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not process that file");
    } finally {
      setSubmitting(false);
    }
  };

  if (user && !roleLoading && role !== "teacher") {
    return (
      <main className="container mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="font-display text-4xl font-bold">Teacher access required</h1>
        <p className="mt-3 text-muted-foreground">This workspace is available to teacher accounts only.</p>
        <Button asChild className="mt-6 rounded-full">
          <Link to="/teachers/auth">Use teacher sign in</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 -z-10 h-[520px] [background:radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_18%,transparent),transparent_70%)]" />
      <div
        aria-hidden
        className="animate-float absolute -left-10 top-40 -z-10 h-56 w-56 rounded-full bg-primary/15 blur-3xl"
      />
      <div
        aria-hidden
        className="animate-float delay-300 absolute right-0 top-24 -z-10 h-64 w-64 rounded-full bg-[oklch(0.66_0.17_330)]/15 blur-3xl"
      />

      <div className="container mx-auto max-w-6xl px-4 pb-20 pt-10 md:pt-14">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {!authed && (
            <button
              type="button"
              aria-label="Go back"
              onClick={goBackToTop}
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}

          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
          >
            <Sparkles className="h-3 w-3" /> Teacher workspace
          </motion.span>

          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">
            Publish <span className="text-primary">course materials</span>
          </h1>
          <p className="mt-4 max-w-2xl text-muted-foreground md:text-lg">
            Upload lesson notes and quiz banks for your courses. Students see them across text,
            video, and audio modalities once you sign in and publish.
          </p>
        </motion.div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.6fr]">
          <motion.aside
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[oklch(0.5_0.2_300)] p-7 text-primary-foreground shadow-lg md:p-8"
          >
            <div
              aria-hidden
              className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl"
            />
            <div
              aria-hidden
              className="absolute -bottom-16 -left-6 h-44 w-44 rounded-full bg-white/10 blur-2xl"
            />
            <h2 className="relative font-display text-2xl leading-tight md:text-3xl">
              Built for lecturers
            </h2>
            <p className="relative mt-2 text-sm text-primary-foreground/85">
              Share notes and assessments in minutes. AceTutor handles delivery — you focus on
              teaching.
            </p>

            <motion.ul
              variants={staggerContainer}
              initial="hidden"
              whileInView="show"
              viewport={viewportOnce}
              className="relative mt-7 space-y-4"
            >
              {teacherFacts.map(({ icon: Icon, title: factTitle, body }) => (
                <motion.li key={factTitle} variants={staggerItem} className="flex items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 backdrop-blur-sm">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{factTitle}</p>
                    <p className="text-xs text-primary-foreground/80">{body}</p>
                  </div>
                </motion.li>
              ))}
            </motion.ul>

            {!user && (
              <Button
                asChild
                size="lg"
                className="relative mt-8 h-11 rounded-full bg-white px-5 text-sm font-semibold text-primary hover:bg-white/90"
              >
                <Link to="/teachers/auth" search={{ redirect: "/teachers", mode: "signup" }}>
                  <FileUp className="mr-2 h-4 w-4" /> Create teacher account
                </Link>
              </Button>
            )}
          </motion.aside>

          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            className="rounded-3xl border border-border bg-card/60 p-6 backdrop-blur-sm md:p-8"
          >
            <Tabs value={tab} onValueChange={(v) => setTab(v as UploadKind)}>
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-full bg-muted/80 p-1">
                <TabsTrigger value="notes" className="rounded-full data-[state=active]:shadow-sm">
                  <BookOpen className="mr-2 h-4 w-4" />
                  Course notes
                </TabsTrigger>
                <TabsTrigger value="quiz" className="rounded-full data-[state=active]:shadow-sm">
                  <ClipboardList className="mr-2 h-4 w-4" />
                  Quizzes
                </TabsTrigger>
              </TabsList>

              <div className="mt-6 space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="course">Course</Label>
                  <Select value={courseId} onValueChange={setCourseId}>
                    <SelectTrigger id="course" className="h-11 rounded-xl">
                      <SelectValue placeholder="Select a course" />
                    </SelectTrigger>
                    <SelectContent>
                      {(courses ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="topic">Topic</Label>
                    <Input
                      id="topic"
                      placeholder="e.g. Binary Search Trees"
                      value={topicTitle}
                      onChange={(e) => setTopicTitle(e.target.value)}
                      className="h-11 rounded-xl"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="title">{tab === "notes" ? "Lesson title" : "Quiz title"}</Label>
                    <Input
                      id="title"
                      placeholder={tab === "notes" ? "e.g. Introduction to BSTs" : "e.g. BST practice quiz"}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="h-11 rounded-xl"
                    />
                  </div>
                </div>

                <TabsContent value="notes" className="mt-0 space-y-4">
                  <FileDropZone
                    accept={notesAccept}
                    hint="Markdown, plain text, PDF, or Word (.md, .txt, .pdf, .docx)"
                    file={notesFile}
                    onFile={setNotesFile}
                  />
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Notes are published as the Read modality for the topic you choose.
                  </p>
                </TabsContent>

                <TabsContent value="quiz" className="mt-0 space-y-4">
                  <FileDropZone
                    accept={quizAccept}
                    hint="JSON array or CSV with prompt, choices, and correct answer"
                    file={quizFile}
                    onFile={setQuizFile}
                  />
                  <div className="rounded-2xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground">Quiz file formats</p>
                    <p className="mt-2">
                      <strong>JSON:</strong>{" "}
                      <code className="rounded bg-background px-1 py-0.5">
                        [{"{"}"prompt","choices":["A","B"],"correct_index":0{"}"}]
                      </code>
                    </p>
                    <p className="mt-2">
                      <strong>CSV:</strong> header row{" "}
                      <code className="rounded bg-background px-1 py-0.5">
                        prompt,choice1,choice2,choice3,choice4,correct_index,explanation
                      </code>
                    </p>
                  </div>
                </TabsContent>

                {activeFile && (
                  <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
                    Ready to upload{" "}
                    <span className="font-medium text-foreground">{activeFile.name}</span>{" "}
                    <span className="text-muted-foreground">({formatBytes(activeFile.size)})</span>
                  </div>
                )}

                <Button
                  type="button"
                  size="lg"
                  disabled={submitting}
                  onClick={publish}
                  className="h-12 w-full rounded-full text-base"
                >
                  <Upload className="mr-2 h-4 w-4" />
                  {user ? "Publish materials" : "Sign in to publish"}
                </Button>

                {!user && (
                  <p className="text-center text-xs text-muted-foreground">
                    You can prepare uploads now — sign in when you&apos;re ready to publish.{" "}
                    <Link to="/teachers/auth" search={{ redirect: "/teachers", mode: "signup" }} className="text-primary hover:underline">
                      Create an account
                    </Link>
                  </p>
                )}
              </div>
            </Tabs>
          </motion.div>
        </div>

        <motion.div
          variants={fadeUp}
          initial="hidden"
          whileInView="show"
          viewport={viewportOnce}
          className="mt-14 overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent p-8 text-center md:p-12"
        >
          {authed ? (
            <>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Managing a course?</h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground md:text-base">
                Jump to your dashboard to track student progress while materials go live.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
                  <Link to="/dashboard">Go to dashboard</Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-6 text-base">
                  <Link to="/courses">Browse courses</Link>
                </Button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold tracking-tight md:text-3xl">
                New to AceTutor?
              </h2>
              <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground md:text-base">
                Create a free account to publish materials and reach students with adaptive,
                multimodal lessons.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
                  <Link to="/signup" search={{ redirect: "/teachers" }}>
                    Get started free
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-6 text-base">
                  <Link to="/login" search={{ redirect: "/teachers" }}>
                    Log in
                  </Link>
                </Button>
              </div>
            </>
          )}
        </motion.div>
      </div>
    </main>
  );
}
