"use client";

/**
 * PLAYER JOURNEY · «EXPLORAR POR MI CUENTA» (Fase 40).
 *
 * Preferencia de PRESENTACIÓN por dispositivo y por cuenta, en el adaptador KV de la plataforma. No es autoridad de nada:
 * no completa pasos, no da recompensas y no cambia la prioridad del servidor. Solo baja la guía de la home a una tira
 * discreta. Si se pierde (otro dispositivo, navegador limpio), la guía vuelve a verse; el progreso real no se pierde
 * porque se deriva de hechos del servidor.
 */
import { useCallback, useEffect, useState } from "react";
import { getAdapter } from "@/platform/store";

export const journeyPreferenceKey = (userId: string) => `journey-explore-${userId.replace(/[^a-z0-9-]/gi, "").slice(0, 40)}`;

export function useJourneyDismissed(userId: string | null): { dismissed: boolean; dismiss: () => void; resume: () => void } {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!userId) { setDismissed(false); return; }
    let alive = true;
    getAdapter().get(journeyPreferenceKey(userId)).then((v) => { if (alive) setDismissed(v === "1"); }).catch(() => undefined);
    return () => { alive = false; };
  }, [userId]);
  const write = useCallback((v: boolean) => {
    setDismissed(v);
    if (userId) void getAdapter().set(journeyPreferenceKey(userId), v ? "1" : "0").catch(() => undefined);
  }, [userId]);
  return { dismissed, dismiss: () => write(true), resume: () => write(false) };
}
