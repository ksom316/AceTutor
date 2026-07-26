import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";

import { Button, Card, GradientButton, Screen, Txt } from "@/components/ui";
import { supabase } from "@/integrations/supabase/client";
import { keys } from "@/lib/queries";
import { radius, useColors } from "@/theme";

type AttemptDetail = {
  id: string;
  score: number | null;
  total: number | null;
  topic_id: string;
  topics: { title: string } | null;
};
type AnswerRow = {
  question_id: string;
  selected_index: number;
  is_correct: boolean;
  questions: {
    prompt: string;
    choices: string[];
    correct_index: number;
    explanation: string | null;
  };
};

export default function ResultScreen() {
  const c = useColors();
  const router = useRouter();
  const { attemptId } = useLocalSearchParams<{ attemptId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: keys.result(attemptId),
    queryFn: async () => {
      const { data: attempt } = await supabase
        .from("quiz_attempts")
        .select("id, score, total, topic_id, topics(title)")
        .eq("id", attemptId)
        .maybeSingle();
      const { data: answers } = await supabase
        .from("attempt_answers")
        .select(
          "question_id, selected_index, is_correct, questions(prompt, choices, correct_index, explanation)",
        )
        .eq("attempt_id", attemptId);
      return {
        attempt: (attempt ?? null) as unknown as AttemptDetail | null,
        answers: (answers ?? []) as unknown as AnswerRow[],
      };
    },
  });

  if (isLoading || !data?.attempt) {
    return (
      <Screen scroll={false}>
        <Stack.Screen
          options={{
            headerShown: true,
            title: "Results",
            headerTintColor: c.text,
            headerStyle: { backgroundColor: c.bg },
          }}
        />
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <ActivityIndicator color={c.primary} />
          <Txt variant="muted">Loading your results…</Txt>
        </View>
      </Screen>
    );
  }

  const attempt = data.attempt;
  const pct = attempt.total ? Math.round(((attempt.score ?? 0) / attempt.total) * 100) : 0;
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
    <Screen>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Results",
          headerTintColor: c.text,
          headerStyle: { backgroundColor: c.bg },
        }}
      />

      <Txt variant="h2">{attempt.topics?.title}</Txt>

      {/* Score hero */}
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
        <Txt variant="h3">{headline}</Txt>
        <Txt style={{ fontSize: 64, fontWeight: "800", color: c.primary }}>{pct}%</Txt>
        <Txt variant="muted">
          {attempt.score} of {attempt.total} correct
        </Txt>
      </Card>

      {/* Answer breakdown */}
      <Txt variant="h3">Review</Txt>
      {data.answers.map((a, idx) => {
        const correctIdx = a.questions.correct_index;
        return (
          <Card key={a.question_id ?? idx} style={{ gap: 10 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Txt variant="body" style={{ flex: 1 }}>
                {a.questions.prompt}
              </Txt>
              <Ionicons
                name={a.is_correct ? "checkmark-circle" : "close-circle"}
                size={20}
                color={a.is_correct ? c.success : c.destructive}
              />
            </View>
            <View style={{ gap: 6 }}>
              {(a.questions.choices as string[]).map((choice, i) => {
                const isCorrect = i === correctIdx;
                const isWrongPick = i === a.selected_index && !a.is_correct;
                return (
                  <View
                    key={i}
                    style={{
                      padding: 10,
                      borderRadius: radius.sm,
                      borderWidth: 1,
                      borderColor: isCorrect ? c.success : isWrongPick ? c.destructive : c.border,
                      backgroundColor: isCorrect
                        ? c.success + "14"
                        : isWrongPick
                          ? c.destructive + "14"
                          : "transparent",
                    }}
                  >
                    <Txt variant="small" color={c.text}>
                      {choice}
                    </Txt>
                  </View>
                );
              })}
            </View>
            {a.questions.explanation ? (
              <View style={{ backgroundColor: c.surface, borderRadius: radius.sm, padding: 10 }}>
                <Txt variant="small">
                  <Txt variant="small" color={c.text} style={{ fontWeight: "800" }}>
                    Why:{" "}
                  </Txt>
                  {a.questions.explanation}
                </Txt>
              </View>
            ) : null}
          </Card>
        );
      })}

      <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
        <GradientButton
          label="Retry"
          icon="refresh"
          onPress={() => router.replace(`/quiz/${attempt.topic_id}`)}
          full={false}
        />
        <Button label="Dashboard" variant="outline" onPress={() => router.replace("/dashboard")} />
      </View>
    </Screen>
  );
}
