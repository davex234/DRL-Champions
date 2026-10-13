/**
 * MAZO DEL RIVAL DE CAMPAÑA (Fase 35). Puro y determinista.
 *
 * El rival es un EQUIPO REAL: su núcleo son los jugadores cuyo `Player.team` resuelve —sin ambigüedad y como
 * roster ACTUAL (`currentTeamIdentity`)— al id canónico del nodo. Ningún equipo del catálogo tiene hoy dos
 * jugadores por cada uno de los cinco roles, así que un mazo legal (10 cartas, 2 por rol) necesita refuerzos.
 * Se dice tal cual en la interfaz («5 de Fnatic + 5 refuerzos de EMEA»), nunca se presenta como el roster.
 *
 * Algoritmo, idéntico para la misma entrada:
 *   1. Una carta por jugador según el escalón (`BASE` = su versión de menor OVR, `MID` = la mediana, `TOP` =
 *      la mayor). Solo cartas con trío de combate. Empates por `cardId`.
 *   2. Por cada rol, hasta dos jugadores del núcleo (mayor OVR primero, empate por `playerId`).
 *   3. Huecos: jugadores de la MISMA REGIÓN fuera del núcleo, los de OVR más cercano a la media del núcleo; si
 *      la región no llega, del resto del catálogo con el mismo criterio.
 *   4. Nunca repite jugador, tampoco entre roles: con el catálogo diseñado (2026-09-21) el rol es de la CARTA
 *      y un mismo jugador puede tener cartas de roles distintos; entra una sola vez.
 *
 * No crea cartas ni jugadores: si el catálogo no da para un mazo legal, devuelve `ok: false` y el nodo no se
 * puede jugar. El servidor vuelve a validar el mazo con el validador canónico antes de empezar.
 */
import { currentTeamIdentity, teamIdentityById } from "@/data/teamIdentities";
import { DUEL_ROLES } from "@/domain/cardgame/types";
import type { Region, RoleId } from "@/domain/cards/types";
import type { CardTier, OpponentCardPick, OpponentPlan } from "./types";

/** Lo mínimo del registro de cartas que hace falta (lo cumple `CardRegistry`). */
export interface CampaignCatalog {
  forRole(role: RoleId): readonly { id: string; playerId: string; ovr: number; combat?: unknown }[];
  player(playerId: string): { team: string; region: Region; role: RoleId } | undefined;
}

export const OPPONENT_PER_ROLE = 2;
/** Por debajo de esto el rival ya no «es» ese equipo: el nodo no se sirve. */
export const OPPONENT_MIN_CORE = 3;

interface Candidate { playerId: string; cardId: string; ovr: number; role: RoleId; region: Region; team: string }

const indexCache = new WeakMap<object, Candidate[][]>();

/** Una carta por jugador por escalón, indexado por rol. Se memoriza por instancia de catálogo. */
function candidates(catalog: CampaignCatalog, tier: CardTier): Map<RoleId, Candidate[]> {
  const tiers: CardTier[] = ["BASE", "MID", "TOP"];
  let cached = indexCache.get(catalog);
  if (!cached) {
    cached = tiers.map(() => []);
    for (const role of DUEL_ROLES) {
      const perPlayer = new Map<string, { id: string; ovr: number }[]>();
      for (const c of catalog.forRole(role)) {
        if (!c.combat) continue;
        const list = perPlayer.get(c.playerId) ?? [];
        list.push({ id: c.id, ovr: c.ovr });
        perPlayer.set(c.playerId, list);
      }
      for (const [playerId, cards] of perPlayer) {
        const p = catalog.player(playerId);
        // `forRole` ya filtra por el rol de la CARTA (el impreso, si lo tiene): no se vuelve a
        // filtrar por el del jugador, que en el catálogo diseñado puede ser otro.
        if (!p) continue;
        cards.sort((a, b) => a.ovr - b.ovr || a.id.localeCompare(b.id));
        const pick = [cards[0], cards[Math.floor((cards.length - 1) / 2)], cards[cards.length - 1]];
        pick.forEach((card, i) => cached![i].push({ playerId, cardId: card.id, ovr: card.ovr, role, region: p.region, team: p.team }));
      }
    }
    indexCache.set(catalog, cached);
  }
  const out = new Map<RoleId, Candidate[]>();
  for (const c of cached[tiers.indexOf(tier)]) {
    const list = out.get(c.role) ?? [];
    list.push(c);
    out.set(c.role, list);
  }
  return out;
}

export function buildOpponentPlan(catalog: CampaignCatalog, teamId: string, tier: CardTier): OpponentPlan {
  const identity = teamIdentityById(teamId);
  if (!identity) return { ok: false, teamId, reason: "UNKNOWN_TEAM" };
  if (identity.status !== "verified") return { ok: false, teamId, reason: "UNVERIFIED_TEAM" };
  if (identity.currentAliases.length === 0) return { ok: false, teamId, reason: "NO_CURRENT_ROSTER" };

  const byRole = candidates(catalog, tier);
  const isCore = (c: Candidate) => currentTeamIdentity(c.team)?.canonicalId === identity.canonicalId;

  const picks: OpponentCardPick[] = [];
  const used = new Set<string>();
  const missing = new Map<RoleId, number>();
  for (const role of DUEL_ROLES) {
    // Con el catálogo diseñado un jugador puede tener cartas de ROLES distintos: el jugador usado se
    // recuerda en TODO el mazo, no sólo dentro de un rol (el validador rechaza DUPLICATE_PLAYER).
    const core = (byRole.get(role) ?? []).filter((c) => isCore(c) && !used.has(c.playerId))
      .sort((a, b) => b.ovr - a.ovr || a.playerId.localeCompare(b.playerId))
      .slice(0, OPPONENT_PER_ROLE);
    for (const c of core) { picks.push({ cardId: c.cardId, playerId: c.playerId, role, ovr: c.ovr, source: "TEAM" }); used.add(c.playerId); }
    missing.set(role, OPPONENT_PER_ROLE - core.length);
  }

  const coreCount = picks.length;
  if (coreCount < OPPONENT_MIN_CORE) return { ok: false, teamId, reason: "CORE_TOO_SMALL" };
  const target = picks.reduce((s, p) => s + p.ovr, 0) / coreCount;
  const byDistance = (a: Candidate, b: Candidate) =>
    Math.abs(a.ovr - target) - Math.abs(b.ovr - target) || b.ovr - a.ovr || a.playerId.localeCompare(b.playerId);

  for (const role of DUEL_ROLES) {
    let need = missing.get(role) ?? 0;
    if (need <= 0) continue;
    const pool = (byRole.get(role) ?? []).filter((c) => !used.has(c.playerId) && !isCore(c));
    const regional = pool.filter((c) => c.region === identity.region).sort(byDistance);
    const global = pool.filter((c) => c.region !== identity.region).sort(byDistance);
    for (const [list, source] of [[regional, "REGION"], [global, "GLOBAL"]] as const) {
      for (const c of list) {
        if (need <= 0) break;
        if (used.has(c.playerId)) continue;
        picks.push({ cardId: c.cardId, playerId: c.playerId, role, ovr: c.ovr, source });
        used.add(c.playerId);
        need--;
      }
    }
    if (need > 0) return { ok: false, teamId, reason: "INSUFFICIENT_CARDS" };
  }

  // Orden estable del mazo: por rol canónico y, dentro, núcleo primero.
  const roleIndex = (r: RoleId) => DUEL_ROLES.indexOf(r);
  const sourceIndex = { TEAM: 0, REGION: 1, GLOBAL: 2 } as const;
  picks.sort((a, b) => roleIndex(a.role) - roleIndex(b.role) || sourceIndex[a.source] - sourceIndex[b.source] || b.ovr - a.ovr || a.playerId.localeCompare(b.playerId));

  return {
    ok: true, teamId: identity.canonicalId, teamName: identity.displayName, tag: identity.tag, region: identity.region as Region,
    tier, cards: picks, coreCount, sumOvr: picks.reduce((s, p) => s + p.ovr, 0),
  };
}
