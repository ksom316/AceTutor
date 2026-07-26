import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button, Card, GradientButton, ProgressBar, Txt } from "@/components/ui";
import { supabase } from "@/integrations/supabase/client";
import { generateQuizJson } from "@/lib/ai";
import { useAuth } from "@/lib/auth";
import { radius, useColors } from "@/theme";

// `correctIndex`/`explanation` only present for AI-generated questions (graded
// locally). Bank questions are graded server-side via grade_quiz.
type Q = {
  id: string;
  prompt: string;
  choices: string[];
  difficulty?: number;
  correctIndex?: number;
  explanation?: string;
};

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
  // AI mode: no bank questions, so questions were generated and are graded
  // locally (they aren't in the DB, so grade_quiz / the result screen can't
  // handle them). Results are shown inline instead.
  const [aiMode, setAiMode] = useState(false);
  const [aiResult, setAiResult] = useState<{ score: number; total: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data: topic } = await supabase
        .from("topics")
        .select("title, summary, courses(title, summary)")
        .eq("id", topicId)
        .maybeSingle();
      if (!active) return;
      setTopicTitle(topic?.title ?? "Quiz");

      const { data: qs, error } = await supabase.rpc("get_quiz_questions", {
        _topic_id: topicId,
        _limit: 5,
      });
      if (!active) return;
      if (error) {
        Alert.alert("Couldn't load questions", error.message);
        setLoading(false);
        return;
      }

      let loaded = (qs ?? []) as Q[];
      let usingAi = false;

      // No bank questions — fall back to an AI-generated quiz.
      if (loaded.length === 0) {
        const topicRow = topic as {
          title?: string;
          summary?: string;
          courses?: { title?: string; summary?: string };
        } | null;
        const course = topicRow?.courses;
        try {
          const quiz = await generateQuizJson({
            courseTitle: course?.title ?? topicRow?.title ?? "This course",
            courseSummary: course?.summary,
            moduleTitle: topicRow?.title,
            moduleSummary: topicRow?.summary,
          });
          if (!active) return;
          loaded = quiz.map((q, i) => ({
            id: `ai-${i}`,
            prompt: q.prompt,
            choices: q.choices,
            correctIndex: q.correctIndex,
            explanation: q.explanation,
          }));
          usingAi = loaded.length > 0;
        } catch (e) {
          if (!active) return;
          Alert.alert(
            "Couldn't generate a quiz",
            e instanceof Error ? e.message : "Please try again.",
          );
        }
      }

      setQuestions(loaded);
      setAiMode(usingAi);

      // Only open an attempt row when there's actually a quiz to take, so
      // visiting a topic with no questions doesn't write empty attempt rows.
      if (loaded.length > 0) {
        const { data: attempt, error: aErr } = await supabase
          .from("quiz_attempts")
          .insert({ user_id: user.id, topic_id: topicId })
          .select("id")
          .single();
        if (!active) return;
        if (aErr) Alert.alert("Error", aErr.message);
        else setAttemptId(attempt.id);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user, topicId]);

  const submit = async () => {
    if (!attemptId) return;
    setSubmitting(true);

    // AI mode: grade locally and persist the score on the attempt row.
    if (aiMode) {
      const score = questions.reduce((s, q) => (answers[q.id] === q.correctIndex ? s + 1 : s), 0);
      const total = questions.length;
      const { error } = await supabase
        .from("quiz_attempts")
        .update({ score, total, finished_at: new Date().toISOString() })
        .eq("id", attemptId);
      setSubmitting(false);
      if (error) {
        Alert.alert("Couldn't save", error.message);
        return;
      }
      setAiResult({ score, total });
      return;
    }

    const { error } = await supabase.rpc("grade_quiz", {
      _attempt_id: attemptId,
      _answers: answers,
    });
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
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: c.bg,
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
        }}
      >
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={c.primary} />
        <Txt variant="muted">Preparing your quiz…</Txt>
      </SafeAreaView>
    );
  }

  // AI-mode result — graded locally, shown inline.
  if (aiResult) {
    const pct = aiResult.total ? Math.round((aiResult.score / aiResult.total) * 100) : 0;
    const passed = pct >= 70;
    const headline =
      pct >= 90
        ? "Outstanding!"
        : pct >= 70
          ? "Great work!"
          : pct >= 50
            ? "Good effort!"
            : "Keep practicing!";
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
          <View
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <Txt variant="h3" numberOfLines={1} style={{ flex: 1 }}>
              {topicTitle}
            </Txt>
            <Pressable onPress={close} hitSlop={10}>
              <Ionicons name="close" size={26} color={c.textMuted} />
            </Pressable>
          </View>

          <Card style={{ alignItems: "center", gap: 8, paddingVertical: 28 }}>
            <View
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: passed ? c.success + "22" : c.primarySoft,
              }}
            >
              <Ionicons
                name={passed ? "trophy" : "sparkles"}
                size={28}
                color={passed ? c.success : c.primary}
              />
            </View>
            <Txt variant="label">AI practice quiz</Txt>
            <Txt variant="h3">{headline}</Txt>
            <Txt style={{ fontSize: 64, fontWeight: "800", color: c.primary }}>{pct}%</Txt>
            <Txt variant="muted">
              {aiResult.score} of {aiResult.total} correct · saved to your performance
            </Txt>
          </Card>

          {questions.map((qq, i) => {
            const sel = answers[qq.id];
            const ok = sel === qq.correctIndex;
            return (
              <Card key={qq.id} style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                  <Txt variant="body" style={{ flex: 1, fontWeight: "600" }}>
                    {i + 1}. {qq.prompt}
                  </Txt>
                  <Ionicons
                    name={ok ? "checkmark-circle" : "close-circle"}
                    size={20}
                    color={ok ? c.success : c.destructive}
                  />
                </View>
                <View style={{ gap: 6 }}>
                  {qq.choices.map((choice, ci) => {
                    const isCorrect = ci === qq.correctIndex;
                    const isWrongPick = ci === sel && !isCorrect;
                    return (
                      <View
                        key={ci}
                        style={{
                          padding: 10,
                          borderRadius: radius.md,
                          borderWidth: 1,
                          borderColor: isCorrect
                            ? c.success
                            : isWrongPick
                              ? c.destructive
                              : c.border,
                          backgroundColor: isCorrect
                            ? c.success + "18"
                            : isWrongPick
                              ? c.destructive + "18"
                              : "transparent",
                        }}
                      >
                        <Txt variant="small">{choice}</Txt>
                      </View>
                    );
                  })}
                </View>
                {qq.explanation ? (
                  <Txt variant="muted" style={{ fontSize: 13 }}>
                    Why: {qq.explanation}
                  </Txt>
                ) : null}
              </Card>
            );
          })}

          <GradientButton
            label="Retry"
            icon="refresh"
            onPress={() => {
              setAiResult(null);
              setAnswers({});
              setCurrent(0);
            }}
          />
          <Button label="Back to dashboard" variant="ghost" onPress={close} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (!q) {
    return (
      <SafeAreaView
        style={{
          flex: 1,
          backgroundColor: c.bg,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          gap: 12,
        }}
      >
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
        <View
          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
        >
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
                  <Txt
                    variant="small"
                    color={isSel ? "#fff" : c.textMuted}
                    style={{ fontWeight: "800" }}
                  >
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
            <Pressable
              onPress={() => setCurrent((n) => n - 1)}
              style={{ alignSelf: "center", padding: 8 }}
            >
              <Txt variant="small">← Previous question</Txt>
            </Pressable>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
