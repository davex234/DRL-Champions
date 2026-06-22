import type { Tournament, RawTeam, RawResult, GeneratedCard, CardKind, TournamentType } from "./types";
import { normalizeStatToPlayer } from "./sources/normalize";
import { identifyMvp, winnerPlayers } from "./tournament";
import { getVariant } from "@/domain/cards/variants";
import { getPlayer } from "@/data/catalog";
import { getTeam } from "@/data/teams";
import type { VariantId } from "@/domain/cards/types";

interface Accolades {
  series: string | null;
  winner: string | null;
  mvp: string | null;
}

function accoladesFor(type: TournamentType): Accolades {
  switch (type) {
    case "masters": return { series: "masters", winner: "masters-winner", mvp: "masters-mvp" };
    case "champions": return { series: "champions", winner: "champions-winner", mvp: "champions-mvp" };
    case "ewc": return { series: "ewc", winner: "ewc-winner", mvp: "ewc-mvp" };
    case "regional": return { series: null, winner: "regional-winner", mvp: "regional-mvp" };
    case "game-changers": return { series: "game-changers", winner: "regional-winner", mvp: "regional-mvp" };
    default: return { series: null, winner: null, mvp: null };
  }
}

/** Variante "titular" de una carta (para leer nº de serie/etiqueta). */
function headlineVariant(accolade: string, region: string): VariantId {
  if (accolade === "regional-winner") return `${region.toLowerCase()}-winner` as VariantId;
  if (accolade === "regional-mvp") return `${region.toLowerCase()}-mvp` as VariantId;
  if (accolade === "icon") return "icon-series";
  return accolade as VariantId;
}

let serialSeq = 0;
function nextId(): string {
  serialSeq += 1;
  return `gc_${serialSeq}_${Math.floor(Math.random() * 1e5).toString(36)}`;
}

/**
 * Genera las cartas de un torneo finalizado: SERIES (participantes), WINNER
 * (equipo ganador), MVP, e ICON/PRIME si corresponde. Calcula confianza y
 * número de serie. Confianza < 0.9 ⇒ requiere aprobación manual.
 */
export function generateCards(tournament: Tournament, teams: RawTeam[], result: RawResult): GeneratedCard[] {
  const acc = accoladesFor(tournament.type);
  const teamName = (id: string) => teams.find((t) => t.id === id)?.name ?? id;
  const teamRegion = (id: string) => teams.find((t) => t.id === id)?.region ?? "EMEA";
  const cards: GeneratedCard[] = [];
  const now = Date.now();
  const mvp = identifyMvp(result);

  function build(kind: CardKind, accolade: string, statPlayerId: string, baseConfidence: number): GeneratedCard | null {
    const stat = result.stats.find((s) => s.playerId === statPlayerId);
    if (!stat) return null;
    const tname = teamName(stat.teamId);
    const region = stat.region ?? teamRegion(stat.teamId);
    const player = normalizeStatToPlayer(stat, tname);
    const variantId = headlineVariant(accolade, region);
    const variant = getVariant(variantId);

    // Confianza: penaliza incidencias detectables (logo, país).
    const issues: string[] = [];
    let confidence = baseConfidence;
    if (!getTeam(tname)) {
      issues.push(`Logo de equipo no encontrado: ${tname}`);
      confidence -= 0.06;
    }
    if (!player.country || player.country.length !== 2) {
      issues.push(`País no resuelto: ${stat.country ?? "—"}`);
      confidence -= 0.04;
    }
    if (!getPlayer(player.id) && !player.image) {
      issues.push(`Foto no encontrada (se usará silueta): ${player.nick}`);
      // foto ausente no bloquea (hay fallback): penalización leve
      confidence -= 0.02;
    }
    confidence = Math.max(0, Math.min(1, confidence));

    return {
      id: nextId(),
      tournamentId: tournament.id,
      tournamentName: tournament.name,
      kind,
      playerId: player.id,
      playerNick: player.nick,
      accolade,
      serialLimit: variant?.serialized ? variant.serialLimit : undefined,
      confidence,
      issues,
      status: confidence >= 0.9 ? "applied" : "pending",
      createdAt: now,
      player,
    };
  }

  // SERIES — todos los participantes (solo torneos con variante internacional/exclusiva)
  if (acc.series) {
    for (const stat of result.stats) {
      const c = build("series", acc.series, stat.playerId, 0.95);
      if (c) cards.push(c);
    }
  }

  // WINNER — jugadores del equipo ganador
  if (acc.winner) {
    for (const stat of winnerPlayers(result)) {
      const c = build("winner", acc.winner, stat.playerId, 0.93);
      if (c) cards.push(c);
    }
  }

  // MVP
  if (acc.mvp && mvp.playerId) {
    const c = build("mvp", acc.mvp, mvp.playerId, mvp.confidence);
    if (c) {
      c.issues.push(...mvp.issues);
      cards.push(c);
    }
  }

  // ICON — MVP de un Champions también recibe Icon (si corresponde)
  if (tournament.type === "champions" && mvp.playerId) {
    const c = build("icon", "icon", mvp.playerId, Math.min(0.92, mvp.confidence));
    if (c) cards.push(c);
  }

  // PRIME — participantes con ACS sobresaliente (>= 270)
  for (const stat of result.stats) {
    if ((stat.acs ?? 0) >= 270) {
      const c = build("prime", "prime", stat.playerId, 0.9);
      if (c) cards.push(c);
    }
  }

  return cards;
}
