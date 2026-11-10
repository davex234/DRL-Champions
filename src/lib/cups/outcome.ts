"use client";

/**
 * F86.1 · RESULTADO DEL CUADRO TRAS UNA PARTIDA DE TORNEO. La arena pide `?match=` al terminar; si la liquidación del
 * cuadro aún no había llegado (milisegundos de diferencia), se relee hasta 3 veces cada 1,5 s y se para en cuanto hay
 * resultado. Vive aquí (no en la página PvP, que por contrato no tiene relojes).
 */
import { fetchPrivateMatchInfo, type PrivateMatchInfo } from "@/lib/social/client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function awaitCupOutcome(matchId: string, tries = 3, everyMs = 1_500): Promise<PrivateMatchInfo | null> {
  let last: PrivateMatchInfo | null = null;
  for (let i = 0; i < tries; i++) {
    await sleep(everyMs);
    try { last = await fetchPrivateMatchInfo(matchId); } catch { /* se reintenta */ }
    if (!last?.cup || last.cup.outcome !== null) return last;
  }
  return last;
}
