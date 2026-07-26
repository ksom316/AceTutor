import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { BookOpen, Brain, Headphones, Mail, Shield, Target } from "lucide-react";
import logoAsset from "@/assets/ace-logo.jpg";
import { fadeUp, staggerContainer, staggerItem } from "@/lib/motion";

export const Route = createFileRoute("/_authenticated/about")({
  component: AboutPage,
});

const APP_VERSION = "1.0.0";

const highlights = [
  {
    icon: Brain,
    title: "VARK-aware",
    body: "A quick intake classifies how you process information best.",
  },
  {
    icon: Headphones,
    title: "Three modalities",
    body: "Every topic ships as notes, an explainer video and an audio lesson.",
  },
  {
    icon: Target,
    title: "Adaptive quizzes",
    body: "Question difficulty scales with your rolling accuracy.",
  },
];

function AboutPage() {
  return (
    <main className="container mx-auto max-w-3xl px-4 py-12">
      {/* Identity card */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="overflow-hidden rounded-3xl border border-border bg-card"
      >
        <div className="relative bg-gradient-to-br from-primary via-primary to-[oklch(0.5_0.2_300)] p-8 text-primary-foreground">
          <div
            aria-hidden
            className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl"
          />
          <div
            aria-hidden
            className="absolute -bottom-16 -left-6 h-44 w-44 rounded-full bg-white/10 blur-2xl"
          />
          <div className="relative flex items-center gap-4">
            <img
              src={logoAsset}
              alt="AceTutor"
              width={64}
              height={64}
              className="h-16 w-16 shrink-0 rounded-2xl object-contain shadow-lg"
            />
            <div>
              <h1 className="font-display text-3xl leading-tight">AceTutor</h1>
              <p className="mt-1 text-sm text-primary-foreground/85">Version {APP_VERSION}</p>
            </div>
          </div>
        </div>

        <div className="p-6">
          <p className="text-sm leading-relaxed text-muted-foreground">
            AceTutor is a next-generation adaptive tutor that teaches every lesson the way you learn
            best. It adapts to your VARK learning style — switching between text, video and audio —
            and tests what you know with quizzes that get smarter as you do.
          </p>
        </div>
      </motion.section>

      {/* What it does */}
      <motion.section
        variants={staggerContainer}
        initial="hidden"
        animate="show"
        className="mt-6 grid gap-4 sm:grid-cols-3"
      >
        {highlights.map(({ icon: Icon, title, body }) => (
          <motion.div
            key={title}
            variants={staggerItem}
            className="rounded-2xl border border-border bg-card p-5"
          >
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" />
            </span>
            <h2 className="mt-3 text-sm font-semibold">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{body}</p>
          </motion.div>
        ))}
      </motion.section>

      {/* Details */}
      <motion.section
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="mt-6 overflow-hidden rounded-2xl border border-border bg-card"
      >
        <InfoRow label="Version" value={APP_VERSION} />
        <InfoRow label="Built at" value="KNUST — Kumasi, Ghana" />
        <InfoRow label="Made by" value="The AceTutor team" />
      </motion.section>

      {/* Links */}
      <motion.div
        variants={fadeUp}
        initial="hidden"
        animate="show"
        className="mt-6 flex flex-wrap gap-2"
      >
        <Link
          to="/contact"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Mail className="h-4 w-4" /> Contact
        </Link>
        <Link
          to="/privacy"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
        >
          <Shield className="h-4 w-4" /> Privacy
        </Link>
        <Link
          to="/terms"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
        >
          <BookOpen className="h-4 w-4" /> Terms
        </Link>
      </motion.div>

      <p className="mt-8 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} AceTutor. All rights reserved.
      </p>
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border px-5 py-4 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}
