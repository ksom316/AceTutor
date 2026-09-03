import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { useColorScheme } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { BrandSplash } from "@/components/brand-splash";
import { AuthProvider } from "@/lib/auth";

// Keep the native splash up until React is ready; the JS BrandSplash then takes over.
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 300, fade: true });

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function RootLayout() {
  const scheme = useColorScheme();

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style={scheme === "dark" ? "light" : "dark"} />
          <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="login" />
            <Stack.Screen name="signup" />
            <Stack.Screen name="onboarding-vark" options={{ presentation: "modal" }} />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="course/[slug]" />
            <Stack.Screen name="topic/[topicId]" />
            <Stack.Screen name="quiz/[topicId]" options={{ presentation: "fullScreenModal" }} />
            <Stack.Screen name="result/[attemptId]" />
          </Stack>
          <BrandSplash />
        </AuthProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
