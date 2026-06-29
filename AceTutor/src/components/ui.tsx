import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  type TextProps,
  View,
  type ViewProps,
} from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";

import { brand, radius, space, useColors, type Palette } from "@/theme";

/* ------------------------------- Text ------------------------------- */

type TxtVariant = "h1" | "h2" | "h3" | "title" | "body" | "muted" | "label" | "small";

export function Txt({
  variant = "body",
  color,
  style,
  ...rest
}: TextProps & { variant?: TxtVariant; color?: string }) {
  const c = useColors();
  const map: Record<TxtVariant, object> = {
    h1: { fontSize: 32, fontWeight: "800", color: c.text, letterSpacing: -0.5 },
    h2: { fontSize: 24, fontWeight: "700", color: c.text, letterSpacing: -0.3 },
    h3: { fontSize: 18, fontWeight: "700", color: c.text },
    title: { fontSize: 16, fontWeight: "600", color: c.text },
    body: { fontSize: 15, fontWeight: "500", color: c.text, lineHeight: 22 },
    muted: { fontSize: 14, fontWeight: "500", color: c.textMuted, lineHeight: 20 },
    label: { fontSize: 12, fontWeight: "700", color: c.textMuted, letterSpacing: 1, textTransform: "uppercase" },
    small: { fontSize: 12, fontWeight: "500", color: c.textMuted },
  };
  return <Text style={[map[variant], color ? { color } : null, style]} {...rest} />;
}

/* ------------------------------ Screen ------------------------------ */

export function Screen({
  children,
  scroll = true,
  edges = ["top", "bottom"],
  contentStyle,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  contentStyle?: ViewProps["style"];
}) {
  const c = useColors();
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[{ padding: space.lg, paddingBottom: 96, gap: space.lg }, contentStyle]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, padding: space.lg }, contentStyle]}>{children}</View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={edges}>
      {body}
    </SafeAreaView>
  );
}

/* ------------------------------- Card ------------------------------- */

export function Card({ style, children, ...rest }: ViewProps) {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderColor: c.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.lg,
          padding: space.lg,
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </View>
  );
}

/* ------------------------------ Button ------------------------------ */

type BtnProps = {
  label: string;
  onPress?: () => void;
  variant?: "primary" | "outline" | "ghost" | "destructive";
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
};

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading,
  disabled,
  full,
}: BtnProps) {
  const c = useColors();
  const isSolid = variant === "primary" || variant === "destructive";
  const bg =
    variant === "primary"
      ? c.primary
      : variant === "destructive"
        ? c.destructive
        : "transparent";
  const fg = isSolid ? "#fff" : variant === "ghost" ? c.text : c.primary;
  const border = variant === "outline" ? c.border : "transparent";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor: border,
          borderWidth: variant === "outline" ? StyleSheet.hairlineWidth : 0,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: full ? "stretch" : "flex-start",
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
          <Text style={{ color: fg, fontWeight: "700", fontSize: 15 }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Brand gradient button for hero CTAs. */
export function GradientButton({
  label,
  onPress,
  icon,
  loading,
  disabled,
  full = true,
}: Omit<BtnProps, "variant">) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        { alignSelf: full ? "stretch" : "flex-start", opacity: disabled ? 0.5 : pressed ? 0.9 : 1 },
      ]}
    >
      <LinearGradient
        colors={brand.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.btn}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={18} color="#fff" /> : null}
            <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

/* ------------------------------ Badge ------------------------------- */

export function Badge({ label, tone = "primary" }: { label: string; tone?: "primary" | "muted" | "success" }) {
  const c = useColors();
  const bg = tone === "success" ? c.success + "22" : tone === "muted" ? c.surface : c.primarySoft;
  const fg = tone === "success" ? c.success : tone === "muted" ? c.textMuted : c.primary;
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill }}>
      <Text style={{ color: fg, fontWeight: "700", fontSize: 11 }}>{label}</Text>
    </View>
  );
}

/* --------------------------- ProgressBar ---------------------------- */

export function ProgressBar({ value, height = 8 }: { value: number; height?: number }) {
  const c = useColors();
  const pct = Math.max(0, Math.min(100, value));
  return (
    <View style={{ height, backgroundColor: c.surface, borderRadius: radius.pill, overflow: "hidden" }}>
      <View style={{ width: `${pct}%`, height: "100%", backgroundColor: c.primary, borderRadius: radius.pill }} />
    </View>
  );
}

/* --------------------------- Text field ----------------------------- */

export function TextField({
  label,
  icon,
  style,
  ...rest
}: TextInputProps & { label?: string; icon?: keyof typeof Ionicons.glyphMap }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Txt variant="label">{label}</Txt> : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: c.card,
          borderColor: c.border,
          borderWidth: StyleSheet.hairlineWidth,
          borderRadius: radius.md,
          paddingHorizontal: 12,
        }}
      >
        {icon ? <Ionicons name={icon} size={18} color={c.textMuted} /> : null}
        <TextInput
          placeholderTextColor={c.textMuted}
          style={[{ flex: 1, paddingVertical: 12, color: c.text, fontSize: 15 }, style]}
          {...rest}
        />
      </View>
    </View>
  );
}

/* --------------------------- Stat tile ------------------------------ */

export function StatTile({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
}) {
  const c = useColors();
  return (
    <Card style={{ flex: 1, padding: space.md, gap: 6, minWidth: 140 }}>
      <Ionicons name={icon} size={18} color={c.primary} />
      <Txt variant="h2">{value}</Txt>
      <Txt variant="small">{label}</Txt>
    </Card>
  );
}

/* --------------------------- Empty state ---------------------------- */

export function EmptyState({
  icon = "sparkles-outline",
  title,
  body,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  body?: string;
}) {
  const c = useColors();
  return (
    <Card style={{ alignItems: "center", gap: 8, borderStyle: "dashed" }}>
      <Ionicons name={icon} size={28} color={c.textMuted} />
      <Txt variant="title" style={{ textAlign: "center" }}>
        {title}
      </Txt>
      {body ? (
        <Txt variant="muted" style={{ textAlign: "center" }}>
          {body}
        </Txt>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 50,
    paddingHorizontal: 20,
    borderRadius: radius.md,
  },
});
