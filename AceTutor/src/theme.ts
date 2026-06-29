import { useColorScheme } from "react-native";

/** Fixed brand palette derived from the ACE logo (cyan → indigo → violet). */
export const brand = {
  cyan: "#22d3ee",
  indigo: "#6366f1",
  violet: "#a855f7",
  /** Gradient used for hero cards, the splash and primary buttons. */
  gradient: ["#22d3ee", "#6366f1", "#a855f7"] as const,
  splashBg: "#0a0e24",
} as const;

export type Palette = {
  bg: string;
  card: string;
  border: string;
  surface: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryFg: string;
  primarySoft: string;
  success: string;
  destructive: string;
  white: string;
};

const light: Palette = {
  bg: "#f7f7fb",
  card: "#ffffff",
  border: "#e6e7ee",
  surface: "#eef0f6",
  text: "#0c0a1a",
  textMuted: "#6b7280",
  primary: "#7c3aed",
  primaryFg: "#ffffff",
  primarySoft: "#f1eaff",
  success: "#16a34a",
  destructive: "#dc2626",
  white: "#ffffff",
};

const dark: Palette = {
  bg: "#0a0e1f",
  card: "#121833",
  border: "#222b4d",
  surface: "#161d3a",
  text: "#f5f7ff",
  textMuted: "#9aa6c4",
  primary: "#a855f7",
  primaryFg: "#ffffff",
  primarySoft: "#241640",
  success: "#22c55e",
  destructive: "#f87171",
  white: "#ffffff",
};

/** Returns the active palette for the current color scheme. */
export function useColors(): Palette {
  const scheme = useColorScheme();
  return scheme === "dark" ? dark : light;
}

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 } as const;
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
