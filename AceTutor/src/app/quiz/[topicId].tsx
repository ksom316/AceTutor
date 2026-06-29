import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { GradientButton, ProgressBar, Txt } from "@/components/ui";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { radius, useColors } from "@/theme";

type Q = { id: string; prompt: string; choices: string[]; difficulty: number };

export default function QuizRunner() {
  const c = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { topicId } = useLocalSearchParams<{ topicId: string }>();

  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<Q[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data: topic } = await supabase.from("topics").select("title").eq("id", topicId).maybeSingle();
      if (!active) return;
      setTopicTitle(topic?.title ?? "Quiz");

      const { data: qs, error } = await supabase.rpc("get_quiz_questions", { _topic_id: topicId, _limit: 5 });
      if (!active) return;
      if (error) {
        Alert.alert("Couldn't load questions", error.message);
        setLoading(false);
        return;
      }
      setQuestions((qs ?? []) as Q[]);

      const { data: attempt, error: aErr } = await supabase
        .from("quiz_attempts")
        .insert({ user_id: user.id, topic_id: topicId })
        .select("id")
        .single();
      if (!active) return;
      if (aErr) Alert.alert("Error", aErr.message);
      else setAttemptId(attempt.id);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user, topicId]);

  const submit = async () => {
    if (!attemptId) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("grade_quiz", { _attempt_id: attemptId, _answers: answers });
    setSubmitting(false);
    if (error) {
      Alert.alert("Couldn't grade", error.message);
      return;
    }
    router.replace(`/result/${attemptId}`);
  };

  const total = questions.length;
  const q = questions[current];
  const isLast = current === total - 1;
  const selected = q ? answers[q.id] : undefined;
  const hasAnswer = selected !== undefined;

  const next = () => {
    if (!hasAnswer) return;
    if (isLast) submit();
    else setCurrent((n) => n + 1);
  };

  const close = () => router.replace("/dashboard");

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", gap: 12 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={c.primary} />
        <Txt variant="muted">Preparing your quiz…</Txt>
      </SafeAreaView>
    );
  }

  if (!q) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <Ionicons name="help-circle-outline" size={40} color={c.textMuted} />
        <Txt variant="h2" style={{ textAlign: "center" }}>
          No questions yet
        </Txt>
        <Txt variant="muted" style={{ textAlign: "center" }}>
          This topic has no quiz questions published yet. Check back soon.
        </Txt>
        <GradientButton label="Back to dashboard" onPress={close} full={false} />
      </SafeAreaView>
    );
  }

  const progressValue = ((current + (hasAnswer ? 1 : 0)) / total) * 100;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Txt variant="h3" numberOfLines={1} style={{ flex: 1 }}>
            {topicTitle}
          </Txt>
          <Pressable onPress={close} hitSlop={10}>
            <Ionicons name="close" size={26} color={c.textMuted} />
          </Pressable>
        </View>
        <ProgressBar value={progressValue} height={6} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 20, flexGrow: 1 }}>
        <Txt variant="label">
          Question {current + 1} of {total}
        </Txt>
        <Txt variant="h1">{q.prompt}</Txt>

        <View style={{ gap: 12 }}>
          {q.choices.map((choice, ci) => {
            const isSel = selected === ci;
            return (
              <Pressable
                key={ci}
                onPress={() => setAnswers({ ...answers, [q.id]: ci })}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                  padding: 16,
                  borderRadius: radius.lg,
                  borderWidth: 2,
                  borderColor: isSel ? c.primary : c.border,
                  backgroundColor: isSel ? c.primarySoft : c.card,
                }}
              >
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: isSel ? c.primary : "transparent",
                    borderWidth: isSel ? 0 : 1,
                    borderColor: c.border,
                  }}
                >
                  <Txt variant="small" color={isSel ? "#fff" : c.textMuted} style={{ fontWeight: "800" }}>
                    {String.fromCharCode(65 + ci)}
                  </Txt>
                </View>
                <Txt variant="body" style={{ flex: 1 }}>
                  {choice}
                </Txt>
              </Pressable>
            );
          })}
        </View>

        <View style={{ marginTop: "auto", gap: 10 }}>
          <GradientButton
            label={submitting ? "Grading…" : isLast ? "Finish quiz" : "Next question"}
            onPress={next}
            disabled={!hasAnswer}
            loading={submitting}
          />
          {current > 0 && !submitting && (
            <Pressable onPress={() => setCurrent((n) => n - 1)} style={{ alignSelf: "center", padding: 8 }}>
              <Txt variant="small">← Previous question</Txt>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
