import { Image } from "expo-image";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, View } from "react-native";

import { Button, GradientButton, Screen, TextField, Txt } from "@/components/ui";
import { supabase } from "@/integrations/supabase/client";
import { signInWithGoogle } from "@/lib/oauth";
import { brand, useColors } from "@/theme";

const LOGO = require("@/assets/images/ace-logo.jpg");

export default function LoginScreen() {
  const c = useColors();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const onLogin = async () => {
    if (!email.trim() || password.length < 6) {
      Alert.alert("Check your details", "Enter a valid email and a password of at least 6 characters.");
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (error) Alert.alert("Sign in failed", error.message);
    else router.replace("/dashboard");
  };

  const onForgot = async () => {
    if (!email.trim()) {
      Alert.alert("Email needed", "Type your email above first, then tap Forgot password.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
    if (error) Alert.alert("Couldn't send reset", error.message);
    else Alert.alert("Check your inbox", "We sent you a password reset link.");
  };

  const onGoogle = async () => {
    setGoogleLoading(true);
    try {
      const ok = await signInWithGoogle();
      if (ok) router.replace("/dashboard");
    } catch (e: any) {
      Alert.alert("Google sign-in failed", e.message ?? "Try again later.");
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ alignItems: "center", marginTop: 24, gap: 12 }}>
          <Image source={LOGO} style={{ width: 72, height: 72, borderRadius: 18 }} contentFit="contain" />
          <Txt variant="h1" style={{ textAlign: "center" }}>
            Welcome back
          </Txt>
          <Txt variant="muted" style={{ textAlign: "center" }}>
            Sign in to continue learning with AceTutor
          </Txt>
        </View>

        <View style={{ marginTop: 28, gap: 16 }}>
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

          <View style={{ alignItems: "flex-end" }}>
            <Txt variant="small" color={c.primary} onPress={onForgot} style={{ fontWeight: "700" }}>
              Forgot password?
            </Txt>
          </View>

          <GradientButton label="Sign in" icon="arrow-forward" onPress={onLogin} loading={loading} />

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
          <Txt variant="muted">New to AceTutor?</Txt>
          <Link href="/signup">
            <Txt variant="muted" color={brand.violet} style={{ fontWeight: "800" }}>
              Create an account
            </Txt>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
