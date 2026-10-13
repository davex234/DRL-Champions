"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "./client";
import type { Profile } from "./types";
import { authErrorMessage } from "./authErrors";
import { fetchOwnProfile } from "./ownProfile";
import { ns } from "@/i18n/runtime";
import { useLocale } from "@/i18n/react";

const t = ns("supabase");

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
  /** F67 · se llegó desde el enlace de «recuperar contraseña» (evento PASSWORD_RECOVERY): hay que pedir la nueva. */
  recovering: boolean;
  updatePassword: (password: string) => Promise<{ error?: string }>;
}

const NOT_CONFIGURED = { error: "Supabase no está configurado (modo local)" };

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * F64 · MISMO USUARIO, MISMO OBJETO. `getSession` y cada evento de `onAuthStateChange` (INITIAL_SESSION, TOKEN_REFRESHED…)
 * entregan un objeto `User` nuevo aunque nada haya cambiado; cada pantalla que dependía de `user` volvía a pedir sus
 * datos. Si el id, el correo y `updated_at` coinciden, se conserva el anterior.
 */
export function sameUser(a: User | null, b: User | null): boolean {
  if (!a || !b) return a === b;
  return a.id === b.id && a.email === b.email && a.updated_at === b.updated_at;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  useLocale();
  const configured = isSupabaseConfigured();
  const [loading, setLoading] = useState(configured);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recovering, setRecovering] = useState(false);

  /*
   * F64 · el perfil se pedía en `getSession` Y en el primer evento de sesión (dos lecturas de `profiles` al abrir cada
   * pantalla). Una lectura en vuelo por usuario se comparte, y en los 2 s siguientes no se repite salvo que se fuerce
   * (`refreshProfile`, tras una acción que lo cambia).
   */
  const profileRead = useRef<{ uid: string; at: number; p: Promise<void> } | null>(null);
  const loadProfile = useCallback((uid: string, force = false): Promise<void> => {
    const sb = getSupabase();
    if (!sb) return Promise.resolve();
    const cur = profileRead.current;
    if (!force && cur && cur.uid === uid && Date.now() - cur.at < 2_000) return cur.p;
    const p = (async () => {
      // F69 · por el servidor (`/api/game/me`): tras 0058 el REST de `profiles` solo da columnas públicas.
      const { data: s } = await sb.auth.getSession();
      const token = s.session?.access_token;
      setProfile(token ? await fetchOwnProfile(token, uid, force) : null);
    })();
    profileRead.current = { uid, at: Date.now(), p };
    return p;
  }, []);

  useEffect(() => {
    const sb = getSupabase();
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => {
      setUser((prev) => (sameUser(prev, data.session?.user ?? null) ? prev : data.session?.user ?? null));
      if (data.session?.user) loadProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      // F67 · el enlace del correo de recuperación abre una sesión temporal con este evento: toca fijar contraseña nueva.
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      setUser((prev) => (sameUser(prev, session?.user ?? null) ? prev : session?.user ?? null));
      if (session?.user) loadProfile(session.user.id);
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const signUp: AuthContextValue["signUp"] = useCallback(async (email, password, username) => {
    const sb = getSupabase();
    if (!sb) return NOT_CONFIGURED;
    // F67 · el enlace de confirmación vuelve al MISMO origen desde el que se registró (nada fijado a localhost).
    const emailRedirectTo = typeof window !== "undefined" ? `${window.location.origin}/cuenta` : undefined;
    const { error } = await sb.auth.signUp({ email, password, options: { data: { username }, emailRedirectTo } });
    return error ? { error: authErrorMessage(error) } : {}; // F68 · nunca el texto crudo de GoTrue
  }, []);

  const signIn: AuthContextValue["signIn"] = useCallback(async (email, password) => {
    const sb = getSupabase();
    if (!sb) return NOT_CONFIGURED;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    return error ? { error: authErrorMessage(error) } : {};
  }, []);

  const signOut = useCallback(async () => {
    await getSupabase()?.auth.signOut();
  }, []);

  const resetPassword: AuthContextValue["resetPassword"] = useCallback(async (email) => {
    const sb = getSupabase();
    if (!sb) return NOT_CONFIGURED;
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/cuenta` : undefined;
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    return error ? { error: authErrorMessage(error) } : {};
  }, []);

  const updatePassword: AuthContextValue["updatePassword"] = useCallback(async (password) => {
    const sb = getSupabase();
    if (!sb) return NOT_CONFIGURED;
    if (password.length < 8) return { error: t("La contraseña necesita al menos 8 caracteres.") };
    const { error } = await sb.auth.updateUser({ password });
    if (error) return { error: authErrorMessage(error) };
    setRecovering(false);
    return {};
  }, []);

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id, true);
  }, [user, loadProfile]);

  return (
    <AuthContext.Provider
      value={{ configured, loading, user, profile, signUp, signIn, signOut, resetPassword, refreshProfile, recovering, updatePassword }}
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
