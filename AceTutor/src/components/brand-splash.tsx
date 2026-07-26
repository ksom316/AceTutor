import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";

import { brand } from "@/theme";

// eslint-disable-next-line @typescript-eslint/no-require-imports -- RN static asset require is the idiomatic Expo pattern
const LOGO = require("@/assets/images/ace-logo.jpg");
const HOLD_MS = 1900;

/**
 * Branded animated splash overlay shown once on cold start: the ACE logo
 * inside a rotating gradient ring with the "Learn · Think · Achieve" tagline,
 * then a smooth fade-out. Renders nothing after it has finished.
 */
export function BrandSplash() {
  const [gone, setGone] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(0.82)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6, tension: 60 }).start();

    Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 5000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    ).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(halo, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(halo, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ]),
    ).start();

    Animated.timing(bar, {
      toValue: 1,
      duration: HOLD_MS - 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    const t = setTimeout(() => {
      Animated.timing(fade, {
        toValue: 0,
        duration: 550,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setGone(true));
    }, HOLD_MS);

    return () => clearTimeout(t);
  }, [fade, scale, spin, halo, bar]);

  if (gone) return null;

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const haloOpacity = halo.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.65] });
  const haloScale = halo.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.08] });
  const barWidth = bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.root, { opacity: fade }]}>
      <Animated.View style={{ alignItems: "center", transform: [{ scale }] }}>
        <View style={styles.ringWrap}>
          {/* Rotating gradient orbit ring */}
          <Animated.View style={[styles.ring, { transform: [{ rotate }] }]} />
          {/* Pulsing halo */}
          <Animated.View
            style={{
              position: "absolute",
              opacity: haloOpacity,
              transform: [{ scale: haloScale }],
            }}
          >
            <LinearGradient colors={[brand.cyan, brand.violet]} style={styles.halo} />
          </Animated.View>
          <Image source={LOGO} style={styles.logo} contentFit="contain" />
        </View>

        <Animated.Text style={styles.wordmark}>AceTutor</Animated.Text>

        <View style={styles.taglineRow}>
          <LinearGradient
            colors={["transparent", brand.cyan]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.line}
          />
          <Animated.Text style={styles.tagline}>Learn · Think · Achieve</Animated.Text>
          <LinearGradient
            colors={[brand.violet, "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.line}
          />
        </View>

        <View style={styles.track}>
          <Animated.View style={{ width: barWidth, height: "100%" }}>
            <LinearGradient
              colors={brand.gradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={{ flex: 1, borderRadius: 999 }}
            />
          </Animated.View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const RING = 176;
const styles = StyleSheet.create({
  root: {
    backgroundColor: brand.splashBg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  ringWrap: { width: RING, height: RING, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 3,
    borderColor: "transparent",
    borderTopColor: brand.cyan,
    borderRightColor: brand.indigo,
    borderBottomColor: brand.violet,
  },
  halo: { width: 130, height: 130, borderRadius: 28 },
  logo: { width: 112, height: 112, borderRadius: 26 },
  wordmark: { marginTop: 28, color: "#fff", fontSize: 30, fontWeight: "800", letterSpacing: -0.5 },
  taglineRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12 },
  line: { width: 36, height: 1.5, borderRadius: 1 },
  tagline: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  track: {
    marginTop: 36,
    width: 160,
    height: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.12)",
    overflow: "hidden",
  },
});
