"use client";

/**
 * FASE 63 · ONBOARDING — CLIENTE.
 *
 *   · `fetchOnboarding` → `GET /api/game/onboarding` (Bearer; nunca un `userId` en la petición).
 *   · `postOnboarding`  → `POST /api/game/onboarding { action }` (el servidor relee sus hechos y decide).
 *   · `useOnboarding`   → foto COMPARTIDA entre pantallas (un almacén de módulo por usuario, caché de 20 s): ir de la
 *                         colección al sobre y del sobre al equipo no repite la lectura, y una orden la actualiza en
 *                         todas las pantallas montadas a la vez.
 *
 * El cliente no decide pasos: los pinta. Sin sesión, sin Supabase o si el servidor falla, la guía simplemente no aparece
 * (el juego funciona igual). Nada se guarda en `localStorage`: el estado vive en el servidor.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import type { OnboardingCommand, OnboardingView } from "@/domain/onboarding";

export type { OnboardingView };

export const ONBOARDING_TTL_MS = 20_000;
const TIMEOUT_MS = 8_000;
/** Evento que invalida la foto (lo emiten el sobre, el equipo y la partida al terminar; y la propia guía). */
export const ONBOARDING_CHANGED = "nexus:onboarding-changed";

export class OnboardingError extends Error {
  constructor(message: string, public status: number, public code: string | null, public payload: unknown = null) { super(message); }
}

async function authHeader(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  const token = (await sb.auth.getSession()).data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function call<T>(init: RequestInit): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("/api/game/onboarding", { ...init, headers: { ...(init.headers ?? {}), ...(await authHeader()) }, cache: "no-store", signal: ctrl.signal });
    const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
    if (!res.ok) throw new OnboardingError(json.error ?? "No se pudo leer tu inicio", res.status, json.code ?? null, json);
    return json;
  } catch (e) {
    if (e instanceof OnboardingError) throw e;
    throw new OnboardingError(ctrl.signal.aborted ? "El servidor tarda demasiado" : "Sin conexión con el servidor", 0, ctrl.signal.aborted ? "TIMEOUT" : "NETWORK");
  } finally {
    clearTimeout(timer);
  }
}

export const fetchOnboarding = () => call<OnboardingView>({ method: "GET" });

export interface OnboardingCommandResult {
  onboarding: OnboardingView;
  team?: { deck: { id: string; name: string; cards: { cardId: string }[]; active: boolean }; created: boolean; activated: boolean };
  changed?: boolean;
}

export async function postOnboarding(action: OnboardingCommand): Promise<OnboardingCommandResult> {
  const r = await call<OnboardingCommandResult>({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
  publish(r.onboarding);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("nexus:daily-loop-changed"));
  return r;
}

/* ───────────────────────────── almacén compartido ───────────────────────────── */

type Snap = { user: string | null; view: OnboardingView | null; at: number; loading: boolean; failed: boolean };
let snap: Snap = { user: null, view: null, at: 0, loading: false, failed: false };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

const emit = () => { for (const l of listeners) l(); };
const set = (p: Partial<Snap>) => { snap = { ...snap, ...p }; emit(); };

/** Una foto recién recibida (de una orden, o de la foto del vestíbulo) sustituye a la del almacén. */
export function publish(view: OnboardingView | null | undefined, user: string | null = snap.user): void {
  if (!view) return;
  set({ view, user, at: Date.now(), failed: false });
}

/** COMPLETED es terminal en la sesión (solo una orden —«retomar»— lo cambia, y trae su foto): no se vuelve a pedir. */
const settled = (user: string) => snap.user === user && snap.view?.status === "COMPLETED";

function load(user: string, force = false): Promise<void> {
  if (settled(user)) return Promise.resolve();
  if (!force && snap.user === user && snap.view && Date.now() - snap.at < ONBOARDING_TTL_MS) return Promise.resolve();
  if (inflight) return inflight;
  if (snap.user !== user) set({ user, view: null, at: 0 });
  set({ loading: true });
  inflight = fetchOnboarding()
    .then((view) => { if (snap.user === user) set({ view, at: Date.now(), loading: false, failed: false }); })
    .catch(() => { if (snap.user === user) set({ loading: false, failed: true }); })
    .finally(() => { inflight = null; });
  return inflight;
}

/** Tras abrir un sobre, guardar un equipo o terminar una partida: la siguiente lectura va al servidor. */
export function invalidateOnboarding(): void {
  if (snap.user && settled(snap.user)) return; // cuentas con la guía terminada: ni una lectura más por jugar o abrir
  snap = { ...snap, at: 0 };
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ONBOARDING_CHANGED));
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnap = () => snap;
const SERVER_SNAP: Snap = { user: null, view: null, at: 0, loading: false, failed: false };

/**
 * La guía de la cuenta con sesión (`userId` de `useAuth`, solo para separar cuentas en el almacén). `enabled:false` o
 * sin usuario → `null`. Solo `view.active` significa «enseñar la guía».
 */
export function useOnboarding(userId: string | null | undefined, enabled = true): { view: OnboardingView | null; loading: boolean; refresh: () => void } {
  const s = useSyncExternalStore(subscribe, getSnap, () => SERVER_SNAP);
  const on = enabled && !!userId && isSupabaseConfigured();
  useEffect(() => {
    if (!on || !userId) return;
    void load(userId);
    const again = () => void load(userId, true);
    window.addEventListener(ONBOARDING_CHANGED, again);
    return () => window.removeEventListener(ONBOARDING_CHANGED, again);
  }, [on, userId]);
  const refresh = useCallback(() => { if (on && userId) void load(userId, true); }, [on, userId]);
  const mine = on && s.user === userId;
  return { view: mine ? s.view : null, loading: mine ? s.loading : false, refresh };
}
