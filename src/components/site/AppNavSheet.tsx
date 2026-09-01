import { useEffect, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import logoAsset from "@/assets/ace-logo.jpg";
import {
  BarChart3,
  BookOpen,
  ClipboardList,
  Gamepad2,
  Home,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Settings,
  User as UserIcon,
  Users,
} from "lucide-react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { cn } from "@/lib/utils";
import type { User } from "@supabase/supabase-js";

type NavItem = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
};

const studentItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/dashboard" },
  { label: "My Courses", icon: BookOpen, to: "/my-courses" },
  { label: "Progress & Analytics", icon: BarChart3, to: "/analytics" },
  { label: "Games", icon: Gamepad2, to: "/games" },
  { label: "Profile", icon: UserIcon, to: "/profile" },
  { label: "Settings", icon: Settings, to: "/settings" },
  { label: "Contact", icon: Mail, to: "/contact" },
];

// Lecturers navigate their own workspace (/lecturer/*); the route guard in
// routes/lecturer.tsx + RLS remain the security boundary, not this list.
const lecturerItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/lecturer" },
  { label: "Students", icon: Users, to: "/lecturer/students" },
  { label: "Materials", icon: BookOpen, to: "/lecturer/materials" },
  { label: "Quizzes", icon: ClipboardList, to: "/lecturer/quizzes" },
  { label: "Performance", icon: BarChart3, to: "/lecturer/performance" },
  { label: "Profile", icon: UserIcon, to: "/profile" },
  { label: "Settings", icon: Settings, to: "/settings" },
  { label: "Contact", icon: Mail, to: "/contact" },
];

export function AppNavSheet({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isLecturer } = useRole();

  const { data: profile } = useQuery({
    queryKey: ["nav-profile", user.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();
      return data;
    },
  });

  const { data: avatarUrl } = useQuery({
    queryKey: ["avatar-signed", profile?.avatar_url],
    enabled: !!profile?.avatar_url,
    queryFn: async () => {
      // Google OAuth avatars are full https URLs — use directly; only
      // storage paths need signing.
      if (profile!.avatar_url!.startsWith("http")) return profile!.avatar_url!;
      const { data, error } = await supabase.storage
        .from("avatars")
        .createSignedUrl(profile!.avatar_url!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });

  const items = isLecturer ? lecturerItems : studentItems;
  const displayName = profile?.full_name || user.email?.split("@")[0] || "Learner";
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const handleSignOut = async () => {
    setOpen(false);
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = pathname === item.to;
    const base = cn(
      "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
      active
        ? "bg-primary/10 text-primary"
        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
    );
    return (
      <Link key={item.label} to={item.to} className={base}>
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Open navigation menu"
          className="grid h-9 w-9 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>
      <SheetContent
        side="left"
        className="flex w-[18rem] flex-col gap-0 border-r bg-background p-0 sm:w-[20rem]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5">
          <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
            <img src={logoAsset} alt="AceTutor" width={32} height={32} className="object-contain" />
            <span className="text-base font-bold tracking-tight">AceTutor</span>
          </Link>
        </div>

        {/* Profile */}
        <div className="mx-5 mt-5 flex items-center gap-3 rounded-2xl border bg-card p-3">
          <Avatar className="h-11 w-11">
            <AvatarImage src={avatarUrl ?? undefined} alt={displayName} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{displayName}</div>
            <Badge variant="secondary" className="mt-0.5 text-[10px] uppercase">
              {isLecturer ? "Lecturer" : "Student"}
            </Badge>
          </div>
        </div>

        {/* Nav */}
        <ScrollArea className="mt-4 flex-1 px-3">
          <nav className="flex flex-col gap-1 pb-4">
            {!isLecturer && (
              <Link
                to="/"
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                  pathname === "/"
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                <Home className="h-4 w-4 shrink-0" />
                <span>Home</span>
              </Link>
            )}
            {items.map(renderItem)}
          </nav>

          <Separator className="my-1" />

          <nav className="flex flex-col gap-1 py-3">
            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span>Logout</span>
            </button>
          </nav>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
