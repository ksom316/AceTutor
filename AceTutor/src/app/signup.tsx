import { Image } from "expo-image";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, View } from "react-native";

import { Button, GradientButton, Screen, TextField, Txt } from "@/components/ui";
import { supabase } from "@/integrations/supabase/client";
import { signInWithGoogle } from "@/lib/oauth";
import { brand, useColors } from "@/theme";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- RN static asset require is the idiomatic Expo pattern
const LOGO = require("@/assets/images/ace-logo.jpg");

export default function SignupScreen() {
  const c = useColors();
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const onSignup = async () => {
    if (!fullName.trim() || !email.trim() || password.length < 6) {
      Alert.alert(
        "Check your details",
        "Enter your name, a valid email, and a 6+ character password.",
      );
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { full_name: fullName.trim() } },
    });
    setLoading(false);
    if (error) {
      Alert.alert("Sign up failed", error.message);
      return;
    }
    router.replace("/onboarding-vark");
  };

  const onGoogle = async () => {
    setGoogleLoading(true);
    try {
      const ok = await signInWithGoogle();
      if (ok) router.replace("/onboarding-vark");
    } catch (e) {
      Alert.alert("Google sign-in failed", e instanceof Error ? e.message : "Try again later.");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ alignItems: "center", marginTop: 24, gap: 12 }}>
          <Image
            source={LOGO}
            style={{ width: 72, height: 72, borderRadius: 18 }}
            contentFit="contain"
          />
          <Txt variant="h1" style={{ textAlign: "center" }}>
            Join AceTutor
          </Txt>
          <Txt variant="muted" style={{ textAlign: "center" }}>
            Create your free account in under a minute
          </Txt>
        </View>

        <View style={{ marginTop: 28, gap: 16 }}>
          <TextField
            label="Full name"
            icon="person-outline"
            placeholder="Jane Doe"
            value={fullName}
            onChangeText={setFullName}
          />
          <TextField
            label="Email"
            icon="mail-outline"
            placeholder="you@school.edu"
            autoCapitalize="none"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
          />
          <TextField
            label="Password"
            icon="lock-closed-outline"
            placeholder="••••••••"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <GradientButton
            label="Create account"
            icon="arrow-forward"
            onPress={onSignup}
            loading={loading}
          />

          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
            <Txt variant="small">OR</Txt>
            <View style={{ flex: 1, height: 1, backgroundColor: c.border }} />
          </View>

          <Button
            label="Continue with Google"
            icon="logo-google"
            variant="outline"
            full
            onPress={onGoogle}
            loading={googleLoading}
          />
        </View>

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 28 }}>
          <Txt variant="muted">Already a member?</Txt>
          <Link href="/login">
            <Txt variant="muted" color={brand.violet} style={{ fontWeight: "800" }}>
              Sign in
            </Txt>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
