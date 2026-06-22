"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./client";
import type { Profile } from "./types";

interface AuthContextValue {
  configured: boolean;
  loading: boolean;
  user: User | null;
  profile: Profile | null;
  signUp: (email: string, password: string, username: string) => Promise<{ error?: string }>;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error?: string }>;
  refreshProfile: () => Promise<void>;
}

const NOT_CONFIGURED = { error: "Supabase no está configurado (modo local)" };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = useCallback(async (uid: string) => {
    const sb = getSupabase();
    if (!sb) return;
    const { data } = await sb.from("profiles").select("*").eq("id", uid).single();
    setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      if (data.session?.user) loadProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null);
      if (session?.user) loadProfile(session.user.id);
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signUp: AuthContextValue["signUp"] = useCallback(async (email, password, username) => {
    const sb = getSupabase();
    if (!sb) return NOT_CONFIGURED;
    const { error } = await sb.auth.signUp({ email, password, options: { data: { username } } });
    return error ? { error: error.message } : {};
  }, []);

  const signIn: AuthContextValue["signIn"] = useCallback(async (email, password) => {
    const sb = getSupabase();
    if (!sb) return NOT_CONFIGURED;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error ? { error: error.message } : {};
  }, []);

  const signOut = useCallback(async () => {
    await getSupabase()?.auth.signOut();
  }, []);

  const resetPassword: AuthContextValue["resetPassword"] = useCallback(async (email) => {
    const sb = getSupabase();
    if (!sb) return NOT_CONFIGURED;
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/cuenta` : undefined;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    return error ? { error: error.message } : {};
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  return (
    <AuthContext.Provider
      value={{ configured, loading, user, profile, signUp, signIn, signOut, resetPassword, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}
