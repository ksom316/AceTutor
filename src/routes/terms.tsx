import { createFileRoute } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { FileText, MessageCircleQuestion } from "lucide-react";
import { LegalShell } from "@/components/site/LegalShell";

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
    id: "acceptance",
    nav: "Acceptance",
    title: "1. Acceptance of Terms",
    body: "By creating an account or otherwise using AceTutor, you agree to be bound by these Terms & Conditions. If you do not agree with any part of these terms, please do not use the application. Continued use after changes to these terms constitutes acceptance of the updated terms.",
  },
  {
    id: "eligibility",
    nav: "Eligibility",
    title: "2. Eligibility",
    body: "AceTutor is intended for students, lecturers, and self-learners. You must provide accurate registration information and are responsible for keeping your account credentials secure. You may not share your account with others or use someone else's account without permission.",
  },
  {
    id: "use-of-service",
    nav: "Use of the Service",
    title: "3. Use of the Service",
    body: "AceTutor grants you a personal, non-exclusive, non-transferable licence to access its courses, quizzes, and AI-tutor features for your own learning. You agree not to misuse the service, attempt to disrupt it, reverse-engineer it, or use automated tools to extract content at scale.",
  },
  {
    id: "content-accuracy",
    nav: "Content & Accuracy",
    title: "4. Learning Content & Accuracy",
    body: "Course materials, AI-generated explanations, and quiz feedback are provided for educational purposes only. While we strive for accuracy, AceTutor does not guarantee that all content is error-free, and it should not be relied upon as a substitute for official course materials or professional advice.",
  },
  {
    id: "user-conduct",
    nav: "User Conduct",
    title: "5. User Conduct",
    body: "You agree to use AceTutor respectfully and lawfully. You will not upload harmful content, harass other users, infringe intellectual-property rights, or attempt to gain unauthorised access to other accounts or to the platform's systems.",
  },
  {
    id: "intellectual-property",
    nav: "Intellectual Property",
    title: "6. Intellectual Property",
    body: "All course content, branding, and software on AceTutor are owned by AceTutor or its licensors and are protected by applicable intellectual-property laws. You may not copy, redistribute, or create derivative works from this content without written permission.",
  },
  {
    id: "termination",
    nav: "Suspension & Termination",
    title: "7. Account Suspension & Termination",
    body: "We reserve the right to suspend or terminate accounts that violate these terms, abuse the service, or pose a risk to other users. You may close your account at any time by contacting us.",
  },
  {
    id: "liability",
    nav: "Limitation of Liability",
    title: "8. Limitation of Liability",
    body: 'AceTutor is provided on an "as is" and "as available" basis. To the fullest extent permitted by law, we are not liable for any indirect or consequential loss arising from your use of, or inability to use, the service.',
  },
  {
    id: "changes",
    nav: "Changes to Terms",
    title: "9. Changes to These Terms",
    body: 'We may update these Terms & Conditions from time to time. When we do, we will revise the "last updated" date below. Your continued use of AceTutor after changes take effect means you accept the revised terms.',
  },
  {
    id: "contact",
    nav: "Contact",
    title: "10. Contact",
    body: "If you have questions about these Terms & Conditions, please reach out through the Contact link in the footer or your institution's AceTutor administrator.",
  },
];

function TermsPage() {
  return (
    <LegalShell
      badge={{ icon: FileText, label: "Legal" }}
      titlePlain="Terms &"
      titleAccent="Conditions"
      intro="Please read these terms carefully before using AceTutor. They explain the rules and responsibilities that apply when you use the platform."
      toc={sections.map((s) => ({ id: s.id, label: s.nav }))}
      lastUpdated="June 2026"
    >
      <div className="space-y-4">
        {sections.map((s, i) => (
          <motion.section
            key={s.id}
            id={s.id}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 0.45, delay: (i % 3) * 0.05 }}
            className="group relative scroll-mt-24 rounded-2xl border border-border bg-card/60 p-6 backdrop-blur-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg"
          >
            <span className="absolute left-0 top-6 h-7 w-1 rounded-r-full bg-primary/40 transition-all group-hover:h-10 group-hover:bg-primary" />
            <h2 className="text-lg font-semibold tracking-tight text-foreground">{s.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          </motion.section>
        ))}

        {/* Closing callout */}
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.5 }}
          className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent p-6 md:p-8"
        >
          <div className="flex items-center gap-2">
            <MessageCircleQuestion className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold tracking-tight">Questions about these terms?</h2>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Reach out through the Contact link in the footer or your institution's AceTutor
            administrator and we'll be happy to help clarify anything.
          </p>
        </motion.div>
      </div>
    </LegalShell>
  );
}
