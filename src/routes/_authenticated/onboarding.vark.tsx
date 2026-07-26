import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

const EASE = [0.22, 1, 0.36, 1] as const;

export const Route = createFileRoute("/_authenticated/onboarding/vark")({
  component: VarkOnboarding,
});

type Style = "visual" | "aural" | "read_write" | "kinesthetic";

const QUESTIONS: { q: string; options: { label: string; style: Style }[] }[] = [
  {
    q: "When learning a new algorithm, you prefer to…",
    options: [
      { label: "Watch an animated walkthrough", style: "visual" },
      { label: "Listen to an explanation", style: "aural" },
      { label: "Read the textbook chapter", style: "read_write" },
      { label: "Code it from scratch immediately", style: "kinesthetic" },
    ],
  },
  {
    q: "You remember best when…",
    options: [
      { label: "You see diagrams or flowcharts", style: "visual" },
      { label: "Someone talks it through with you", style: "aural" },
      { label: "You write notes in your own words", style: "read_write" },
      { label: "You apply it in a project", style: "kinesthetic" },
    ],
  },
  {
    q: "Studying for an exam, you would…",
    options: [
      { label: "Make a mind map", style: "visual" },
      { label: "Record yourself and listen back", style: "aural" },
      { label: "Rewrite summary notes", style: "read_write" },
      { label: "Solve past papers hands-on", style: "kinesthetic" },
    ],
  },
  {
    q: "A confusing concept becomes clear when…",
    options: [
      { label: "You see it visualized", style: "visual" },
      { label: "A friend explains aloud", style: "aural" },
      { label: "You read multiple sources", style: "read_write" },
      { label: "You try it yourself", style: "kinesthetic" },
    ],
  },
  {
    q: "Given an hour to learn TCP/IP, you…",
    options: [
      { label: "Watch an explainer video", style: "visual" },
      { label: "Listen to a podcast", style: "aural" },
      { label: "Read the RFC summary", style: "read_write" },
      { label: "Inspect packets with Wireshark", style: "kinesthetic" },
    ],
  },
  {
    q: "Group projects: your favourite role is…",
    options: [
      { label: "Designer / diagrammer", style: "visual" },
      { label: "Presenter / explainer", style: "aural" },
      { label: "Documentation lead", style: "read_write" },
      { label: "Implementer / coder", style: "kinesthetic" },
    ],
  },
  {
    q: "When stuck on a bug you…",
    options: [
      { label: "Draw the data flow", style: "visual" },
      { label: "Talk through it aloud", style: "aural" },
      { label: "Read the docs end-to-end", style: "read_write" },
      { label: "Add prints and re-run", style: "kinesthetic" },
    ],
  },
  {
    q: "A great lecture for you has…",
    options: [
      { label: "Lots of slides and visuals", style: "visual" },
      { label: "A clear, engaging speaker", style: "aural" },
      { label: "Solid handouts to read", style: "read_write" },
      { label: "Live coding demos", style: "kinesthetic" },
    ],
  },
  {
    q: "Your study notes are mostly…",
    options: [
      { label: "Sketches and diagrams", style: "visual" },
      { label: "Voice memos", style: "aural" },
      { label: "Prose and bullet lists", style: "read_write" },
      { label: "Working code samples", style: "kinesthetic" },
    ],
  },
  {
    q: "You'd rather review SQL by…",
    options: [
      { label: "Looking at an ER diagram", style: "visual" },
      { label: "Hearing a colleague explain it", style: "aural" },
      { label: "Reading documentation", style: "read_write" },
      { label: "Writing queries on real data", style: "kinesthetic" },
    ],
  },
  {
    q: "Long-form content you prefer:",
    options: [
      { label: "Infographics", style: "visual" },
      { label: "Podcasts", style: "aural" },
      { label: "Articles & books", style: "read_write" },
      { label: "Hands-on tutorials", style: "kinesthetic" },
    ],
  },
  {
    q: "You explain ideas to others by…",
    options: [
      { label: "Drawing on a whiteboard", style: "visual" },
      { label: "Speaking and storytelling", style: "aural" },
      { label: "Writing them down", style: "read_write" },
      { label: "Demoing the working thing", style: "kinesthetic" },
    ],
  },
  {
    q: "New programming language? You…",
    options: [
      { label: "Watch a syntax tour video", style: "visual" },
      { label: "Listen to an interview about it", style: "aural" },
      { label: "Skim the official guide", style: "read_write" },
      { label: "Build a tiny project", style: "kinesthetic" },
    ],
  },
  {
    q: "Conferences: you remember most…",
    options: [
      { label: "The slide visuals", style: "visual" },
      { label: "The speaker's voice and stories", style: "aural" },
      { label: "The handout / blog write-up", style: "read_write" },
      { label: "The hands-on workshops", style: "kinesthetic" },
    ],
  },
  {
    q: "Math proofs feel clearest when…",
    options: [
      { label: "Drawn out step-by-step", style: "visual" },
      { label: "Explained verbally", style: "aural" },
      { label: "Read carefully line by line", style: "read_write" },
      { label: "Worked through on paper", style: "kinesthetic" },
    ],
  },
  {
    q: "Your dream learning tool would be…",
    options: [
      { label: "An interactive diagram", style: "visual" },
      { label: "A personal voice tutor", style: "aural" },
      { label: "A perfect textbook", style: "read_write" },
      { label: "A live sandbox to tinker in", style: "kinesthetic" },
    ],
  },
];

function VarkOnboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Style[]>([]);
  const [saving, setSaving] = useState(false);

  const question = QUESTIONS[step];

  const pick = async (style: Style) => {
    const updated = [...answers, style];
    setAnswers(updated);
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }
    // Score
    const scores: Record<Style, number> = { visual: 0, aural: 0, read_write: 0, kinesthetic: 0 };
    updated.forEach((s) => (scores[s] += 1));
    const primary = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0] as Style;

    setSaving(true);
    await supabase.from("vark_responses").insert({
      user_id: user!.id,
      answers: updated,
      computed_style: primary,
    });
    await supabase
      .from("profiles")
      .update({ vark_primary: primary, vark_scores: scores })
      .eq("id", user!.id);
    setSaving(false);
    toast.success("Your learning style is saved!");
    navigate({ to: "/dashboard" });
  };

  const progress = (step / QUESTIONS.length) * 100;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        Question {step + 1} of {QUESTIONS.length}
      </p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <motion.div
          className="h-full rounded-full bg-accent"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: EASE }}
        />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -40 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          <h1 className="mt-8 font-display text-3xl md:text-4xl">{question.q}</h1>

          <motion.div
            className="mt-8 grid gap-3"
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.07, delayChildren: 0.1 } } }}
          >
            {question.options.map((opt) => (
              <motion.button
                key={opt.label}
                type="button"
                variants={{
                  hidden: { opacity: 0, y: 16 },
                  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
                }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => pick(opt.style)}
                disabled={saving}
                className="group flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-accent/60 hover:bg-accent/5 hover:shadow disabled:opacity-60"
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-border transition-colors group-hover:bg-accent" />
                {opt.label}
              </motion.button>
            ))}
          </motion.div>
        </motion.div>
      </AnimatePresence>

      <Button
        variant="ghost"
        className="mt-8"
        onClick={() => navigate({ to: "/dashboard" })}
        disabled={saving}
      >
        Skip for now
      </Button>
    </main>
  );
}
