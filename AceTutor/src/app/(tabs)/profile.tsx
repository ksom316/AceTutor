import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";

import { Button, Card, Screen, StatTile, TextField, Txt } from "@/components/ui";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { fetchEnrollments, fetchProfile, keys } from "@/lib/queries";
import { useColors } from "@/theme";

const VARK_LABEL: Record<string, string> = {
  visual: "Visual",
  aural: "Aural",
  read_write: "Read / Write",
  kinesthetic: "Kinesthetic",
};

export default function ProfileScreen() {
  const c = useColors();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: profile } = useQuery({
    queryKey: keys.profile(user?.id),
    enabled: !!user,
    queryFn: () => fetchProfile(user!.id),
  });
  const { data: enrolled } = useQuery({
    queryKey: keys.enrollments(user?.id),
    enabled: !!user,
    queryFn: fetchEnrollments,
  });

  const initials = (profile?.full_name ?? user?.email ?? "?")
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const saveName = async () => {
    if (!draft.trim() || !user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ full_name: draft.trim() }).eq("id", user.id);
    setSaving(false);
    if (error) {
      Alert.alert("Couldn't save", error.message);
      return;
    }
    setEditing(false);
    qc.invalidateQueries({ queryKey: keys.profile(user.id) });
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const confirmDelete = () => {
    // Permanent account deletion runs through a privileged server function on
    // the web app (service-role) that the mobile client can't safely call.
    Alert.alert(
      "Delete your account",
      "For your security, permanent deletion is handled from the AceTutor website under Profile → Danger zone. We'll sign you out here.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: signOut },
      ],
    );
  };

  return (
    <Screen>
      <Txt variant="h1">Your profile</Txt>

      {/* Avatar + name */}
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            backgroundColor: c.primarySoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Txt variant="h2" color={c.primary}>
            {initials}
          </Txt>
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          {editing ? (
            <View style={{ gap: 8 }}>
              <TextField value={draft} onChangeText={setDraft} placeholder="Your full name" autoFocus />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button label="Save" onPress={saveName} loading={saving} />
                <Button label="Cancel" variant="ghost" onPress={() => setEditing(false)} />
              </View>
            </View>
          ) : (
            <>
              <Txt variant="h3">{profile?.full_name ?? "Unnamed"}</Txt>
              <Txt variant="small">{user?.email}</Txt>
              <Pressable
                onPress={() => {
                  setDraft(profile?.full_name ?? "");
                  setEditing(true);
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}
              >
                <Ionicons name="pencil" size={13} color={c.primary} />
                <Txt variant="small" color={c.primary} style={{ fontWeight: "700" }}>
                  Edit name
                </Txt>
              </Pressable>
            </>
          )}
        </View>
      </Card>

      {/* Stats */}
      <View style={{ flexDirection: "row", gap: 12 }}>
        <StatTile icon="book-outline" label="Courses enrolled" value={String(enrolled?.length ?? 0)} />
        <StatTile
          icon="school-outline"
          label="Learning style"
          value={profile?.vark_primary ? VARK_LABEL[profile.vark_primary] ?? "Set" : "Not set"}
        />
      </View>

      <Pressable onPress={() => router.push("/onboarding-vark")}>
        <Card
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            backgroundColor: c.primarySoft,
            borderColor: c.primary + "44",
          }}
        >
          <Ionicons name="sparkles-outline" size={20} color={c.primary} />
          <Txt variant="title" style={{ flex: 1 }}>
            {profile?.vark_primary ? "Retake the VARK intake" : "Take the VARK intake"}
          </Txt>
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </Card>
      </Pressable>

      {/* Enrolled courses */}
      <Card style={{ gap: 8 }}>
        <Txt variant="h3">Your courses</Txt>
        {enrolled && enrolled.length > 0 ? (
          enrolled.map((course) => (
            <Pressable
              key={course.id}
              onPress={() => router.push(`/course/${course.slug}`)}
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                paddingVertical: 10,
                borderTopWidth: 1,
                borderTopColor: c.border,
              }}
            >
              <Txt variant="body" numberOfLines={1} style={{ flex: 1, paddingRight: 8 }}>
                {course.title}
              </Txt>
              <Ionicons name="chevron-forward" size={16} color={c.textMuted} />
            </Pressable>
          ))
        ) : (
          <Txt variant="muted">You haven't started any courses yet.</Txt>
        )}
      </Card>

      {/* Danger zone */}
      <Card style={{ gap: 12, borderColor: c.destructive + "55", backgroundColor: c.destructive + "0d" }}>
        <Txt variant="h3" color={c.destructive}>
          Account
        </Txt>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Button label="Sign out" icon="log-out-outline" variant="outline" onPress={signOut} />
          <Button label="Delete account" icon="trash-outline" variant="destructive" onPress={confirmDelete} />
        </View>
      </Card>
    </Screen>
  );
}
