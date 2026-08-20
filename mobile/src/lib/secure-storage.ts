// Thin wrapper so the rest of the app has one storage API regardless of
// platform. expo-secure-store (Keychain/Keystore-backed) is native-only —
// its web implementation is an empty stub — so this falls back to
// localStorage there. That fallback is NOT secure storage; it exists only so
// `expo start --web` doesn't hard-crash, not as a supported deployment
// target (the app's target platform is native iOS/Android, per its brief).
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

async function get(key: string): Promise<string | null> {
  if (Platform.OS === "web") return globalThis.localStorage?.getItem(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function set(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function remove(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export const secureStorage = { get, set, remove };
