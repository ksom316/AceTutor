import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowLeft, FileText } from "lucide-react";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms & Conditions — AceTutor" },
      {
        name: "description",
        content: "The terms and conditions governing your use of the AceTutor learning platform.",
      },
    ],
  }),
  component: TermsPage,
});

const sections = [
  {
    title: "1. Acceptance of Terms",
    body: "By creating an account or otherwise using AceTutor, you agree to be bound by these Terms & Conditions. If you do not agree with any part of these terms, please do not use the application. Continued use after changes to these terms constitutes acceptance of the updated terms.",
  },
  {
    title: "2. Eligibility",
    body: "AceTutor is intended for students, lecturers, and self-learners. You must provide accurate registration information and are responsible for keeping your account credentials secure. You may not share your account with others or use someone else's account without permission.",
  },
  {
    title: "3. Use of the Service",
    body: "AceTutor grants you a personal, non-exclusive, non-transferable licence to access its courses, quizzes, and AI-tutor features for your own learning. You agree not to misuse the service, attempt to disrupt it, reverse-engineer it, or use automated tools to extract content at scale.",
  },
  {
    title: "4. Learning Content & Accuracy",
    body: "Course materials, AI-generated explanations, and quiz feedback are provided for educational purposes only. While we strive for accuracy, AceTutor does not guarantee that all content is error-free, and it should not be relied upon as a substitute for official course materials or professional advice.",
  },
  {
    title: "5. User Conduct",
    body: "You agree to use AceTutor respectfully and lawfully. You will not upload harmful content, harass other users, infringe intellectual-property rights, or attempt to gain unauthorised access to other accounts or to the platform's systems.",
  },
  {
    title: "6. Intellectual Property",
    body: "All course content, branding, and software on AceTutor are owned by AceTutor or its licensors and are protected by applicable intellectual-property laws. You may not copy, redistribute, or create derivative works from this content without written permission.",
  },
  {
    title: "7. Account Suspension & Termination",
    body: "We reserve the right to suspend or terminate accounts that violate these terms, abuse the service, or pose a risk to other users. You may close your account at any time by contacting us.",
  },
  {
    title: "8. Limitation of Liability",
    body: "AceTutor is provided on an \"as is\" and \"as available\" basis. To the fullest extent permitted by law, we are not liable for any indirect or consequential loss arising from your use of, or inability to use, the service.",
  },
  {
    title: "9. Changes to These Terms",
    body: "We may update these Terms & Conditions from time to time. When we do, we will revise the \"last updated\" date below. Your continued use of AceTutor after changes take effect means you accept the revised terms.",
  },
  {
    title: "10. Contact",
    body: "If you have questions about these Terms & Conditions, please reach out through the Contact link in the footer or your institution's AceTutor administrator.",
  },
];

function TermsPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="relative overflow-hidden">
        {/* Ambient gradient glow */}
        <div className="absolute inset-x-0 top-0 -z-10 h-[420px] [background:radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklab,var(--color-primary)_16%,transparent),transparent_70%)]" />

        <div className="container mx-auto max-w-3xl px-4 pb-20 pt-10 md:pt-14">
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
              <FileText className="h-3 w-3" /> Legal
            </motion.span>

            <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">
              Terms &amp; <span className="text-primary">Conditions</span>
            </h1>
            <p className="mt-4 max-w-2xl text-muted-foreground md:text-lg">
              Please read these terms carefully before using AceTutor. They explain the rules and responsibilities that
              apply when you use the platform.
            </p>
          </motion.div>

          {/* Sections */}
          <div className="mt-12 space-y-4">
            {sections.map((s, i) => (
              <motion.section
                key={s.title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.45, delay: (i % 3) * 0.05 }}
                className="group relative rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
              >
                <span className="absolute left-0 top-6 h-7 w-1 rounded-r-full bg-primary/40 transition-all group-hover:h-10 group-hover:bg-primary" />
                <h2 className="text-lg font-semibold tracking-tight text-foreground">{s.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </motion.section>
            ))}
          </div>

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
