import { Link } from "@tanstack/react-router";
import logoAsset from "@/assets/ace-logo.jpg";

const links = [
  { label: "Teachers", to: "/" },
  { label: "Privacy", to: "/privacy" },
  { label: "Terms", to: "/terms" },
  { label: "Contact", to: "/contact" },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border/60 bg-background/40">
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <Link to="/" className="group flex items-center gap-2">
            <img
              src={logoAsset}
              alt="AceTutor"
              width={32}
              height={32}
              className="rounded-lg object-contain transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3"
            />
            <span className="font-semibold transition-colors group-hover:text-primary">AceTutor</span>
          </Link>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {links.map((l) => (
              <Link
                key={l.label}
                to={l.to}
                className="relative transition-colors after:absolute after:-bottom-0.5 after:left-0 after:h-px after:w-0 after:bg-primary after:transition-all hover:text-foreground hover:after:w-full"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <p className="text-sm text-muted-foreground">© {new Date().getFullYear()} AceTutor · KNUST</p>
        </div>
      </div>
    </footer>
  );
}
