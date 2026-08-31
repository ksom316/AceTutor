import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpen,
  Gamepad2,
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useRole } from "@/hooks/use-role";
import type { User } from "@supabase/supabase-js";

type NavItem = {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
};

const studentItems: NavItem[] = [
  { label: "Home", icon: Home, to: "/" },
  { label: "Dashboard", icon: LayoutDashboard, to: "/dashboard" },
  { label: "My Courses", icon: BookOpen, to: "/my-courses" },
  { label: "Progress & Analytics", icon: BarChart3, to: "/analytics" },
  { label: "Games", icon: Gamepad2, to: "/games" },
];

const lecturerItems: NavItem[] = [
  { label: "Home", icon: Home, to: "/" },
  { label: "Dashboard", icon: LayoutDashboard, to: "/dashboard" },
  { label: "Course Management", icon: BookOpen, to: "/courses" },
  { label: "Student Analytics", icon: Users, to: "/analytics" },
  { label: "Games", icon: Gamepad2, to: "/games" },
];

const accountItems: NavItem[] = [
  { label: "Profile", icon: UserIcon, to: "/profile" },
  { label: "Settings", icon: Settings, to: "/settings" },
  { label: "Contact", icon: Mail, to: "/contact" },
];

export function AppSidebar({ user }: { user: User }) {
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
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <SidebarMenuItem key={item.label}>
        <SidebarMenuButton asChild isActive={isActive(item.to)} tooltip={item.label}>
          <Link to={item.to}>
            <Icon className="h-4 w-4" />
            <span>{item.label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="px-3 py-4">
        <Link to="/" className="flex items-center gap-2.5 px-1">
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
        {!isLecturer && (
          <Link
            to="/onboarding/vark"
            className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/15 group-data-[collapsible=icon]:hidden"
          >
            <GraduationCap className="h-4 w-4 shrink-0" />
            <span className="truncate">Personalize with VARK</span>
          </Link>
        )}
        <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card p-2">
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
          <button
            type="button"
            onClick={handleSignOut}
            aria-label="Sign out"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive group-data-[collapsible=icon]:hidden"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
