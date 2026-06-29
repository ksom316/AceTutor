import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { Card, GradientButton, Screen, Txt } from "@/components/ui";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { keys } from "@/lib/queries";
import { radius, useColors } from "@/theme";

type Modality = "text" | "video" | "audio";

const VARK_TO_MODALITY: Record<string, Modality> = {
  visual: "video",
  aural: "audio",
  read_write: "text",
  kinesthetic: "text",
};

const TABS: { k: Modality; icon: keyof typeof Ionicons.glyphMap; label: string }[] = [
  { k: "text", icon: "document-text-outline", label: "Read" },
  { k: "video", icon: "play-circle-outline", label: "Watch" },
  { k: "audio", icon: "headset-outline", label: "Listen" },
];

export default function TopicScreen() {
  const c = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { topicId } = useLocalSearchParams<{ topicId: string }>();
  const [modality, setModality] = useState<Modality>("text");

  const { data, isLoading } = useQuery({
    queryKey: keys.topic(topicId),
    queryFn: async () => {
      const { data: topic } = await supabase
        .from("topics")
        .select("id, title, summary, courses(title, slug)")
        .eq("id", topicId)
        .maybeSingle();
      const { data: lessons } = await supabase
        .from("lessons")
        .select("id, modality, title, body_md, media_url, duration_sec")
        .eq("topic_id", topicId)
        .order("order_index");
      return { topic, lessons: lessons ?? [] };
    },
  });

  const { data: profile } = useQuery({
    queryKey: ["profile-modality", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("vark_primary").eq("id", user!.id).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (profile?.vark_primary) setModality(VARK_TO_MODALITY[profile.vark_primary] ?? "text");
  }, [profile?.vark_primary]);

  const lesson = useMemo(() => data?.lessons.find((l: any) => l.modality === modality), [data, modality]);

  return (
    <Screen>
      <Stack.Screen options={{ headerShown: true, title: "", headerTintColor: c.text, headerStyle: { backgroundColor: c.bg } }} />

      {isLoading ? (
        <Txt variant="muted">Loading…</Txt>
      ) : (
        <>
          {data?.topic && (
            <View style={{ gap: 6 }}>
              <Txt variant="label">{(data.topic as any).courses?.title}</Txt>
              <Txt variant="h1">{data.topic.title}</Txt>
              {data.topic.summary ? <Txt variant="muted">{data.topic.summary}</Txt> : null}
            </View>
          )}

          {/* Modality switch */}
          <View
            style={{
              flexDirection: "row",
              backgroundColor: c.surface,
              borderRadius: radius.pill,
              padding: 4,
              alignSelf: "flex-start",
            }}
          >
            {TABS.map(({ k, icon, label }) => {
              const active = modality === k;
              const recommended = profile?.vark_primary && VARK_TO_MODALITY[profile.vark_primary] === k;
              return (
                <Pressable
                  key={k}
                  onPress={() => setModality(k)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: radius.pill,
                    backgroundColor: active ? c.primary : "transparent",
                  }}
                >
                  <Ionicons name={icon} size={15} color={active ? "#fff" : c.textMuted} />
                  <Txt variant="small" color={active ? "#fff" : c.textMuted} style={{ fontWeight: "700" }}>
                    {label}
                  </Txt>
                  {recommended ? <Ionicons name="sparkles" size={11} color={active ? "#fff" : c.primary} /> : null}
                </Pressable>
              );
            })}
          </View>

          {/* Lesson body */}
          <Card style={{ gap: 12 }}>
            {lesson ? (
              <>
                <Txt variant="h3">{lesson.title}</Txt>
                {lesson.modality === "text" && <Txt variant="body">{lesson.body_md ?? "No content."}</Txt>}
                {lesson.modality !== "text" && lesson.media_url ? (
                  <GradientButton
                    label={lesson.modality === "video" ? "Open video" : "Open audio"}
                    icon={lesson.modality === "video" ? "play" : "headset"}
                    onPress={() => WebBrowser.openBrowserAsync(lesson.media_url!)}
                  />
                ) : null}
                {lesson.modality !== "text" && lesson.body_md ? <Txt variant="muted">{lesson.body_md}</Txt> : null}
              </>
            ) : (
              <View style={{ alignItems: "center", gap: 8, paddingVertical: 16 }}>
                <Ionicons
                  name={modality === "video" ? "play-circle-outline" : modality === "audio" ? "headset-outline" : "document-text-outline"}
                  size={28}
                  color={c.textMuted}
                />
                <Txt variant="muted" style={{ textAlign: "center" }}>
                  No {modality === "text" ? "reading" : modality} lesson available for this topic yet. Try another format.
                </Txt>
              </View>
            )}
          </Card>

          <GradientButton label="Take the quiz" icon="arrow-forward" onPress={() => router.push(`/quiz/${topicId}`)} />
        </>
      )}
    </Screen>
  );
}
