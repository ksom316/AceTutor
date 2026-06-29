import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";

import { supabase } from "@/integrations/supabase/client";

WebBrowser.maybeCompleteAuthSession();

/**
 * Native Google OAuth via Supabase. Opens the system auth browser and
 * exchanges the returned tokens for a session. Requires the Google provider
 * (and the `acetutor://` redirect) to be enabled in Supabase Auth settings.
 */
export async function signInWithGoogle() {
  const redirectTo = Linking.createURL("/");
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("Could not start Google sign-in");

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") return false; // user dismissed

  const { params, errorCode } = parseUrl(result.url);
  if (errorCode) throw new Error(errorCode);

  const { access_token, refresh_token } = params;
  if (!access_token || !refresh_token) throw new Error("Sign-in did not return a session");

  const { error: sessErr } = await supabase.auth.setSession({ access_token, refresh_token });
  if (sessErr) throw sessErr;
  return true;
}

function parseUrl(url: string) {
  // Supabase returns tokens in the URL fragment (#access_token=...&refresh_token=...)
  const fragment = url.includes("#") ? url.split("#")[1] : url.split("?")[1] ?? "";
  const params: Record<string, string> = {};
  for (const pair of fragment.split("&")) {
    const [k, v] = pair.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
  }
  return { params, errorCode: params.error_description || params.error || null };
}
