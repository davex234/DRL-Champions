"use client";

/**
 * PRE-PARTIDA · REGLAS EN LA PRIMERA ENTRADA (una sola vez por cuenta).
 *
 * Preferencia de PRESENTACIÓN por cuenta en el adaptador KV de la plataforma (el mismo mecanismo que
 * `journey/preference.ts`): no es autoridad de nada, no toca el duelo ni el servidor. Si se pierde (otro dispositivo,
 * navegador limpio), las reglas vuelven a verse una vez; la ayuda «?» las tiene siempre.
 *
 * Estados: `unknown` mientras se lee (no se pinta nada: sin parpadeo), `show` la primera vez, `hidden` después.
 * La marca la pide el BLOQUE DE REGLAS al montarse (`markSeen`, en un efecto tras pintarse): nunca antes de enseñarlas
 * —p. ej. una partida retomada no pasa por la preparación y no marca nada—. La vista actual las sigue mostrando hasta
 * salir: desaparecen en la SIGUIENTE entrada.
 */
import { useCallback, useEffect, useState } from "react";
import { getAdapter } from "@/platform/store";

export const duelRulesSeenKey = (userId: string) => `duel-rules-seen-${userId.replace(/[^a-z0-9-]/gi, "").slice(0, 40)}`;

export type DuelRulesIntro = "unknown" | "show" | "hidden";

export function useDuelRulesIntro(userId: string | null): { intro: DuelRulesIntro; markSeen: () => void } {
  const [state, setState] = useState<DuelRulesIntro>("unknown");
  useEffect(() => {
    if (!userId) { setState("unknown"); return; }
    let alive = true;
    setState("unknown");
    getAdapter().get(duelRulesSeenKey(userId))
      .then((v) => { if (alive) setState(v === "1" ? "hidden" : "show"); })
      .catch(() => { if (alive) setState("show"); });
    return () => { alive = false; };
  }, [userId]);
  const markSeen = useCallback(() => {
    if (userId) void getAdapter().set(duelRulesSeenKey(userId), "1").catch(() => undefined);
  }, [userId]);
  return { intro: state, markSeen };
}
