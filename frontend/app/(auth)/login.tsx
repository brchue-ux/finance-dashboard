import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { COLORS, GRADIENT } from "@/constants/theme";
import { signIn } from "@/lib/auth";

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(tabs)");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={{ flex: 1, backgroundColor: COLORS.background }}
    >
      <View style={{ flex: 1, justifyContent: "center", padding: 24 }}>
        {/* Logo / wordmark */}
        <View style={{ marginBottom: 48 }}>
          <LinearGradient
            colors={GRADIENT.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ borderRadius: 12, padding: 12, alignSelf: "flex-start", marginBottom: 16 }}
          >
            <Text style={{ color: "#fff", fontSize: 24, fontWeight: "800" }}>₿</Text>
          </LinearGradient>
          <Text style={{ color: COLORS.textPrimary, fontSize: 28, fontWeight: "800" }}>
            Finance Dashboard
          </Text>
          <Text style={{ color: COLORS.textMuted, fontSize: 15, marginTop: 4 }}>
            Your personal finance intelligence layer
          </Text>
        </View>

        {/* Email */}
        <Text style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 6 }}>Email</Text>
        <TextInput
          style={{
            backgroundColor: COLORS.glassBg,
            borderWidth: 1,
            borderColor: COLORS.glassBorder,
            borderRadius: 12,
            padding: 14,
            color: COLORS.textPrimary,
            fontSize: 15,
            marginBottom: 16,
          }}
          placeholder="you@example.com"
          placeholderTextColor={COLORS.textMuted}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />

        {/* Password */}
        <Text style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: 6 }}>Password</Text>
        <TextInput
          style={{
            backgroundColor: COLORS.glassBg,
            borderWidth: 1,
            borderColor: COLORS.glassBorder,
            borderRadius: 12,
            padding: 14,
            color: COLORS.textPrimary,
            fontSize: 15,
            marginBottom: 24,
          }}
          placeholder="••••••••"
          placeholderTextColor={COLORS.textMuted}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
        />

        {error && (
          <Text style={{ color: COLORS.danger, fontSize: 13, marginBottom: 16 }}>{error}</Text>
        )}

        {/* Sign in button */}
        <Pressable onPress={handleSignIn} disabled={loading}>
          <LinearGradient
            colors={GRADIENT.brand}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{
              borderRadius: 14,
              paddingVertical: 16,
              alignItems: "center",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>Sign In</Text>
            )}
          </LinearGradient>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
