"use client";

/**
 * META GAME — CLIENTE (Fase 27).
 *
 *   · `fetchMetaSnapshot()`     → `GET /api/game/meta`, la lectura agregada (solo lectura).
 *   · `useProgressionDelta()`   → toma una lectura ANTES de una actividad y otra DESPUÉS, y devuelve
 *                                 la diferencia. Las dos son del servidor: aquí no se suma nada.
 *   · `takeProgressEvents()`    → avisos con identidad estable, sin repetir en la misma sesión.
 *
 * Nada de esto persiste en el navegador. La memoria de «ya avisado» es de MÓDULO (se pierde al
 * recargar), a propósito: no hay acuse en el servidor y no se quiere inventar autoridad de cliente.
 */
import { useCallback, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import type { MetaSnapshot } from "@/server/services/meta";
import {
  objectiveDeltas, levelsGained, progressEvents,
  type ObjectiveDelta, type ProgressEvent,
} from "@/domain/progression/meta";

export type { MetaSnapshot };

export async function fetchMetaSnapshot(): Promise<MetaSnapshot | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  const res = await fetch("/api/game/meta", { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (res.status === 401) return null;
  const json = (await res.json().catch(() => ({}))) as MetaSnapshot & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
  return json;
}

export interface ProgressionDelta {
  xpBefore: number;
  xpAfter: number;
  levelsGained: number[];
  objectives: ObjectiveDelta[];
  events: ProgressEvent[];
  after: MetaSnapshot;
}

/** Diferencia entre dos lecturas del servidor. Pura; exportada para las pruebas. */
export function diffSnapshots(before: MetaSnapshot, after: MetaSnapshot): ProgressionDelta {
  const b = { xp: before.account.xp, objectives: before.objectives, achievements: before.pass.achievements };
  const a = { xp: after.account.xp, objectives: after.objectives, achievements: after.pass.achievements };
  return {
    xpBefore: before.account.xp,
    xpAfter: after.account.xp,
    levelsGained: levelsGained(before.account.xp, after.account.xp),
    objectives: objectiveDeltas(before.objectives, after.objectives),
    events: progressEvents(b, a),
    after,
  };
}

/**
 * `begin()` antes de la actividad (partida, apertura); `end()` después. Si la lectura previa falló
 * o no hay sesión, `end()` devuelve `null` y la pantalla simplemente no enseña deltas: nunca se
 * fabrica un «antes» para que salga algo.
 */
export function useProgressionDelta() {
  const before = useRef<MetaSnapshot | null>(null);
  const [delta, setDelta] = useState<ProgressionDelta | null>(null);

  const begin = useCallback(async () => {
    try { before.current = await fetchMetaSnapshot(); } catch { before.current = null; }
  }, []);

  const end = useCallback(async (): Promise<ProgressionDelta | null> => {
    try {
      const after = await fetchMetaSnapshot();
      if (!after) return null;
      const d = before.current ? diffSnapshots(before.current, after) : null;
      setDelta(d);
      // La lectura «después» pasa a ser el «antes» de la siguiente actividad (revancha).
      before.current = after;
      return d;
    } catch {
      return null;
    }
  }, []);

  const reset = useCallback(() => setDelta(null), []);
  return { begin, end, reset, delta };
}

/* ───────────────────────────── avisos con identidad ───────────────────────────── */

const shown = new Set<string>();

/** Devuelve los eventos aún no avisados en esta sesión y los marca. Identidad estable por evento. */
export function takeProgressEvents(events: ProgressEvent[]): ProgressEvent[] {
  const fresh = events.filter((e) => !shown.has(e.id));
  for (const e of fresh) shown.add(e.id);
  return fresh;
}

/** Solo para pruebas y arneses. */
export function __resetProgressEventsForTests(): void { shown.clear(); }
