import { Redirect } from "expo-router";
import { View } from "react-native";

import { useAuth } from "@/lib/auth";
import { brand } from "@/theme";

/** Entry gate: route to the app if signed in, otherwise to login. */
export default function Index() {
  const { user, loading } = useAuth();

  // While the session resolves, the BrandSplash overlay is still covering us.
  if (loading) return <View style={{ flex: 1, backgroundColor: brand.splashBg }} />;

  return <Redirect href={user ? "/dashboard" : "/login"} />;
}
