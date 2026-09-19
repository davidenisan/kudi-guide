"use client";

import { useRouter } from "next/navigation";
import * as React from "react";

type AuthUser = {
  id: string;
  phone: string | null;
  nickname?: string | null;
  email?: string | null;
  username?: string | null;
  hasPassword?: boolean;
  transactionAlerts?: boolean;
};

type AuthContextValue = {
  user: AuthUser | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
  updateProfile: (values: {nickname?: string; username?: string; transactionAlerts?: boolean}) => Promise<void>;
};

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/me", {
        cache: "no-store",
      });

      if (!response.ok) {
        setUser(null);
        return;
      }

      const body = (await response.json()) as { user: AuthUser };
      setUser(body.user);
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function updateProfile(values: {nickname?: string; username?: string; transactionAlerts?: boolean}) {
    const response = await fetch("/api/profile", { method: "PATCH", headers: {"content-type":"application/json"}, body: JSON.stringify(values) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Could not save your profile.");
    setUser(body.user);
  }
  return (
    <AuthContext.Provider value={{ user, isLoading, refresh, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = React.useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}

export function useRequireAuth() {
  const router = useRouter();
  const auth = useAuth();

  React.useEffect(() => {
    if (!auth.isLoading && !auth.user) {
      router.replace("/onboarding");
    }
  }, [auth.isLoading, auth.user, router]);

  return auth;
}
