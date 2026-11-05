/**
 * DRAFT GAUNTLET · GENERACIÓN DETERMINISTA (Fase 39) — pura, sin red, sin `Math.random`.
 *
 * Todo sale de la SEMILLA de la run (creada en el servidor) y del catálogo real:
 *   · `roleOrderFor(seed)`   → 10 huecos con exactamente 2 de cada rol (Flex es un rol real, no un comodín), barajados.
 *   · `buildDraftPool(...)`  → cartas elegibles: publicadas, con stats de combate, jugador resoluble, rol del duelo y
 *                              UNA sola `dataVersion` (el validador canónico rechaza mezclas).
 *   · `offerFor(...)`        → hasta 3 opciones del rol del hueco: jugadores distintos, ninguno ya elegido, y equipos
 *                              distintos cuando se puede. Uniforme: esto no es un sobre (sin rareza ponderada ni pity).
 *   · `rivalDeckFor(...)`    → 10 cartas reales del rival (2 por rol, jugadores distintos) dentro de la banda de OVR
 *                              del combate.
 *
 * LEGALIDAD POR CONSTRUCCIÓN: cada elección es del rol que falta y excluye cartas y jugadores ya elegidos, así que
 * tras 10 elecciones el mazo es 2/2/2/2/2, sin cartas ni jugadores repetidos y de una sola versión de datos.
 */
import type { CardDef, Player, RoleId } from "@/domain/cards/types";
import { DUEL_COMPOSITION, DUEL_ROLES } from "@/domain/cardgame/types";
import { createRng, nextInt, type RngState } from "@/domain/cardgame/opponent/rng";
import { cardTeamKeyOf } from "@/domain/collection/room";
import { DRAFT_OPTIONS, DRAFT_PICKS, GAUNTLET_STAGES, STAGE_OVR_BAND } from "./rules";

export interface PoolCard { cardId: string; playerId: string; role: RoleId; teamKey: string; ovr: number }

export interface DraftPool {
  dataVersion: string;
  /** Lo que se puede OFRECER: publicadas, con combate, de la versión de la run. */
  byRole: Record<RoleId, PoolCard[]>;
  /**
   * Lo que se puede RESOLVER: además de lo ofrecible, las retiradas de la misma versión. Una carta que ya se
   * ofreció o eligió antes de retirarse sigue siendo válida en su run (las ofertas persistidas no cambian).
   */
  byId: Map<string, PoolCard>;
}

export interface PoolInput {
  cards: readonly CardDef[];
  player: (playerId: string) => Player | undefined;
  /** ¿Puede ofrecerse? (catálogo publicado; las retiradas no se ofrecen). */
  droppable: (cardId: string) => boolean;
}

/** FNV-1a de 32 bits sobre las partes unidas. Estable entre plataformas. */
export function hashSeed(...parts: (string | number)[]): number {
  let h = 0x811c9dc5;
  const s = parts.join("|");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Barajado de Fisher-Yates con el RNG serializable del proyecto. No muta la entrada. */
export function shuffle<T>(rng: RngState, input: readonly T[]): { value: T[]; rng: RngState } {
  const arr = [...input];
  let r = rng;
  for (let i = arr.length - 1; i > 0; i--) {
    const n = nextInt(r, 0, i);
    r = n.rng;
    [arr[i], arr[n.value]] = [arr[n.value], arr[i]];
  }
  return { value: arr, rng: r };
}

/** 10 huecos de rol: exactamente `DUEL_COMPOSITION[rol]` de cada uno, en orden determinista por semilla. */
export function roleOrderFor(seed: number): RoleId[] {
  const slots = DUEL_ROLES.flatMap((role) => Array.from({ length: DUEL_COMPOSITION[role] }, () => role));
  return shuffle(createRng(hashSeed(seed, "roles")), slots).value;
}

function combatPlayer(c: CardDef, input: PoolInput): Player | null {
  if (!c.combat) return null;
  const p = input.player(c.playerId);
  if (!p || !(DUEL_ROLES as readonly string[]).includes(c.role ?? p.role)) return null;
  return p;
}
const isEligibleBase = (c: CardDef, input: PoolInput): Player | null => (input.droppable(c.id) ? combatPlayer(c, input) : null);

/**
 * La versión de datos de la run: la más común entre las cartas elegibles (a igualdad, la mayor). Así el pool es el
 * más grande posible y el mazo nunca mezcla versiones.
 */
export function eligibleDataVersion(input: PoolInput): string | null {
  const counts = new Map<string, number>();
  for (const c of input.cards) if (isEligibleBase(c, input)) counts.set(c.dataVersion ?? "", (counts.get(c.dataVersion ?? "") ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0];
  return best ? best[0] : null;
}

export function buildDraftPool(input: PoolInput, dataVersion: string): DraftPool {
  const byRole = Object.fromEntries(DUEL_ROLES.map((r) => [r, [] as PoolCard[]])) as Record<RoleId, PoolCard[]>;
  const byId = new Map<string, PoolCard>();
  for (const c of input.cards) {
    const p = combatPlayer(c, input);
    if (!p || (c.dataVersion ?? "") !== dataVersion) continue;
    const pc: PoolCard = { cardId: c.id, playerId: c.playerId, role: c.role ?? p.role, teamKey: cardTeamKeyOf(c, p).key, ovr: c.ovr };
    byId.set(c.id, pc);
    if (input.droppable(c.id)) byRole[pc.role].push(pc);
  }
  for (const r of DUEL_ROLES) byRole[r].sort((a, b) => (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0));
  return { dataVersion, byRole, byId };
}

/** Jugadores distintos disponibles en un rol (lo mínimo para que el rol no sea un callejón sin salida). */
export const distinctPlayers = (cards: readonly PoolCard[]): number => new Set(cards.map((c) => c.playerId)).size;

/** ¿Puede este pool completar SIEMPRE un draft? (≥ 2 jugadores distintos por rol). */
export function poolIsSolvable(pool: DraftPool): boolean {
  return DUEL_ROLES.every((r) => distinctPlayers(pool.byRole[r]) >= DUEL_COMPOSITION[r]);
}

/**
 * Opciones del hueco `pickIndex`: hasta 3 cartas del rol, de jugadores distintos, sin cartas ni jugadores ya elegidos
 * y con equipos distintos cuando el pool lo permite. Determinista por (semilla, hueco, elecciones previas).
 */
export function offerFor(pool: DraftPool, seed: number, pickIndex: number, role: RoleId, picked: readonly string[]): string[] {
  const takenCards = new Set(picked);
  const takenPlayers = new Set(picked.map((id) => pool.byId.get(id)?.playerId).filter((x): x is string => !!x));
  const byPlayer = new Map<string, PoolCard[]>();
  for (const c of pool.byRole[role] ?? []) {
    if (takenCards.has(c.cardId) || takenPlayers.has(c.playerId)) continue;
    byPlayer.set(c.playerId, [...(byPlayer.get(c.playerId) ?? []), c]);
  }
  let rng = createRng(hashSeed(seed, "offer", pickIndex));
  const players = shuffle(rng, [...byPlayer.keys()].sort());
  rng = players.rng;
  const candidates: PoolCard[] = [];
  for (const pid of players.value) {
    const variants = byPlayer.get(pid)!;
    const n = nextInt(rng, 0, variants.length - 1);
    rng = n.rng;
    candidates.push(variants[n.value]);
  }
  const chosen: PoolCard[] = [];
  const teams = new Set<string>();
  for (const c of candidates) {
    if (chosen.length >= DRAFT_OPTIONS) break;
    if (teams.has(c.teamKey)) continue;
    chosen.push(c); teams.add(c.teamKey);
  }
  for (const c of candidates) {
    if (chosen.length >= DRAFT_OPTIONS) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  return chosen.map((c) => c.cardId);
}

/**
 * Mazo del rival del combate `stage` (1..5): 2 cartas por rol de jugadores distintos, dentro de la banda de OVR del
 * combate (percentiles del rol). Si la banda no tiene 2 jugadores, se usa el rol entero. Determinista.
 */
export function rivalDeckFor(pool: DraftPool, seed: number, stage: number): string[] {
  const [lo, hi] = STAGE_OVR_BAND[Math.max(0, Math.min(GAUNTLET_STAGES - 1, stage - 1))];
  let rng = createRng(hashSeed(seed, "rival", stage));
  const out: string[] = [];
  // Con el catálogo diseñado un jugador puede tener cartas de ROLES distintos: el jugador usado se
  // recuerda en TODO el mazo, no sólo dentro de un rol (el validador rechaza DUPLICATE_PLAYER).
  const usados = new Set<string>();
  for (const role of DUEL_ROLES) {
    const sorted = [...pool.byRole[role]].filter((c) => !usados.has(c.playerId)).sort((a, b) => a.ovr - b.ovr || (a.cardId < b.cardId ? -1 : 1));
    const from = Math.floor(lo * sorted.length);
    const to = Math.max(from + 1, Math.ceil(hi * sorted.length));
    let band = sorted.slice(from, to);
    if (distinctPlayers(band) < DUEL_COMPOSITION[role]) band = sorted;
    const sh = shuffle(rng, band);
    rng = sh.rng;
    const players = new Set<string>();
    for (const c of sh.value) {
      if (players.has(c.playerId) || usados.has(c.playerId)) continue;
      players.add(c.playerId);
      usados.add(c.playerId);
      out.push(c.cardId);
      if (players.size === DUEL_COMPOSITION[role]) break;
    }
  }
  return out;
}

/** Simulación completa de un draft eligiendo siempre la opción `choose(offer, i)`. Para verificadores y pruebas. */
export function simulateDraft(pool: DraftPool, seed: number, choose: (offer: readonly string[], pickIndex: number) => string = (o) => o[0]): { picks: string[]; offers: string[][]; roleOrder: RoleId[]; deadEnd: boolean } {
  const roleOrder = roleOrderFor(seed);
  const picks: string[] = [];
  const offers: string[][] = [];
  for (let i = 0; i < DRAFT_PICKS; i++) {
    const offer = offerFor(pool, seed, i, roleOrder[i], picks);
    offers.push(offer);
    if (offer.length === 0) return { picks, offers, roleOrder, deadEnd: true };
    picks.push(choose(offer, i));
  }
  return { picks, offers, roleOrder, deadEnd: false };
}
