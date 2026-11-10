/**
 * FIXTURES QA SYNTHETIC · FASE 32 — solo para el arnés `/design-system/fase32` y sus capturas.
 *
 * Ejemplares (uids), series, fechas, nombres de equipo y versiones INVENTADOS. Las cartas son
 * definiciones REALES del catálogo, con sus estadísticas reales. Cada equipo se valida con EL MISMO
 * validador canónico que usa el servidor (`checkDraft` → `validateDuelDeck`). Las rutas reales NO usan
 * estos datos.
 */
import { CARDS, getPlayer } from "@/data/catalog";
import { DUEL_ROLES, explainDeckError } from "@/domain/cardgame";
import type { RoleId, VariantId } from "@/domain/cards/types";
import { checkDraft, compareForSlot, indexPool } from "@/domain/deckBuilder/builder";
import { rarityOf } from "@/domain/deckBuilder/pool";
import type { DeckBuilderCardDTO, DuelDeckDTO } from "@/lib/duel/types";

export const QA_NOW = Date.UTC(2026, 8, 14, 18, 30);
const D = 86_400_000;
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const deckUuid = (n: number) => `0000dec0-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Def = (typeof CARDS)[number];

/** Jugadores por rol, cada uno con sus cartas de mayor a menor OVR; jugadores ordenados por su mejor OVR. */
const PLAYERS = new Map<RoleId, Def[][]>();
for (const role of DUEL_ROLES) {
  const m = new Map<string, Def[]>();
  for (const c of CARDS) {
    const p = getPlayer(c.playerId);
    if (!c.combat || !p || (c.role ?? p.role) !== role) continue;
    m.set(c.playerId, [...(m.get(c.playerId) ?? []), c]);
  }
  PLAYERS.set(role, [...m.values()]
    .map((cs) => cs.sort((a, b) => b.ovr - a.ovr))
    .sort((a, b) => b[0].ovr - a[0].ovr || a[0].playerId.localeCompare(b[0].playerId)));
}

let seq = 0;
const make = (def: Def, serial: number | null, ageDays: number): DeckBuilderCardDTO => {
  const p = getPlayer(def.playerId)!;
  seq++;
  return {
    uid: uid(seq), cardId: def.id, playerId: def.playerId, nick: p.nick, team: p.team, country: p.country, role: def.role ?? p.role,
    region: p.region, variantId: def.variantId as VariantId, ovr: def.ovr, combat: def.combat!, serial,
    dataVersion: def.dataVersion ?? "", statBoost: def.statBoost ?? 0, obtainedAt: QA_NOW - ageDays * D,
  };
};

/** Colección QA: los 5 mejores jugadores de cada rol + una segunda variante de un jugador + una copia repetida. */
const BEST = {} as Record<RoleId, DeckBuilderCardDTO[]>;
export const COLLECTION: DeckBuilderCardDTO[] = [];
for (const role of DUEL_ROLES) {
  BEST[role] = PLAYERS.get(role)!.slice(0, 5).map((cs, i) => make(cs[0], i % 2 ? 40 + i * 13 : null, 2 + i * 3));
  COLLECTION.push(...BEST[role]);
}
const twinPlayer = DUEL_ROLES.flatMap((r) => PLAYERS.get(r)!.slice(0, 5)).find((cs) => cs.length >= 2) ?? null;
export const TWIN: DeckBuilderCardDTO | null = twinPlayer ? make(twinPlayer[1], 7, 0.5) : null;
if (TWIN) COLLECTION.push(TWIN);
const dupeSource = PLAYERS.get("Iniciador")![1]?.[0] ?? PLAYERS.get("Iniciador")![0][0];
export const DUPE = make(dupeSource, 311, 0.2);
COLLECTION.push(DUPE);

const POOL = indexPool(COLLECTION);
export const pick = (role: RoleId, i: number) => BEST[role][Math.min(i, BEST[role].length - 1)];

export const FULL_UIDS = DUEL_ROLES.flatMap((r) => [pick(r, 0).uid, pick(r, 1).uid]);
export const PARTIAL_UIDS = [pick("Duelista", 0).uid, pick("Duelista", 1).uid, pick("Controlador", 0).uid, pick("Iniciador", 0).uid, pick("Centinela", 0).uid, pick("Centinela", 1).uid];
export const NINE_UIDS = FULL_UIDS.slice(0, 9);
const twinFirst = TWIN ? COLLECTION.find((c) => c.playerId === TWIN.playerId && c.uid !== TWIN.uid) ?? null : null;
export const INVALID_UIDS = TWIN && twinFirst
  ? [twinFirst.uid, TWIN.uid, ...FULL_UIDS.filter((u) => u !== twinFirst.uid && POOL.get(u)?.role !== TWIN.role).slice(0, 4)]
  : [pick("Centinela", 0).uid, pick("Centinela", 1).uid, pick("Centinela", 2).uid];
export const GHOST_UID = "0000dead-0000-4000-8000-000000000001";
export const LOST_UIDS = [...FULL_UIDS.slice(0, 9), GHOST_UID];
export const SECOND_FULL_UIDS = DUEL_ROLES.flatMap((r) => [pick(r, 2).uid, pick(r, 3).uid]);

/** Un `DuelDeckDTO` con la validación canónica, como lo proyectaría el servidor. */
export function deckDto(n: number, name: string, uids: string[], o: { active?: boolean; ageDays?: number } = {}): DuelDeckDTO {
  const check = checkDraft(uids, POOL);
  const at = QA_NOW - (o.ageDays ?? 0) * D;
  return {
    id: deckUuid(n), name, cardUids: uids,
    cards: check.validation.resolved.map((c) => POOL.get(c.uid)!),
    valid: check.ready, status: check.status,
    roleCounts: check.validation.roleCounts, missingByRole: check.validation.missingByRole,
    errors: check.validation.errors.map((e) => ({ code: e.code, message: explainDeckError(e) })),
    sumOvr: check.validation.resolved.reduce((s, c) => s + c.ovr, 0),
    updatedAt: at, version: new Date(at).toISOString().replace("Z", "000+00:00"), active: !!o.active,
  };
}

export const DECK_FULL = deckDto(1, "Equipo principal", FULL_UIDS, { active: true, ageDays: 0 });
export const DECK_PARTIAL = deckDto(2, "Rotación B", PARTIAL_UIDS, { ageDays: 1 });
export const DECK_NINE = deckDto(3, "Casi listo", NINE_UIDS, { ageDays: 3 });
export const DECK_INVALID = deckDto(4, "Pruebas de variantes", INVALID_UIDS, { ageDays: 9 });
export const DECK_LOST = deckDto(5, "Antiguo", LOST_UIDS, { ageDays: 20 });
export const DECK_SECOND = deckDto(7, "Equipo agresivo", SECOND_FULL_UIDS, { ageDays: 2 });
export const HUB_DECKS = [DECK_FULL, DECK_SECOND, DECK_PARTIAL, DECK_NINE, DECK_INVALID, DECK_LOST];

/** La versión «de la otra pestaña»: misma fila, otra composición y otra versión. */
export const CONFLICT_DECK = deckDto(2, "Rotación B", [...PARTIAL_UIDS.slice(0, 5), pick("Flex", 0).uid], { ageDays: 0 });

/** Colección que no da para un equipo: un único jugador Centinela. */
export const SCARCE = COLLECTION.filter((c) => c.role !== "Centinela" || c.uid === pick("Centinela", 0).uid);

/** Una sustitución con diferencias en los dos sentidos (para el comparador). */
export const MIXED = (() => {
  for (const current of [pick("Duelista", 1), pick("Duelista", 0), pick("Flex", 1)]) {
    for (const cand of BEST[current.role].filter((c) => !FULL_UIDS.includes(c.uid))) {
      const v = compareForSlot(FULL_UIDS, POOL, current.uid, cand.uid);
      if (v && v.legal && v.rows.some((r) => (r.delta ?? 0) > 0) && v.rows.some((r) => (r.delta ?? 0) < 0)) return { slotUid: current.uid, candidateUid: cand.uid };
    }
  }
  return { slotUid: pick("Duelista", 1).uid, candidateUid: pick("Duelista", 2).uid };
})();

export const FILTER_TEXT = pick("Controlador", 0).nick.slice(0, 3);
export const FILTER_TEAM = pick("Flex", 0).team;
export const FILTER_RARITY = rarityOf(pick("Duelista", 0));
