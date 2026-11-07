import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

export type StoreAccount = {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  role: "customer" | "administrator";
};

type AuthContextValue = {
  user: StoreAccount | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<StoreAccount>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ user: StoreAccount | null; requiresEmailConfirmation: boolean }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function authRequest<T>(path: string, body?: Record<string, string>): Promise<T> {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === "string" ? payload.error : "Account service is temporarily unavailable.";
    throw Object.assign(new Error(message), { status: response.status });
  }
  return payload as T;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StoreAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const previousId = useRef<string | null>(null);
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    try {
      const result = await authRequest<{ user: StoreAccount | null }>("/api/auth/session");
      const nextId = result.user?.id ?? null;
      if (previousId.current !== nextId) queryClient.clear();
      previousId.current = nextId;
      setUser(result.user);
      setError("");
    } catch {
      setError("Account service could not be reached. Please retry. / تعذر الوصول إلى خدمة الحسابات. يرجى المحاولة مجدداً.");
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

  useEffect(() => { void refresh(); }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await authRequest<{ user: StoreAccount }>("/api/auth/sign-in", { email, password });
    previousId.current = result.user.id;
    setUser(result.user);
    setError("");
    queryClient.clear();
    return result.user;
  }, [queryClient]);

  const signUp = useCallback(async (email: string, password: string, displayName: string) => {
    const result = await authRequest<{ user: StoreAccount | null; requiresEmailConfirmation: boolean }>(
      "/api/auth/sign-up", { email, password, displayName },
    );
    if (result.user) {
      previousId.current = result.user.id;
      setUser(result.user);
      queryClient.clear();
    }
    setError("");
    return result;
  }, [queryClient]);

  const signOut = useCallback(async () => {
    await authRequest<{ user: null }>("/api/auth/sign-out", {});
    previousId.current = null;
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  return <AuthContext.Provider value={{ user, loading, error, refresh, signIn, signUp, signOut }}>
    {children}
  </AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider.");
  return value;
}
