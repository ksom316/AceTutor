import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

import type { Database } from "./types";

// Anon key is a public client credential — safe to ship in the app bundle.
// Values come from .env (EXPO_PUBLIC_* are inlined by Expo at build time);
// the literals are a fallback so the app always boots in development.
const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? "https://tyovhoocreumdmwcakmr.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR5b3Zob29jcmV1bWRtd2Nha21yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0OTUyMTksImV4cCI6MjA5NDA3MTIxOX0.yUJ_klYJj3wJ59ZbF1vig_27MfFUAmkx8BbrQ0a--Fw";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No URL-based session detection on native.
    detectSessionInUrl: false,
  },
});
