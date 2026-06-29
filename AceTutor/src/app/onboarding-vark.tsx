import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { Card, ProgressBar, Screen, Txt } from "@/components/ui";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { radius, useColors } from "@/theme";

type Style = "visual" | "aural" | "read_write" | "kinesthetic";

const QUESTIONS: { q: string; options: { label: string; style: Style }[] }[] = [
  { q: "When learning a new algorithm, you prefer to…", options: [
    { label: "Watch an animated walkthrough", style: "visual" },
    { label: "Listen to an explanation", style: "aural" },
    { label: "Read the textbook chapter", style: "read_write" },
    { label: "Code it from scratch immediately", style: "kinesthetic" }] },
  { q: "You remember best when…", options: [
    { label: "You see diagrams or flowcharts", style: "visual" },
    { label: "Someone talks it through with you", style: "aural" },
    { label: "You write notes in your own words", style: "read_write" },
    { label: "You apply it in a project", style: "kinesthetic" }] },
  { q: "Studying for an exam, you would…", options: [
    { label: "Make a mind map", style: "visual" },
    { label: "Record yourself and listen back", style: "aural" },
    { label: "Rewrite summary notes", style: "read_write" },
    { label: "Solve past papers hands-on", style: "kinesthetic" }] },
  { q: "A confusing concept becomes clear when…", options: [
    { label: "You see it visualized", style: "visual" },
    { label: "A friend explains aloud", style: "aural" },
    { label: "You read multiple sources", style: "read_write" },
    { label: "You try it yourself", style: "kinesthetic" }] },
  { q: "Given an hour to learn TCP/IP, you…", options: [
    { label: "Watch an explainer video", style: "visual" },
    { label: "Listen to a podcast", style: "aural" },
    { label: "Read the RFC summary", style: "read_write" },
    { label: "Inspect packets with Wireshark", style: "kinesthetic" }] },
  { q: "Group projects: your favourite role is…", options: [
    { label: "Designer / diagrammer", style: "visual" },
    { label: "Presenter / explainer", style: "aural" },
    { label: "Documentation lead", style: "read_write" },
    { label: "Implementer / coder", style: "kinesthetic" }] },
  { q: "When stuck on a bug you…", options: [
    { label: "Draw the data flow", style: "visual" },
    { label: "Talk through it aloud", style: "aural" },
    { label: "Read the docs end-to-end", style: "read_write" },
    { label: "Add prints and re-run", style: "kinesthetic" }] },
  { q: "A great lecture for you has…", options: [
    { label: "Lots of slides and visuals", style: "visual" },
    { label: "A clear, engaging speaker", style: "aural" },
    { label: "Solid handouts to read", style: "read_write" },
    { label: "Live coding demos", style: "kinesthetic" }] },
  { q: "Your study notes are mostly…", options: [
    { label: "Sketches and diagrams", style: "visual" },
    { label: "Voice memos", style: "aural" },
    { label: "Prose and bullet lists", style: "read_write" },
    { label: "Working code samples", style: "kinesthetic" }] },
  { q: "You'd rather review SQL by…", options: [
    { label: "Looking at an ER diagram", style: "visual" },
    { label: "Hearing a colleague explain it", style: "aural" },
    { label: "Reading documentation", style: "read_write" },
    { label: "Writing queries on real data", style: "kinesthetic" }] },
  { q: "Long-form content you prefer:", options: [
    { label: "Infographics", style: "visual" },
    { label: "Podcasts", style: "aural" },
    { label: "Articles & books", style: "read_write" },
    { label: "Hands-on tutorials", style: "kinesthetic" }] },
  { q: "You explain ideas to others by…", options: [
    { label: "Drawing on a whiteboard", style: "visual" },
    { label: "Speaking and storytelling", style: "aural" },
    { label: "Writing them down", style: "read_write" },
    { label: "Demoing the working thing", style: "kinesthetic" }] },
  { q: "New programming language? You…", options: [
    { label: "Watch a syntax tour video", style: "visual" },
    { label: "Listen to an interview about it", style: "aural" },
    { label: "Skim the official guide", style: "read_write" },
    { label: "Build a tiny project", style: "kinesthetic" }] },
  { q: "Conferences: you remember most…", options: [
    { label: "The slide visuals", style: "visual" },
    { label: "The speaker's voice and stories", style: "aural" },
    { label: "The handout / blog write-up", style: "read_write" },
    { label: "The hands-on workshops", style: "kinesthetic" }] },
  { q: "Math proofs feel clearest when…", options: [
    { label: "Drawn out step-by-step", style: "visual" },
    { label: "Explained verbally", style: "aural" },
    { label: "Read carefully line by line", style: "read_write" },
    { label: "Worked through on paper", style: "kinesthetic" }] },
  { q: "Your dream learning tool would be…", options: [
    { label: "An interactive diagram", style: "visual" },
    { label: "A personal voice tutor", style: "aural" },
    { label: "A perfect textbook", style: "read_write" },
    { label: "A live sandbox to tinker in", style: "kinesthetic" }] },
];

export default function VarkOnboarding() {
  const c = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Style[]>([]);
  const [saving, setSaving] = useState(false);

  const question = QUESTIONS[step];
  const progress = (step / QUESTIONS.length) * 100;

  const finish = () => router.replace("/dashboard");

  const pick = async (style: Style) => {
    const updated = [...answers, style];
    setAnswers(updated);
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }
    const scores: Record<Style, number> = { visual: 0, aural: 0, read_write: 0, kinesthetic: 0 };
    updated.forEach((s) => (scores[s] += 1));
    const primary = (Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]) as Style;

    if (!user) return finish();
    setSaving(true);
    try {
      await supabase.from("vark_responses").insert({
        user_id: user.id,
        answers: updated,
        computed_style: primary,
      });
      await supabase.from("profiles").update({ vark_primary: primary, vark_scores: scores }).eq("id", user.id);
    } catch (e: any) {
      Alert.alert("Couldn't save", e.message ?? "Try again.");
    } finally {
      setSaving(false);
      finish();
    }
  };

  return (
    <Screen scroll={false}>
      <View style={{ flex: 1, gap: 16 }}>
        <Txt variant="label">
          Question {step + 1} of {QUESTIONS.length}
        </Txt>
        <ProgressBar value={progress} />

        <Txt variant="h2" style={{ marginTop: 12 }}>
          {question.q}
        </Txt>

        <View style={{ gap: 12, marginTop: 8 }}>
          {question.options.map((opt) => (
            <Pressable key={opt.label} onPress={() => pick(opt.style)} disabled={saving}>
              {({ pressed }) => (
                <Card
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    opacity: saving ? 0.6 : pressed ? 0.85 : 1,
                    borderColor: pressed ? c.primary : c.border,
                  }}
                >
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.primary }} />
                  <Txt variant="body" style={{ flex: 1 }}>
                    {opt.label}
                  </Txt>
                </Card>
              )}
            </Pressable>
          ))}
        </View>

        <Pressable onPress={finish} disabled={saving} style={{ marginTop: "auto", paddingVertical: 12 }}>
          <Txt variant="muted" style={{ textAlign: "center", borderRadius: radius.md }}>
            Skip for now
          </Txt>
        </Pressable>
      </View>
    </Screen>
  );
}
