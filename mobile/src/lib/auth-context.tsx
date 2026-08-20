import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, login as apiLogin, normalizeBaseUrl, type Session } from "./api";
import { secureStorage } from "./secure-storage";

const STORAGE_KEY = "sentinel.session";

interface StoredSession {
  baseUrl: string;
  token: string;
  user: { id: string; email: string; name: string | null };
}

interface AuthContextValue {
  /** True while restoring a persisted session on launch — screens should
   * hold off rendering auth-dependent UI until this clears. */
  isLoading: boolean;
  session: Session | null;
  user: StoredSession["user"] | null;
  login: (baseUrl: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Screens call this from a catch block; on a 401 it clears the session
   * (the token is dead — expired, revoked, or the account changed) so the
   * next render sends the user back to the login screen instead of a
   * silently-broken room list. Returns whether it handled the error. */
  handleUnauthorized: (error: unknown) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [stored, setStored] = useState<StoredSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const raw = await secureStorage.get(STORAGE_KEY);
        if (raw && !cancelled) setStored(JSON.parse(raw) as StoredSession);
      } catch {
        // Corrupt or unreadable — treat as logged out rather than crash launch.
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (baseUrl: string, email: string, password: string) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const { token, user } = await apiLogin(normalized, email, password);
    const next: StoredSession = { baseUrl: normalized, token, user };
    await secureStorage.set(STORAGE_KEY, JSON.stringify(next));
    setStored(next);
  }, []);

  const logout = useCallback(async () => {
    await secureStorage.remove(STORAGE_KEY);
    setStored(null);
  }, []);

  const handleUnauthorized = useCallback(
    (error: unknown): boolean => {
      if (error instanceof ApiError && error.status === 401) {
        void logout();
        return true;
      }
      return false;
    },
    [logout],
  );

  const session = useMemo<Session | null>(
    () => (stored ? { baseUrl: stored.baseUrl, token: stored.token } : null),
    [stored],
  );

  const value = useMemo<AuthContextValue>(
    () => ({ isLoading, session, user: stored?.user ?? null, login, logout, handleUnauthorized }),
    [isLoading, session, stored, login, logout, handleUnauthorized],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
