"use client";

/**
 * F87 · PICK'EMS 2.0 — CLIENTE. Transporte hacia `/api/game/pickem-brackets` y el estado de UN cuadro en pantalla.
 *
 *   · Lee con el token si hay sesión (para MIS picks) y sin él si no la hay (el cuadro real es público).
 *   · Escribe SOLO un partido y un equipo (o `null` para quitar) con la revisión que tenía: el servidor valida contra
 *     MI cuadro predicho y la BD decide el cierre. Nunca se pinta «guardado» sin respuesta del servidor.
 *   · Optimista con vuelta atrás: el pick (y la limpieza de descendientes, calculada con el MISMO dominio) se ve al
 *     instante como «Guardando…»; si el servidor lo rechaza, se vuelve a lo confirmado y se dice por qué.
 *   · Un envío a la vez (cola): cada uno sale con la revisión que dejó el anterior. Otra pestaña/dispositivo → 409
 *     STALE con el estado fresco: se adopta y se avisa; nada se pisa.
 *   · Al llegar el siguiente cierre (cuenta atrás visual), se relee del servidor: el cierre es SUYO.
 *   · Por cuenta: cambiar de cuenta o cerrar sesión vacía el estado al instante (sin caché entre cuentas).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { invalidatedBy, realStateOf, type PredictionContext } from "@/domain/pickems/prediction";
import type { BracketView, BracketCard, SaveResult } from "@/server/services/pickemBrackets";

export type { BracketView, BracketCard };

export class PickemError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly state?: { revision: number; picks: Record<string, string> }) {
    super(message);
    this.name = "PickemError";
  }
}

async function token(): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}

async function get<T>(query: string): Promise<T> {
  const t = await token();
  const res = await fetch(`/api/game/pickem-brackets${query}`, { headers: t ? { authorization: `Bearer ${t}` } : {}, cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw new PickemError(json.error ?? `Error ${res.status}`, res.status, json.code);
  return json;
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const t = await token();
  if (!t) throw new PickemError("Inicia sesión para hacer tus predicciones", 401, "AUTH");
  const res = await fetch("/api/game/pickem-brackets", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string; state?: { revision: number; picks: Record<string, string> } };
  if (!res.ok) throw new PickemError(json.error ?? `Error ${res.status}`, res.status, json.code, json.state);
  return json;
}

export const fetchBrackets = () => get<{ brackets: BracketCard[] }>("");
export const fetchBracket = (slug: string) => get<BracketView>(`?slug=${encodeURIComponent(slug)}`);
export const postPick = (slug: string, matchId: string, teamId: string | null, revision: number) => post<SaveResult>({ action: "pick", slug, matchId, teamId, revision });
export const postClaim = (slug: string) => post<{ applied: boolean; tier: string; items: string[] }>({ action: "claim", slug });

export type PickStatus = "saving" | "saved" | "error";
export interface PickNotice { matchId: string; status: PickStatus; message: string }

/** El contexto de predicción a partir de la vista (mismo dominio puro que el servidor). */
export function contextOfView(v: BracketView): PredictionContext {
  return { descriptor: v.descriptor, real: realStateOf(v.matches), voided: new Set(v.nodes.filter((n) => n.voided).map((n) => n.matchId)) };
}

export function useBracket(slug: string, userId: string | null) {
  const [view, setView] = useState<BracketView | null>(null);
  const [error, setError] = useState<PickemError | null>(null);
  const [loading, setLoading] = useState(true);
  /** Picks CONFIRMADOS por el servidor + su revisión. */
  const [confirmed, setConfirmed] = useState<{ picks: Record<string, string>; revision: number } | null>(null);
  /** Lo que se ve mientras hay envíos en vuelo (optimista). `null` = igual que lo confirmado. */
  const [optimistic, setOptimistic] = useState<Record<string, string> | null>(null);
  const [notice, setNotice] = useState<PickNotice | null>(null);
  const [inFlight, setInFlight] = useState<string | null>(null);
  const owner = useRef<string | null>(userId);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef<{ picks: Record<string, string>; revision: number } | null>(null);
  const pendingCount = useRef(0);

  const load = useCallback(async () => {
    const who = owner.current;
    try {
      const v = await fetchBracket(slug);
      if (owner.current !== who) return; // cambió la cuenta mientras se leía: se descarta
      setView(v);
      setError(null);
      const mine = v.me ? { picks: v.me.picks, revision: v.me.revision } : null;
      latest.current = mine;
      setConfirmed(mine);
    } catch (e) {
      if (owner.current !== who) return;
      setError(e instanceof PickemError ? e : new PickemError("No se pudo cargar el Pick'em", 0));
    } finally {
      if (owner.current === who) setLoading(false);
    }
  }, [slug]);

  // Cuenta nueva (o cierre de sesión): nada de la anterior queda en pantalla.
  useEffect(() => {
    owner.current = userId;
    setView(null); setConfirmed(null); setOptimistic(null); setNotice(null); setInFlight(null);
    latest.current = null; queue.current = Promise.resolve(); pendingCount.current = 0;
    setLoading(true);
    void load();
  }, [userId, load]);

  // Relee al llegar el siguiente cierre (el servidor decide) y al volver a la pestaña.
  useEffect(() => {
    if (!view?.nextLockAt) return;
    const skew = Date.parse(view.serverNow) - Date.now();
    const wait = Date.parse(view.nextLockAt) - (Date.now() + skew) + 1500;
    if (!(wait > 0) || wait > 2 ** 31 - 1) return;
    const t = setTimeout(() => void load(), wait);
    return () => clearTimeout(t);
  }, [view?.nextLockAt, view?.serverNow, load]);
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [load]);

  const ctx = useMemo(() => (view ? contextOfView(view) : null), [view]);
  const lockedSet = useMemo(() => new Set((view?.nodes ?? []).filter((n) => n.locked).map((n) => n.matchId)), [view]);
  const picks = optimistic ?? confirmed?.picks ?? {};

  const pick = useCallback((matchId: string, teamId: string | null) => {
    if (!view || !ctx || !userId) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setNotice({ matchId, status: "error", message: "Sin conexión: no se ha guardado" });
      return;
    }
    // Vista optimista inmediata con la MISMA invalidación que hará el servidor.
    setOptimistic((prev) => invalidatedBy(ctx, prev ?? latest.current?.picks ?? {}, matchId, teamId, (id) => !lockedSet.has(id)).next);
    setNotice({ matchId, status: "saving", message: "Guardando…" });
    const who = owner.current;
    pendingCount.current++;
    queue.current = queue.current.then(async () => {
      if (owner.current !== who) return;
      setInFlight(matchId);
      try {
        const res = await postPick(slug, matchId, teamId, latest.current?.revision ?? 0);
        if (owner.current !== who) return;
        latest.current = { picks: res.picks, revision: res.revision };
        setConfirmed(latest.current);
        setNotice({ matchId, status: "saved", message: res.cleared.length ? `Guardado · ${res.cleared.length} predicción(es) posterior(es) quitada(s) por incompatibles` : "Guardado" });
      } catch (e) {
        if (owner.current !== who) return;
        const err = e instanceof PickemError ? e : new PickemError("No se pudo guardar", 0);
        if (err.code === "STALE" && err.state) {
          latest.current = { picks: err.state.picks, revision: err.state.revision };
          setConfirmed(latest.current);
          setNotice({ matchId, status: "error", message: "Tus predicciones cambiaron en otra pestaña: se muestra lo guardado. Vuelve a elegir si quieres." });
        } else {
          setNotice({ matchId, status: "error", message: err.message });
          if (err.code === "LOCKED" || err.code === "NOT_OPEN") void load();
        }
      } finally {
        if (owner.current === who) {
          setInFlight(null);
          // Cola vacía: lo que se ve vuelve a ser EXACTAMENTE lo confirmado (sin «guardado» falso).
          pendingCount.current = Math.max(0, pendingCount.current - 1);
          if (pendingCount.current === 0) setOptimistic(null);
        }
      }
    });
  }, [view, ctx, userId, slug, lockedSet, load]);

  const claim = useCallback(async () => {
    const r = await postClaim(slug);
    await load();
    return r;
  }, [slug, load]);

  return { view, ctx, picks, confirmed, notice, inFlight, loading, error, pick, claim, reload: load };
}
