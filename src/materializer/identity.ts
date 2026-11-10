/**
 * IDENTITY (Fase 5) — traduce el CardGenerationResult a UPSERTS de jugador: drafts nuevos
 * (con sus accolades concedidas fusionadas) y jugadores existentes (solo las accolades a
 * AÑADIR). No resuelve identidades (eso lo hizo F4): consume sus resoluciones. Puro.
 */
import type { Player, AccoladeId } from "@/domain/cards/types";
import type { CardGenerationResult } from "@/card-generator";

export interface PlayerUpserts {
  playersAdd: Player[];
  playersUpdate: { playerId: string; addAccolades: AccoladeId[] }[];
  /** Jugador RESULTANTE por id (roster + upserts aplicados) — para predicción de catálogo. */
  playerAfter: Map<string, Player>;
}

export function resolveUpserts(gen: CardGenerationResult, roster: Player[], changedPlayerIds: Set<string>): PlayerUpserts {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const grantsByPlayer = new Map<string, AccoladeId[]>();
  for (const g of gen.grants) {
    const arr = grantsByPlayer.get(g.playerId);
    if (arr) arr.push(g.accolade);
    else grantsByPlayer.set(g.playerId, [g.accolade]);
  }

  const playersAdd: Player[] = [];
  const playersUpdate: PlayerUpserts["playersUpdate"] = [];
  const playerAfter = new Map<string, Player>(byId);

  // Drafts (F4) — solo si tienen alguna carta con cambios en esta materialización.
  for (const r of gen.players) {
    if (r.status !== "created" || !r.draft || !r.playerId || !changedPlayerIds.has(r.playerId)) continue;
    const granted = grantsByPlayer.get(r.playerId) ?? [];
    const draft: Player = { ...r.draft, accolades: [...new Set([...r.draft.accolades, ...granted])] };
    playersAdd.push(draft);
    playerAfter.set(draft.id, draft);
  }

  // Existentes: accolades nuevas (las ya poseídas no se repiten).
  for (const [playerId, granted] of [...grantsByPlayer.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const existing = byId.get(playerId);
    if (!existing || !changedPlayerIds.has(playerId)) continue;
    const addAccolades = [...new Set(granted)].filter((a) => !existing.accolades.includes(a)).sort();
    if (!addAccolades.length) continue;
    playersUpdate.push({ playerId, addAccolades });
    playerAfter.set(playerId, { ...existing, accolades: [...existing.accolades, ...addAccolades] });
  }

  playersAdd.sort((a, b) => a.id.localeCompare(b.id));
  return { playersAdd, playersUpdate, playerAfter };
}
