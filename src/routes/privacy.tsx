import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowLeft, ShieldCheck, KeyRound, Eye, Database, Wifi, UserCheck, Lock } from "lucide-react";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy — AceTutor" },
      {
        name: "description",
        content: "Privacy tips and good practices to keep your AceTutor account and personal data safe.",
      },
    ],
  }),
  component: PrivacyPage,
});

const tips = [
  {
    icon: KeyRound,
    title: "Use a strong, unique password",
    body: "Choose a password you don't reuse anywhere else and combine letters, numbers, and symbols. A password manager can help you keep track of it safely.",
  },
  {
    icon: UserCheck,
    title: "Never share your account",
    body: "Your AceTutor account is personal. Don't share your login details, and always sign out when using a shared or public computer.",
  },
  {
    icon: Eye,
    title: "Be mindful of what you share",
    body: "Only provide the information needed for learning. Avoid posting sensitive personal details in profiles, quiz responses, or messages to the AI tutor.",
  },
  {
    icon: Database,
    title: "Know what data we keep",
    body: "We store your profile, learning style (VARK) results, course enrolments, and quiz attempts so we can personalise your lessons. This data is used to improve your learning experience, not sold to third parties.",
  },
  {
    icon: Wifi,
    title: "Stay safe on public networks",
    body: "When studying on public Wi-Fi, avoid entering sensitive information. AceTutor uses secure (HTTPS) connections, but a trusted network adds an extra layer of protection.",
  },
  {
    icon: ShieldCheck,
    title: "Watch out for phishing",
    body: "AceTutor will never ask for your password by email or message. If a link or request looks suspicious, don't click it — go directly to the app instead.",
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, delay: i * 0.07 },
  }),
};

function PrivacyPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="relative overflow-hidden">
        {/* Ambient gradient glow */}
        <div className="absolute inset-x-0 top-0 -z-10 h-[420px] [background:radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_16%,transparent),transparent_70%)]" />

        <div className="container mx-auto max-w-4xl px-4 pb-20 pt-10 md:pt-14">
          {/* Hero */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" /> Back to home
            </Link>

            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.4 }}
              className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
            >
              <Lock className="h-3 w-3" /> Your privacy
            </motion.span>

            <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">
              Privacy <span className="text-primary">Matters</span>
            </h1>
            <p className="mt-4 max-w-2xl text-muted-foreground md:text-lg">
              Here are some tips to take note of to keep your account and personal information safe while you learn with
              AceTutor.
            </p>
          </motion.div>

          {/* Tips grid */}
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {tips.map(({ icon: Icon, title, body }, i) => (
              <motion.div
                key={title}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-60px" }}
                whileHover={{ y: -4 }}
                className="group rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-sm transition-colors hover:border-primary/40 hover:shadow-lg"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                  <Icon className="h-5 w-5" />
                </span>
                <h2 className="mt-4 text-lg font-semibold text-foreground">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </motion.div>
            ))}
          </div>

          {/* Data control callout */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.5 }}
            className="mt-10 overflow-hidden rounded-2xl border border-primary/20 bg-linear-to-br from-primary/10 to-transparent p-6 md:p-8"
          >
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold tracking-tight">Your data, your control</h2>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              You can review or update your profile information at any time from your account settings. If you'd like to
              request deletion of your data or have any privacy concerns, reach out through the Contact link in the
              footer or your institution's AceTutor administrator.
            </p>
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="mt-12 border-t border-border/60 pt-6 text-xs text-muted-foreground"
          >
            Last updated: June 2026
          </motion.p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
