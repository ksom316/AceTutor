import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  BookOpen,
  ClipboardList,
  Gamepad2,
  Gauge,
  GraduationCap,
  Home,
  LayoutDashboard,
  LogOut,
  Mail,
  Settings,
  User as UserIcon,
  Users,
} from "lucide-react";
import logoAsset from "@/assets/ace-logo.jpg";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import { useNotifications } from "@/hooks/use-notifications";
import type { User } from "@supabase/supabase-js";

type NavItem = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  /** Match this route only on an exact pathname, not its descendants. */
  exact?: boolean;
};

const studentItems: NavItem[] = [
  { label: "Home", icon: Home, to: "/" },
  { label: "Dashboard", icon: LayoutDashboard, to: "/dashboard" },
  { label: "My Courses", icon: BookOpen, to: "/my-courses" },
  { label: "Progress & Analytics", icon: BarChart3, to: "/analytics" },
  { label: "Notifications", icon: Bell, to: "/notifications" },
  { label: "Games", icon: Gamepad2, to: "/games" },
];

// Lecturers navigate their own workspace (/lecturer/*), not the student pages.
// The route guard in routes/lecturer.tsx + RLS remain the security boundary.
const lecturerItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, to: "/lecturer", exact: true },
  { label: "Students", icon: Users, to: "/lecturer/students" },
  { label: "Materials", icon: BookOpen, to: "/lecturer/materials" },
  { label: "Quizzes", icon: ClipboardList, to: "/lecturer/quizzes" },
  { label: "Performance", icon: BarChart3, to: "/lecturer/performance" },
  { label: "Evaluation", icon: Gauge, to: "/lecturer/evaluation" },
  { label: "Notifications", icon: Bell, to: "/lecturer/notifications" },
];

const NOTIFICATION_PATHS = new Set(["/notifications", "/lecturer/notifications"]);

const accountItems: NavItem[] = [
  { label: "Profile", icon: UserIcon, to: "/profile" },
  { label: "Settings", icon: Settings, to: "/settings" },
  { label: "Contact", icon: Mail, to: "/contact" },
];

export function AppSidebar({ user }: { user: User }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isLecturer } = useRole();
  const { unreadCount } = useNotifications();
  const { isMobile, setOpenMobile } = useSidebar();
  // Close the mobile drawer after a nav tap (desktop is unaffected).
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

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

  // Student-only: hide the "Learning preferences" footer nudge once any
  // preference is set. Never queried for lecturers.
  const { data: learningPrefs } = useQuery({
    queryKey: ["learning-preferences", user.id],
    enabled: !isLecturer,
    queryFn: async () => {
      const { data } = await supabase
        .from("learning_preferences")
        .select("explanation_style, lesson_format, wrong_answer_help")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
  });
  const hasPreferences = !!(
    learningPrefs?.explanation_style ||
    learningPrefs?.lesson_format ||
    learningPrefs?.wrong_answer_help
  );

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
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const isActive = (to: string, exact = false) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(to + "/");

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const showUnread = NOTIFICATION_PATHS.has(item.to) && unreadCount > 0;
    return (
      <SidebarMenuItem key={item.label}>
        <SidebarMenuButton asChild isActive={isActive(item.to, item.exact)} tooltip={item.label}>
          <Link to={item.to} onClick={closeMobile}>
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
        {showUnread && (
          <SidebarMenuBadge className="bg-primary text-primary-foreground">
            {unreadCount > 9 ? "9+" : unreadCount}
          </SidebarMenuBadge>
        )}
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="px-3 py-4">
        <Link to="/" onClick={closeMobile} className="flex items-center gap-2.5 px-1">
          <img
            src={logoAsset}
            alt="AceTutor"
            width={34}
            height={34}
            className="shrink-0 rounded-xl object-contain shadow-sm"
          />
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate text-sm font-bold leading-tight tracking-tight">
              AceTutor
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {isLecturer ? "Teacher workspace" : "Student workspace"}
            </span>
          </div>
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Menu</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{items.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>{accountItems.map(renderItem)}</SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2">
        {!isLecturer && !hasPreferences && (
          <Link
            to="/onboarding/preferences"
            onClick={closeMobile}
            className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 group-data-[collapsible=icon]:hidden"
          >
            <GraduationCap className="h-4 w-4 shrink-0" />
            <span className="truncate">Set your learning preferences</span>
          </Link>
        )}
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:p-0">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarImage src={avatarUrl ?? undefined} alt={displayName} />
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-xs font-semibold">{displayName}</div>
            <div className="truncate text-[11px] capitalize text-muted-foreground">
              {isLecturer ? "Teacher" : "Student"}
            </div>
          </div>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              aria-label="Sign out"
              title="Sign out"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className="group-data-[collapsible=icon]:hidden">Sign out</span>
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Sign out?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to sign out of AceTutor?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleSignOut}>Sign out</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
