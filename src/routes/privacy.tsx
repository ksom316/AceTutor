import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ShieldCheck, KeyRound, Eye, Database, Wifi, UserCheck, Lock } from "lucide-react";
import { LegalShell } from "@/components/site/LegalShell";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy — AceTutor" },
      {
        name: "description",
        content:
          "Privacy tips and good practices to keep your AceTutor account and personal data safe.",
      },
    ],
  }),
  component: PrivacyPage,
});

const tips = [
  {
    id: "strong-password",
    nav: "Strong password",
    icon: KeyRound,
    title: "Use a strong, unique password",
    body: "Choose a password you don't reuse anywhere else and combine letters, numbers, and symbols. A password manager can help you keep track of it safely.",
  },
  {
    id: "never-share",
    nav: "Never share your account",
    icon: UserCheck,
    title: "Never share your account",
    body: "Your AceTutor account is personal. Don't share your login details, and always sign out when using a shared or public computer.",
  },
  {
    id: "mindful-sharing",
    nav: "Mindful sharing",
    icon: Eye,
    title: "Be mindful of what you share",
    body: "Only provide the information needed for learning. Avoid posting sensitive personal details in profiles, quiz responses, or messages to the AI tutor.",
  },
  {
    id: "data-we-keep",
    nav: "What data we keep",
    icon: Database,
    title: "Know what data we keep",
    body: "We store your profile, learning preferences, course enrolments, and quiz attempts so we can personalise your lessons. This data is used to improve your learning experience, not sold to third parties.",
  },
  {
    id: "public-networks",
    nav: "Public networks",
    icon: Wifi,
    title: "Stay safe on public networks",
    body: "When studying on public Wi-Fi, avoid entering sensitive information. AceTutor uses secure (HTTPS) connections, but a trusted network adds an extra layer of protection.",
  },
  {
    id: "phishing",
    nav: "Watch for phishing",
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
    <LegalShell
      badge={{ icon: Lock, label: "Your privacy" }}
      titlePlain="Privacy"
      titleAccent="Matters"
      intro="Here are some tips to take note of to keep your account and personal information safe while you learn with AceTutor."
      toc={[
        ...tips.map((t) => ({ id: t.id, label: t.nav })),
        { id: "data-control", label: "Your data, your control" },
      ]}
      lastUpdated="June 2026"
    >
      {/* Tips grid */}
      <div className="grid gap-4 sm:grid-cols-2">
        {tips.map(({ id, icon: Icon, title, body }, i) => (
          <motion.div
            key={id}
            id={id}
            custom={i}
            variants={cardVariants}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, margin: "-60px" }}
            whileHover={{ y: -4 }}
            className="group scroll-mt-24 rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-sm transition-colors hover:border-primary/40 hover:shadow-lg"
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
        id="data-control"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 0.5 }}
        className="mt-10 scroll-mt-24 overflow-hidden rounded-2xl border border-primary/20 bg-linear-to-br from-primary/10 to-transparent p-6 md:p-8"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold tracking-tight">Your data, your control</h2>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          You can review or update your profile information at any time from your account settings.
          If you'd like to request deletion of your data or have any privacy concerns, reach out
          through the Contact link in the footer or your institution's AceTutor administrator.
        </p>
      </motion.div>
    </LegalShell>
  );
}
