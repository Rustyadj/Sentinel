import { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { View } from "react-native";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { colors } from "@/lib/theme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

/**
 * Session state decides which screens even exist in the navigator — a
 * logged-out user can't land on `rooms/[id]` by deep link or back-navigation,
 * because that screen isn't registered until `session` is truthy. `index.tsx`
 * (a plain, always-registered screen) is what actually points you at
 * `/rooms` or `/login` on launch; the Protected groups below are the hard
 * gate behind it.
 */
function RootNavigator() {
  const { isLoading, session } = useAuth();

  useEffect(() => {
    if (!isLoading) void SplashScreen.hideAsync();
  }, [isLoading]);

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.panel },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { color: colors.textPrimary },
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Protected guard={!session}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="rooms/index" options={{ title: "Sentinel" }} />
        <Stack.Screen name="rooms/[id]" options={{ title: "" }} />
      </Stack.Protected>
    </Stack>
  );
}
