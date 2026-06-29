import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Check, Clock, Copy, Mail, MapPin, MessageCircle, Phone, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Header } from "@/components/site/Header";
import { Footer } from "@/components/site/Footer";
import { Button } from "@/components/ui/button";
import { fadeUp, staggerContainer, staggerItem, viewportOnce } from "@/lib/motion";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Us — AceTutor" },
      { name: "description", content: "Get in touch with the AceTutor team by phone or email — we usually reply within 24 hours." },
    ],
  }),
  component: ContactPage,
});

const phones = ["+(233) 554456646", "+(233) 245056526", "+(233) 504249568"];
const emails = ["giftydomi72@gmail.com", "terrykwakudoe@gmail.com", "ksom316@gmail.com"];

const quickFacts = [
  { icon: Clock, title: "Fast replies", body: "We usually respond within 24 hours." },
  { icon: MapPin, title: "Based at KNUST", body: "Kumasi, Ghana — building AceTutor on campus." },
  { icon: MessageCircle, title: "Friendly support", body: "Questions, feedback, or partnerships — all welcome." },
];

/** Strips formatting to a dialable tel: href, preserving the leading +. */
function telHref(display: string) {
  const digits = display.replace(/[^\d]/g, "");
  return `tel:+${digits}`;
}

function ContactPage() {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="relative overflow-hidden">
        {/* Ambient gradient glow + floating orbs */}
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
          {/* Hero */}
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
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
              <Sparkles className="h-3 w-3" /> Get in touch
            </motion.span>

            <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">
              Contact <span className="text-primary">Us</span>
            </h1>
            <p className="mt-4 max-w-2xl text-muted-foreground md:text-lg">
              Have a question, some feedback, or just want to say hi? Reach the AceTutor team through any of the numbers
              or email addresses below — we'd love to hear from you.
            </p>
          </motion.div>

          {/* Body: info panel + contact methods */}
          <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_1.6fr]">
            {/* Gradient info panel */}
            <motion.aside
              variants={fadeUp}
              initial="hidden"
              whileInView="show"
              viewport={viewportOnce}
              className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary via-primary to-[oklch(0.5_0.2_300)] p-7 text-primary-foreground shadow-lg md:p-8"
            >
              <div aria-hidden className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" />
              <div aria-hidden className="absolute -bottom-16 -left-6 h-44 w-44 rounded-full bg-white/10 blur-2xl" />
              <h2 className="relative font-display text-2xl leading-tight md:text-3xl">We'd love to hear from you</h2>
              <p className="relative mt-2 text-sm text-primary-foreground/85">
                Whether you're a student, lecturer, or just curious about adaptive learning, our door is always open.
              </p>

              <motion.ul
                variants={staggerContainer}
                initial="hidden"
                whileInView="show"
                viewport={viewportOnce}
                className="relative mt-7 space-y-4"
              >
                {quickFacts.map(({ icon: Icon, title, body }) => (
                  <motion.li key={title} variants={staggerItem} className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 backdrop-blur-sm">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="text-xs text-primary-foreground/80">{body}</p>
                    </div>
                  </motion.li>
                ))}
              </motion.ul>

              <Button
                asChild
                size="lg"
                className="relative mt-8 h-11 rounded-full bg-white px-5 text-sm font-semibold text-primary hover:bg-white/90"
              >
                <a href={`mailto:${emails[0]}`}>
                  <Send className="mr-2 h-4 w-4" /> Send us an email
                </a>
              </Button>
            </motion.aside>

            {/* Contact methods */}
            <div className="space-y-8">
              {/* Phones */}
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Phone className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">Call us</h2>
                    <p className="text-xs text-muted-foreground">Tap a number to call, or copy it.</p>
                  </div>
                </div>
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  whileInView="show"
                  viewport={viewportOnce}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {phones.map((p) => (
                    <ContactRow key={p} href={telHref(p)} value={p} label="Phone" icon={Phone} copyValue={p} />
                  ))}
                </motion.div>
              </section>

              {/* Emails */}
              <section>
                <div className="mb-4 flex items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
                    <Mail className="h-5 w-5" />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight">Email us</h2>
                    <p className="text-xs text-muted-foreground">Tap to compose, or copy the address.</p>
                  </div>
                </div>
                <motion.div
                  variants={staggerContainer}
                  initial="hidden"
                  whileInView="show"
                  viewport={viewportOnce}
                  className="grid gap-3"
                >
                  {emails.map((e) => (
                    <ContactRow key={e} href={`mailto:${e}`} value={e} label="Email" icon={Mail} copyValue={e} />
                  ))}
                </motion.div>
              </section>
            </div>
          </div>

          {/* Closing CTA band */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            whileInView="show"
            viewport={viewportOnce}
            className="mt-14 overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-br from-primary/10 to-transparent p-8 text-center md:p-12"
          >
            <h2 className="text-2xl font-bold tracking-tight md:text-3xl">Ready to start learning?</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground md:text-base">
              Create your free account and let AceTutor adapt to the way you learn — while you wait for our reply.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button asChild size="lg" className="h-12 rounded-full px-6 text-base">
                <Link to="/signup">Get Started Free</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-12 rounded-full px-6 text-base">
                <Link to="/courses">Browse courses</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

/** A single tappable contact method with an inline copy-to-clipboard button. */
function ContactRow({
  href,
  value,
  label,
  icon: Icon,
  copyValue,
}: {
  href: string;
  value: string;
  label: string;
  icon: typeof Phone;
  copyValue: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy — please copy manually");
    }
  };

  return (
    <motion.div
      variants={staggerItem}
      whileHover={{ y: -3 }}
      className="group flex items-center gap-3 rounded-2xl border border-border bg-card/60 p-4 backdrop-blur-sm transition-all hover:border-primary/40 hover:shadow-lg"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
        <Icon className="h-5 w-5" />
      </span>
      <a href={href} className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
          {value}
        </p>
      </a>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label.toLowerCase()}`}
        className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </button>
    </motion.div>
  );
}
