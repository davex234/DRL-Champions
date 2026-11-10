/**
 * RESUMEN DEL RESULTADO DE UN DUELO — lo que la pantalla única de resultados (`DuelResult`) necesita saber, sacado de lo
 * que el servidor ya devolvió. Aquí NO se calcula ninguna recompensa, ningún rating ni ningún marcador: solo se LEE.
 *
 *   · veredicto → del resultado del resolver (`result.winner` / `result.isDraw`);
 *   · recompensa → SOLO el RECIBO del libro mayor (`result.rewards`: lo que de verdad se concedió por ESTA partida,
 *     incluida la primera victoria de un nodo de campaña). Toda partida PvE terminada lo trae (`withReceipt` en el
 *     servidor). Recibo vacío (tope diario, Draft…), sin lectura (`null`) o sin campo (vista antigua, PvP) → no se ganó
 *     nada que se pueda demostrar y no hay bloque. `result.award` (la tabla) NO se lee: con el tope diario agotado la
 *     tabla dice una cifra que no se concedió.
 *
 * Sumar los asientos de un recibo para enseñarlos en una línea es presentación: las cifras son las del libro mayor.
 */
import type { DuelResultView } from "./types";

export type ResultKind = "win" | "loss" | "draw";

/** Veredicto de la partida para la pantalla. `null` si aún no hay resultado. */
export function resultKind(r: Pick<DuelResultView, "isDraw" | "winner"> | null | undefined): ResultKind | null {
  if (!r) return null;
  return r.isDraw ? "draw" : r.winner === "YOU" ? "win" : "loss";
}

/** Lo ganado en la partida, ya concedido por el servidor. Todo a cero = no se enseña nada. */
export interface ResultEarnings {
  credits: number;
  xp: number;
  /** Lo que no es créditos ni XP (sobres, carta, cosméticos de una primera victoria), tal cual lo concedió el servidor. */
  other: { packId?: string; packCount?: number; cardId?: string; cosmetics?: string[] }[];
}

const pos = (n: number | undefined | null): number => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

export function resultEarnings(r: Pick<DuelResultView, "rewards"> | null | undefined): ResultEarnings {
  const out: ResultEarnings = { credits: 0, xp: 0, other: [] };
  // Sin asiento en el libro mayor, sin recompensa.
  for (const g of r?.rewards?.grants ?? []) {
    out.credits += pos(g.reward.credits);
    out.xp += pos(g.reward.xp);
    const { packId, packCount, cardId, cosmetics } = g.reward;
    if (packId || cardId || (cosmetics && cosmetics.length > 0)) out.other.push({ packId, packCount, cardId, cosmetics });
  }
  return out;
}

export function hasEarnings(e: ResultEarnings): boolean {
  return e.credits > 0 || e.xp > 0 || e.other.length > 0;
}

/**
 * La partida llegó con el TOPE DIARIO agotado (dato del servidor: `rewards.daily.slot === null`). Es lo único que explica
 * por qué una partida PvE no dio nada, y no se dice en ningún otro sitio: el resultado lo enseña en una línea. El cupo
 * normal («k de 20 hoy») no se enseña.
 */
export function dailyCapReached(r: Pick<DuelResultView, "rewards"> | null | undefined): boolean {
  return r?.rewards?.daily != null && r.rewards.daily.slot === null;
}
