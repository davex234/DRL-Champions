/**
 * DUELOS — SERVICIO CON AUTORIDAD DE SERVIDOR (Fase 8, SOLO SERVIDOR).
 *
 * Es el único sitio donde se ejecuta una partida de duelos. Une tres piezas que ya existían y no
 * reimplementa ninguna:
 *
 *   · PROPIEDAD  → `user_cards` (migración 0011), leída con `service_role`.
 *   · CATÁLOGO   → `CardRegistry`, el mismo adaptador que usa la colección.
 *   · REGLAS     → `@/domain/cardgame` (Fases 3-7): validación de mazo, snapshot, orquestador de
 *                  turnos, bots y Combat Resolver. Aquí no se compara ni una estadística.
 *
 * FRONTERAS DE SEGURIDAD, que son la razón de ser de este fichero:
 *
 *   1. El mazo se resuelve SIEMPRE contra `user_cards`. Un `uid` que el usuario no posee no llega
 *      nunca a la partida, aunque el cliente lo pida.
 *   2. Las semillas se generan aquí con `crypto` y NO salen. El cliente no puede predecir al bot.
 *   3. El estado completo vive en `duel_matches`, cuya RLS no tiene ninguna política: el cliente
 *      no puede leerlo ni con su propio token. Lo que sale es `toPublicView`, redactado.
 *   4. Cada acción del jugador se valida contra el estado del SERVIDOR: de quién es el turno, qué
 *      fase es y qué cartas le quedan lo decide el orquestador, no el cuerpo de la petición.
 *
 * NO concede cartas, créditos ni recompensas. Un duelo de esta fase no mueve la economía.
 */
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { serverCatalog, serverCatalogSync } from "@/server/catalog";
import type { CombatStatKey } from "@/domain/cards/combat";
import type { OwnedCard, RoleId } from "@/domain/cards/types";
import {
  createDuelDeck, validateDuelDeck, duelDeckStatus, takeDeckSnapshot,
  makeDeckResolver, ownershipFromList, explainDeckError,
  DUEL_DECK_SIZE, DUEL_ROLES,
  type DuelDeck, type DuelDeckCard, type DuelDeckSnapshot, type DuelDeckStatus,
} from "@/domain/cardgame";
import { CURRENT_COMBAT_RULES } from "@/domain/cardgame/combat";
import { buildMatchView, toCardDTO as cardDTO } from "@/lib/duel/matchView";
import { duelAward, capDuelAward, duelReward, duelPoints, DAILY_DUEL_AWARD_CAP, type DuelOutcome } from "@/domain/progression/duelRewards";
import { readDuelPaySlot, takeDuelPaySlot } from "./duelCap";
import { award } from "./rewards";
import {
  startDuelMatch, confirmTurn, availableCards, requiredDefenderStat,
  selectAttackerCard, selectAttackerStat, selectDefenderCard, selectDefenderStat,
  type DuelMatch, type Side,
} from "@/domain/cardgame/match";
import {
  createRng, createController, advanceBots, createDuelBot,
  type BotDifficulty, type RngState,
} from "@/domain/cardgame/opponent";
import { toOwnedCard, type UserCardRow } from "./inventory";
import { projectMatchFor } from "@/domain/cardgame/pvp";
import { rivalHintsFor, rivalRolesFor, committedRivalHint } from "@/domain/cardgame/hints";
import { visualHintValue } from "@/lib/duel/hintVisuals";
import { decisionDeadline, recordTimeout, type DecisionTimeout } from "@/lib/duel/turnClock";
import { settleMissionsForMatch } from "./missionEngine";
import type {
  DuelDeckDTO, DuelDeckCardDTO, DuelMatchView, DuelTurnView, DuelReplay, PveMatchContext,
  MatchRewardGrant,
} from "@/lib/duel/types";

/**
 * BLOQUE 8.1 — el registro sale del catálogo PERSISTIDO, no del derivado en código.
 *
 * Antes era `new CardRegistry()`, es decir, una instantánea del `CARDS` con el que arrancó
 * el proceso. Ahora es la autoridad de existencia de la base de datos. Cada función
 * exportada de este módulo empieza preparándola con `await serverCatalog(sb)`; esta forma
 * síncrona es la que consumen los ayudantes de proyección, que no pueden ser asíncronos sin
 * arrastrar a media docena de llamadas y a las pruebas de duelo. Ver `server/catalog`.
 */
const reg = () => serverCatalogSync().registry;
/** F71 · país de un jugador, para las pistas de las cartas ocultas del rival (se calculan aquí, en servidor). */
const countryOf = (playerId: string): string => reg().player(playerId)?.country ?? "";
/**
 * BLOQUE 8.2 — el puerto que hace que un mazo se resuelva con las cartas QUE TIENES.
 *
 * `makeDeckResolver` lo consulta por cada `uid`: devuelve la definición de la versión bajo
 * la que se acuñó ese ejemplar. Sin esto, editar una carta cambiaría el trío de combate de
 * los mazos ya construidos y, con ellos, el resultado de las partidas que empiecen después.
 */
const versionOf = (cardId: string, v: number | null | undefined) => serverCatalogSync().instance(cardId, v);

/** El jugador siempre es el bando A. El bando B es el bot. */
const HUMAN: Side = "A";
const BOT: Side = "B";

/** Tope de mazos guardados por usuario. Evita que la lista crezca sin control. */
export const MAX_DECKS = 8;

export interface ServiceResult<T> {
  ok: boolean;
  status: number;
  error?: string;
  /** F66 · código estable para el cliente (p. ej. `STALE_STATE`: resincroniza con `data.view`). */
  code?: string;
  data?: T;
}

const fail = (status: number, error: string): ServiceResult<never> => ({ ok: false, status, error });
const done = <T>(data: T): ServiceResult<T> => ({ ok: true, status: 200, data });

// ───────────────────────────── propiedad e inventario ─────────────────────────────

/** Tamaño de página al leer `user_cards` (el tope por petición de PostgREST es 1.000 filas). */
const OWNED_PAGE = 1000;
/** Techo de ejemplares leídos: una colección real está muy por debajo; evita un bucle sin fin. */
const OWNED_MAX = 50_000;

/**
 * Instancias que el usuario posee REALMENTE, según la base de datos.
 *
 * FASE 32 · PAGINADA. Antes era una sola lectura sin rango, y PostgREST corta en 1.000 filas: con
 * más de mil ejemplares, la colección del constructor salía truncada y un mazo con una carta de la
 * fila 1.001 se declaraba «no es tuya» sin serlo. Mismas columnas, mismo filtro: solo se pagina.
 */
export async function loadOwned(sb: SupabaseClient, userId: string): Promise<OwnedCard[]> {
  const rows: UserCardRow[] = [];
  for (let from = 0; from < OWNED_MAX; from += OWNED_PAGE) {
    const { data, error } = await sb
      .from("user_cards")
      .select("uid, card_id, serial, origin, locked, obtained_at")
      .eq("user_id", userId)
      .order("uid", { ascending: true })
      .range(from, from + OWNED_PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data as UserCardRow[]) ?? [];
    rows.push(...page);
    if (page.length < OWNED_PAGE) break;
  }
  return rows.map(toOwnedCard);
}

/** Proyección de una carta de duelo para el cliente. Solo datos ya públicos del catálogo. */
const toCardDTO = (c: DuelDeckCard): DuelDeckCardDTO => cardDTO(c, reg());

// ───────────────────────────── mazos ─────────────────────────────

/** Reconstruye el mazo de dominio a partir de una fila y valida contra la propiedad real. */
function validateAgainstOwnership(
  deck: DuelDeck, owned: OwnedCard[],
): { validation: ReturnType<typeof validateDuelDeck>; status: DuelDeckStatus } {
  const validation = validateDuelDeck(deck, makeDeckResolver(reg(), ownershipFromList(owned), versionOf));
  return { validation, status: duelDeckStatus(deck, validation) };
}

export interface DeckRow { id: string; name: string; card_uids: string[]; created_at: string; updated_at: string }

/** Columnas de una fila de mazo. `updated_at` es también la VERSIÓN (Fase 32). */
export const DECK_COLS = "id, name, card_uids, created_at, updated_at";

export function toDeckDTO(row: DeckRow, owned: OwnedCard[], activeDeckId: string | null = null): DuelDeckDTO {
  const deck = createDuelDeck({
    id: row.id, name: row.name, cards: row.card_uids ?? [],
    now: new Date(row.created_at).getTime(),
  });
  const { validation, status } = validateAgainstOwnership(deck, owned);
  const roleCounts = validation.roleCounts;
  return {
    id: row.id,
    name: row.name,
    cardUids: row.card_uids ?? [],
    cards: validation.resolved.map(toCardDTO),
    valid: validation.valid,
    status,
    roleCounts,
    missingByRole: validation.missingByRole,
    // Los errores viajan ya explicados: la interfaz nunca traduce códigos de dominio.
    errors: validation.errors.map((e) => ({ code: e.code, message: explainDeckError(e) })),
    sumOvr: validation.resolved.reduce((s, c) => s + c.ovr, 0),
    updatedAt: new Date(row.updated_at).getTime(),
    version: row.updated_at,
    active: activeDeckId !== null && row.id === activeDeckId,
  };
}

/** Todos los mazos del usuario, ya validados contra su inventario de ahora mismo. */
export async function listDecks(sb: SupabaseClient, userId: string): Promise<ServiceResult<{ decks: DuelDeckDTO[] }>> {
  await serverCatalog(sb); // catálogo persistido listo para los ayudantes síncronos
  const [owned, res] = await Promise.all([
    loadOwned(sb, userId),
    sb.from("duel_decks").select("id, name, card_uids, created_at, updated_at")
      .eq("user_id", userId).order("updated_at", { ascending: false }),
  ]);
  if (res.error) return fail(500, res.error.message);
  return done({ decks: ((res.data as DeckRow[]) ?? []).map((r) => toDeckDTO(r, owned)) });
}

/** Cartas del usuario que pueden entrar en un mazo de duelo, listas para el constructor. */
export async function listCollection(sb: SupabaseClient, userId: string): Promise<ServiceResult<{ cards: DuelDeckCardDTO[] }>> {
  await serverCatalog(sb); // catálogo persistido listo para los ayudantes síncronos
  const owned = await loadOwned(sb, userId);
  const resolve = makeDeckResolver(reg(), ownershipFromList(owned), versionOf);
  const cards: DuelDeckCardDTO[] = [];
  for (const o of owned) {
    const r = resolve(o.uid);
    if (r.ok) cards.push(toCardDTO(r.card));
  }
  cards.sort((a, b) => b.ovr - a.ovr || a.nick.localeCompare(b.nick));
  return done({ cards });
}

const NAME_RE = /^[\p{L}\p{N} ._'#&-]{1,40}$/u;

/**
 * Crea o actualiza un mazo.
 *
 * Valida en servidor: nombre, tamaño, y que CADA instancia sea del usuario. Un mazo incompleto se
 * puede guardar —el jugador puede dejarlo a medias— pero uno con cartas ajenas no.
 */
export async function saveDeck(
  sb: SupabaseClient, userId: string,
  input: { id?: string; name: string; cardUids: string[] },
): Promise<ServiceResult<{ deck: DuelDeckDTO }>> {
  await serverCatalog(sb); // catálogo persistido listo para los ayudantes síncronos
  const name = input.name.trim();
  if (!NAME_RE.test(name)) return fail(400, "Nombre de mazo no válido");

  const uids = [...new Set(input.cardUids)];
  if (uids.length !== input.cardUids.length) return fail(400, "El mazo repite una carta");
  if (uids.length > DUEL_DECK_SIZE) return fail(400, `Un mazo tiene como máximo ${DUEL_DECK_SIZE} cartas`);

  // FRONTERA: la propiedad la decide la base de datos, no el cuerpo de la petición.
  const owned = await loadOwned(sb, userId);
  const ownedUids = new Set(owned.map((o) => o.uid));
  const alien = uids.find((u) => !ownedUids.has(u));
  if (alien) return fail(403, "Ese mazo contiene una carta que no es tuya");

  if (input.id) {
    const { data, error } = await sb.from("duel_decks")
      .update({ name, card_uids: uids })
      .eq("id", input.id).eq("user_id", userId)
      .select("id, name, card_uids, created_at, updated_at").maybeSingle();
    if (error) return fail(500, error.message);
    if (!data) return fail(404, "Mazo no encontrado");
    return done({ deck: toDeckDTO(data as DeckRow, owned) });
  }

  const { count } = await sb.from("duel_decks")
    .select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count ?? 0) >= MAX_DECKS) return fail(409, `Has alcanzado el máximo de ${MAX_DECKS} mazos`);

  const { data, error } = await sb.from("duel_decks")
    .insert({ user_id: userId, name, card_uids: uids })
    .select("id, name, card_uids, created_at, updated_at").maybeSingle();
  if (error) return fail(500, error.message);
  return done({ deck: toDeckDTO(data as DeckRow, owned) });
}

export async function deleteDeck(sb: SupabaseClient, userId: string, id: string): Promise<ServiceResult<{ id: string }>> {
  const { error } = await sb.from("duel_decks").delete().eq("id", id).eq("user_id", userId);
  if (error) return fail(500, error.message);
  return done({ id });
}

// ───────────────────────────── mazo del rival ─────────────────────────────

/**
 * OPD-09 — MAZO DEL RIVAL. DECISIÓN DE PRODUCTO, no viene del documento de diseño.
 *
 * Ni el PDF ni las Fases 1-7 definen de dónde sale el mazo del oponente en un duelo contra la
 * máquina. Se elige lo que NO altera ninguna regla y da una partida justa: un mazo legal construido
 * de forma determinista con las cartas del catálogo cuyo OVR está más cerca del mazo del jugador.
 *
 * No modifica cartas, ni estadísticas, ni reglas: solo elige QUÉ diez cartas trae el rival. Si el
 * producto decide otra cosa (mazos por dificultad, mazos de temporada, espejo), se cambia aquí sin
 * tocar el motor.
 */
function buildOpponentDeck(targetSumOvr: number, seed: number): DuelDeckSnapshot {
  // Mejor carta de cada JUGADOR, agrupada por rol. Es el mismo criterio determinista que usan los
  // tests y el laboratorio de balance de la Fase 7, y garantiza que no se repita jugador.
  const byRole = new Map<RoleId, { cardId: string; ovr: number }[]>();
  for (const role of DUEL_ROLES) {
    const bestPerPlayer = new Map<string, { cardId: string; ovr: number }>();
    for (const c of reg().forRole(role)) {
      if (!c.combat) continue;
      const prev = bestPerPlayer.get(c.playerId);
      if (!prev || c.ovr > prev.ovr) bestPerPlayer.set(c.playerId, { cardId: c.id, ovr: c.ovr });
    }
    const arr = [...bestPerPlayer.values()].sort((a, b) => b.ovr - a.ovr || a.cardId.localeCompare(b.cardId));
    byRole.set(role, arr);
  }

  // Se busca el bloque de dos cartas por rol cuya suma total quede más cerca del mazo del jugador.
  const perRoleTarget = targetSumOvr / DUEL_ROLES.length / 2;
  const picks: { cardId: string; ovr: number }[] = [];
  // Con el catálogo diseñado un jugador puede tener cartas de ROLES distintos: el jugador usado se
  // recuerda en TODO el mazo, no sólo dentro de un rol (el validador rechaza DUPLICATE_PLAYER).
  const usados = new Set<string>();
  const jugadorDe = new Map<string, string>();
  for (const role of DUEL_ROLES) for (const c of reg().forRole(role)) jugadorDe.set(c.id, c.playerId);
  for (const role of DUEL_ROLES) {
    const arr = (byRole.get(role) ?? []).filter((c) => !usados.has(jugadorDe.get(c.cardId) ?? ""));
    if (arr.length < 2) throw new Error(`El catálogo no tiene 2 cartas de ${role} para el rival`);
    let bestStart = 0;
    let bestDist = Infinity;
    for (let i = 0; i + 1 < arr.length; i++) {
      const dist = Math.abs((arr[i].ovr + arr[i + 1].ovr) / 2 - perRoleTarget);
      if (dist < bestDist) { bestDist = dist; bestStart = i; }
    }
    picks.push(arr[bestStart], arr[bestStart + 1]);
    usados.add(jugadorDe.get(arr[bestStart].cardId) ?? "");
    usados.add(jugadorDe.get(arr[bestStart + 1].cardId) ?? "");
  }

  // Instancias sintéticas del rival: existen solo dentro de esta partida y nunca se conceden.
  const owned: OwnedCard[] = picks.map((p, i) => ({
    uid: `bot-${seed}-${i}`, cardId: p.cardId, obtainedAt: 0,
  }));
  const deck = createDuelDeck({ id: `bot-${seed}`, name: "Rival", cards: owned.map((o) => o.uid), now: 0 });
  const validation = validateDuelDeck(deck, makeDeckResolver(reg(), ownershipFromList(owned), versionOf));
  if (!validation.valid) {
    throw new Error(`Mazo de rival ilegal: ${validation.errors.map((e) => e.code).join(", ")}`);
  }
  return takeDeckSnapshot(deck, validation, 0)!;
}

/**
 * FASE 35 · Mazo de rival FIJO (Road to Champions): las diez cartas reales que decidió el nodo. Mismas
 * instancias sintéticas que el rival de siempre (existen solo en la partida, nunca se conceden) y la MISMA
 * validación canónica: si el catálogo vivo no las admite, la partida no empieza.
 */
function fixedOpponentDeck(cardIds: readonly string[], name: string, label: string): DuelDeckSnapshot {
  const owned: OwnedCard[] = cardIds.map((cardId, i) => ({ uid: `bot-${label}-${i}`, cardId, obtainedAt: 0 }));
  const deck = createDuelDeck({ id: `bot-${label}`, name, cards: owned.map((o) => o.uid), now: 0 });
  const validation = validateDuelDeck(deck, makeDeckResolver(reg(), ownershipFromList(owned), versionOf));
  if (!validation.valid) {
    throw new Error(`Mazo de rival ilegal: ${validation.errors.map((e) => e.code).join(", ")}`);
  }
  return takeDeckSnapshot(deck, validation, 0)!;
}

// ───────────────────────────── DRAFT GAUNTLET (Fase 39) ─────────────────────────────

/** Modo de `duel_matches` de los combates del draft (0053). No paga, no cuenta para misiones, rating ni campaña. */
export const DRAFT_GAUNTLET_MODE = "DRAFT_GAUNTLET";

/**
 * F69 · las partidas PvP (ranked y privadas) viven en la MISMA tabla, con `user_id` = jugador A. Este servicio es el
 * de PvE: no puede retomarlas (la pantalla de partida rápida las retomaba y el bot intentaba jugar el turno del
 * rival humano → 500 en bucle), ni jugarlas, ni borrarlas (abandonar aquí hacía DELETE de un duelo PvP en curso).
 * Para él no existen: mismo 404 uniforme que un id inventado.
 */
const isPvpMode = (mode: string | null | undefined): boolean => mode === "PVP" || mode === "PVP_PRIVATE";

/**
 * FASE 39 · uid sintético y ESTABLE de la carta `index` de la plantilla de una run. Tiene forma de UUID (la ruta de
 * juego solo acepta UUID) y se deriva del id de la run. Existe solo dentro de la partida, igual que las cartas del
 * rival: no es un ejemplar, no está en `user_cards` y no tiene serial.
 */
export function draftCardUid(runId: string, index: number): string {
  return `${runId.slice(0, 24)}${(0xd4a000000000 + index).toString(16)}`;
}

export interface DraftDeckCheck { valid: boolean; errors: string[]; snapshot: DuelDeckSnapshot | null }

/**
 * FASE 39 · ADAPTADOR DE MAZO TEMPORAL. Las diez cartas del draft pasan por el validador CANÓNICO (`validateDuelDeck`)
 * con el mismo puerto de «instancias que existen solo en la partida» que usan los rivales. No hay validador paralelo:
 * tamaño, 2 por rol, carta o jugador repetido, stats de combate y versión de datos los decide el dominio de siempre.
 * Requiere el catálogo preparado (`await serverCatalog(sb)`).
 */
export function draftDeckCheck(runId: string, cardIds: readonly string[], now = 0, name = "Plantilla Draft"): DraftDeckCheck {
  const owned: OwnedCard[] = cardIds.map((cardId, i) => ({ uid: draftCardUid(runId, i), cardId, obtainedAt: 0 }));
  const deck = createDuelDeck({ id: `draft-${runId}`, name, cards: owned.map((o) => o.uid), now: 0 });
  const validation = validateDuelDeck(deck, makeDeckResolver(reg(), ownershipFromList(owned), versionOf));
  return {
    valid: validation.valid,
    errors: validation.errors.map((e) => e.code),
    snapshot: validation.valid ? takeDeckSnapshot(deck, validation, now) : null,
  };
}

/** FASE 39 · snapshot del rival tal y como entra en la partida (verificadores de balance; lanza si es ilegal). */
export function draftRivalSnapshot(cardIds: readonly string[], name: string, label: string): DuelDeckSnapshot {
  return fixedOpponentDeck(cardIds, name, label);
}

/** FASE 39 · ¿Es legal este mazo de rival? La MISMA comprobación que al lanzar la partida (verificadores). */
export function draftRivalCheck(cardIds: readonly string[], label: string): { valid: boolean; errors: string[] } {
  try { fixedOpponentDeck(cardIds, "Rival", label); return { valid: true, errors: [] }; }
  catch (e) { return { valid: false, errors: [(e as Error).message] }; }
}

// ───────────────────────────── proyección pública ─────────────────────────────

/**
 * Proyección REDACTADA de la partida, desde el punto de vista del HUMANO (bando `A`).
 *
 * ─────────────────────── QUÉ CAMBIÓ AQUÍ (Bloque 7.5) ───────────────────────
 *
 * El mapeo entero se ha MOVIDO a `@/lib/duel/matchView`, que es un módulo puro, y esta función
 * es ahora una llamada con `side: "A"`. No es un refactor por gusto: la arena de PvP necesita
 * exactamente esta misma proyección pero desde el bando que le toque —que puede ser `B`—, y
 * escribir una segunda copia es cómo dos vistas del mismo dato acaban discrepando. Con esto
 * queda resuelta la deuda **R11** («toPublicView cableado a snapshotA»).
 *
 * El comportamiento del PvE NO cambia: el humano es siempre `A`, así que `side: "A"` reproduce
 * literalmente lo que hacía antes. Lo comprueban las llamadas de `duel.test.ts`.
 *
 * Lo único que se queda AQUÍ es la recompensa, porque es de PvE: `buildMatchView` devuelve
 * `award: null` y se rellena a continuación. PvP no paga nada y no lo rellena nadie.
 *
 * Lo que NUNCA entra, igual que antes: las cartas no jugadas del rival, su snapshot, el estado
 * del generador y las semillas.
 */
export function toPublicView(m: DuelMatch, difficulty: BotDifficulty): DuelMatchView {
  /*
   * F71 · las pistas de las cartas ocultas del bot se calculan AQUÍ, con su mazo entero, y viajan
   * ya hechas ({ tipo, valor } por carta). El mazo sigue sin salir del servidor.
   *
   * DUEL GAMEPLAY UX 2.0 · la recompensa YA NO se recalcula aquí con la tabla (eso enseñaba lo que «correspondía», no
   * lo concedido: con el tope diario agotado la partida no paga). La pone `withContext` desde el libro mayor.
   */
  return buildMatchView(m, { side: HUMAN, registry: reg(), difficulty, rivalHints: rivalHintsFor(m, HUMAN, countryOf, visualHintValue), rivalRoles: rivalRolesFor(m, HUMAN, countryOf, visualHintValue), rivalCommitted: committedRivalHint(m, HUMAN, countryOf, visualHintValue) });
}

/**
 * FASE 39 · vista de un combate de DRAFT GAUNTLET: la MISMA proyección redactada, sin recompensa (el modo no paga
 * nada) y con el rival nombrado por su mazo (nombre original NEXUS, no un equipo real).
 */
export function toDraftView(m: DuelMatch, difficulty: BotDifficulty): DuelMatchView {
  return buildMatchView(m, { side: HUMAN, registry: reg(), difficulty, rivalLabel: m.snapshotB.deckName, rivalHints: rivalHintsFor(m, HUMAN, countryOf, visualHintValue), rivalRoles: rivalRolesFor(m, HUMAN, countryOf, visualHintValue), rivalCommitted: committedRivalHint(m, HUMAN, countryOf, visualHintValue) });
}

// ───────────────────────────── partida ─────────────────────────────

interface MatchRow {
  id: string; user_id: string; deck_id: string | null; difficulty: string;
  status: string; state: DuelMatch; rng: { a: RngState; b: RngState }; rules_version: string;
  /** Fase 39 · `DRAFT_GAUNTLET` no paga ni liquida campaña. */
  mode?: string | null;
  /** F66 · versión optimista (columna de 0031, `default 0`): la escritura de una jugada exige la versión leída. */
  state_version?: number | null;
  /**
   * F72.8 · plazo de la decisión humana en curso. Columnas de 0031 (las del reloj PvP) que el PvE ignoraba: sin
   * migración. Las fija SOLO el servidor, al empezar cada decisión.
   */
  turn_started_at?: string | null;
  turn_deadline_at?: string | null;
}

const MATCH_COLS = "id, user_id, deck_id, difficulty, status, state, rng, rules_version, mode, state_version, turn_started_at, turn_deadline_at";

const viewOf = (row: Pick<MatchRow, "mode" | "state" | "difficulty" | "state_version">): DuelMatchView => withVersion(
  row.mode === DRAFT_GAUNTLET_MODE
    ? toDraftView(row.state, row.difficulty as BotDifficulty)
    : toPublicView(row.state, row.difficulty as BotDifficulty),
  row.state_version ?? 0);

/**
 * F67 · la vista PvE lleva la versión del estado que el cliente devuelve en su jugada (`expectedVersion`), igual que
 * PvP. Sin ella, una jugada duplicada con OTRA carta llegada tarde (dos pestañas, reintento) se aplicaba al turno
 * SIGUIENTE como si el jugador la hubiera elegido para él (medido en la regresión de F67: 2×200 de 10 simultáneas).
 *
 * F72.8 · y el plazo de la decisión con la hora del servidor al responder: el cliente pinta `deadline − serverNow`
 * corregido por lo que haya pasado desde que llegó la respuesta. No decide nada con ello.
 */
// DUEL GAMEPLAY UX 2.0 · contra un bot no hay reloj: `turnDeadlineAt` es SIEMPRE null en PvE (el cliente no pinta nada).
const withVersion = (v: DuelMatchView, version: number): DuelMatchView =>
  ({ ...v, stateVersion: version, turnDeadlineAt: null, serverNow: Date.now() });

const DIFFICULTIES = new Set<BotDifficulty>(["EASY", "NORMAL", "HARD"]);

/**
 * CONTEXTO CANÓNICO de una partida PvE TERMINADA (presentación del resultado): `DRAFT` si la fila es de Draft Gauntlet,
 * `CAMPAIGN` si un intento de Road to Champions la reclama (`campaign_attempts.match_id`, único) y `QUICK` en otro caso.
 * Solo lectura; no paga, no liquida, no decide nada. Si la lectura falla, `undefined` (el cliente enseña el resultado
 * completo de siempre: nunca se esconde nada por un fallo).
 */
async function contextOf(sb: SupabaseClient, row: Pick<MatchRow, "id" | "mode">): Promise<PveMatchContext | undefined> {
  if (row.mode === DRAFT_GAUNTLET_MODE) return "DRAFT";
  const { data, error } = await sb.from("campaign_attempts").select("id").eq("match_id", row.id).limit(1);
  if (error) return undefined;
  return (data ?? []).length > 0 ? "CAMPAIGN" : "QUICK";
}

/** Añade el contexto SOLO a la vista de una partida terminada (en curso no hace falta y no se paga la lectura). */
async function withContext(sb: SupabaseClient, row: Pick<MatchRow, "id" | "mode" | "user_id" | "difficulty">, v: DuelMatchView): Promise<DuelMatchView> {
  if (v.status === "IN_PROGRESS") return v;
  const context = await contextOf(sb, row);
  const withCtx = context ? { ...v, context } : v;
  return withReceipt(sb, row, withCtx);
}

/**
 * DUEL GAMEPLAY UX 2.0 · RECIBO DE RECOMPENSAS de una partida TERMINADA, leído del LIBRO MAYOR (solo lectura: leerlo
 * veinte veces o tras F5 no concede nada; conceder lo hace `awardMatchOutcome` UNA vez por la clave `duel:<id>`).
 *
 *   · Partida: el asiento `duel:<id>` de ESTE usuario. Créditos = su importe real. XP y puntos los concedió la MISMA
 *     llamada atómica (`app_grant_reward`) con la tabla del dominio para ese resultado y dificultad; el motivo dice el
 *     resultado y si fue topada (`duel_capped_*` → nada concedido).
 *   · Campaña: la primera victoria que cerró ESTA partida (`campaign_attempts.match_id`, `first_clear`), su asiento.
 *   · Draft Gauntlet no paga por combate. Sin asiento → sin recompensa: nunca se inventa.
 * La fila ya es del usuario (la lectura previa filtra por `user_id`): otra persona no puede pedir este recibo.
 */
async function withReceipt(sb: SupabaseClient, row: Pick<MatchRow, "id" | "mode" | "user_id" | "difficulty">, v: DuelMatchView): Promise<DuelMatchView> {
  if (!v.result) return v;
  if (row.mode === DRAFT_GAUNTLET_MODE) return { ...v, result: { ...v.result, award: null, rewards: { matchId: row.id, grants: [], capped: false } } };
  try {
    const grants: MatchRewardGrant[] = [];
    let capped = false;
    const own = await sb.from("credit_transactions").select("delta, reason").eq("user_id", row.user_id).eq("ref", `duel:${row.id}`).maybeSingle();
    if (own.error) throw new Error(own.error.message);
    const reason = (own.data as { reason?: string } | null)?.reason ?? "";
    const hit = /^duel_(capped_)?(win|draw|loss)$/.exec(reason);
    if (hit) {
      capped = Boolean(hit[1]);
      if (!capped) {
        const outcome = hit[2] as DuelOutcome;
        const level = row.difficulty as BotDifficulty;
        grants.push({ source: "MATCH", reward: { credits: Number((own.data as { delta: number }).delta) || 0, xp: duelReward(outcome, level).xp ?? 0 }, points: duelPoints(outcome, level) });
      }
    }
    // Campaña: su módulo lee su propio recibo (import dinámico: `campaign` depende de este módulo, no al revés).
    const { firstClearRefForMatch } = await import("./campaign");
    const fcRef = await firstClearRefForMatch(sb, row.user_id, row.id);
    if (fcRef) {
      const fc = await sb.from("credit_transactions").select("delta").eq("user_id", row.user_id).eq("ref", fcRef).maybeSingle();
      const credits = fc.error ? 0 : Math.max(0, Number((fc.data as { delta?: number } | null)?.delta ?? 0));
      if (credits > 0) grants.push({ source: "CAMPAIGN_FIRST_CLEAR", reward: { credits }, points: 0 });
    }
    // `award` conserva su significado de siempre: lo que pagó LA PARTIDA (la primera victoria de campaña la enseña su
    // propio aviso; sumarla aquí la contaría dos veces en pantalla). El recibo completo va en `rewards`.
    const match = grants.find((g) => g.source === "MATCH");
    const award = match ? { points: match.points, credits: match.reward.credits ?? 0, xp: match.reward.xp ?? 0 } : null;
    // CORE GAME LOOP · el cupo diario que ocupó esta partida (solo lectura). Sin fila o sin lectura → sin contador
    // (el recibo de recompensas no depende de él).
    const slot = hit ? await readDuelPaySlot(sb, row.user_id, row.id).catch(() => null) : null;
    const daily = slot ? { slot: slot.slot, cap: DAILY_DUEL_AWARD_CAP } : undefined;
    return { ...v, result: { ...v.result, award, rewards: { matchId: row.id, grants, capped, ...(daily ? { daily } : {}) } } };
  } catch (e) {
    // Sin lectura fiable no se enseña nada (ni la tabla): mejor ninguna cifra que una cifra que no se concedió.
    console.error(`[duelos] recibo de ${row.id} no disponible: ${(e as Error).message}`);
    return { ...v, result: { ...v.result, award: null, rewards: null } };
  }
}

/** Lee la fila de partida del usuario. Solo `service_role` puede llegar aquí. */
async function loadMatch(sb: SupabaseClient, userId: string, matchId: string): Promise<MatchRow | null> {
  const { data, error } = await sb.from("duel_matches")
    .select(MATCH_COLS)
    .eq("id", matchId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as MatchRow) ?? null;
}

/**
 * F66 · Guarda la jugada SOLO si nadie la ha adelantado. Devuelve `false` si otra petición escribió antes.
 *
 * Antes era «gana la última escritura»: dos `play` del mismo turno (doble clic, Enter+clic, dos pestañas) cargaban la
 * misma fila y el segundo pisaba al primero. Ahora la escritura exige la `state_version` leída y la sube en uno: de dos
 * jugadas nacidas de la misma versión, Postgres deja pasar UNA (la otra afecta a cero filas). Es la misma puerta que usa
 * PvP desde 0031, sobre la misma columna; sin migración.
 */
async function persist(
  sb: SupabaseClient, row: MatchRow, m: DuelMatch, rng: { a: RngState; b: RngState },
  /**
   * F72.8 · el reloj. `now` es la hora del servidor de esta jugada: si la partida sigue, empieza la decisión siguiente
   * con su plazo. `dueAt` solo en la jugada AUTOMÁTICA: la escritura exige además que el plazo leído siga ahí y haya
   * vencido, así que una jugada humana y el vencimiento nacidos de la misma versión no pueden triunfar los dos.
   */
  clock: { now: number; dueAt?: string | null } = { now: Date.now() },
): Promise<boolean> {
  const version = row.state_version ?? 0;
  const deadline = decisionDeadline(true, m, clock.now); // PvE = contra bot: null (y así se borra el plazo de filas viejas)
  let q = sb.from("duel_matches")
    .update({
      turn_started_at: deadline === null ? null : new Date(clock.now).toISOString(),
      turn_deadline_at: deadline === null ? null : new Date(deadline).toISOString(),
      state_version: version + 1,
      status: m.status,
      state: m as unknown as object,
      rng,
      /*
       * `winner` es una copia DESNORMALIZADA de lo que ya dice `state` (migración 0016):
       * existe para que las misiones de temporada puedan contar victorias con un índice
       * en vez de traer y abrir un jsonb por partida. No decide nada —quién gana lo
       * sigue diciendo el Combat Resolver— y por eso se escribe desde el resultado que
       * él produce, nunca al revés.
       */
      winner: m.result?.winner ?? null,
    })
    .eq("id", row.id).eq("user_id", row.user_id).eq("state_version", version);
  if (clock.dueAt) q = q.eq("turn_deadline_at", clock.dueAt).lte("turn_deadline_at", new Date(clock.now).toISOString());
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data.length : data ? 1 : 0) > 0;
}

/**
 * Hace avanzar al bot hasta que le toque decidir a la persona (o la partida acabe).
 *
 * El bot lo mueve `advanceBots`, del motor: aquí no se decide ni una jugada. `confirmTurn` también
 * es del orquestador. Esta función solo transporta el estado del generador.
 */
function runBot(m: DuelMatch, difficulty: BotDifficulty, rng: { a: RngState; b: RngState }) {
  const ctrl = createController(
    { side: HUMAN, kind: "HUMAN", id: "you" },
    { side: BOT, kind: "BOT", id: "bot" },
  );
  const res = advanceBots(m, ctrl, { [BOT]: createDuelBot("bot", difficulty) }, rng.a, rng.b);
  return { match: res.match, rng: { a: res.rngA, b: res.rngB }, error: res.error };
}

/** Confirma el turno si los dos bandos ya han declarado. Nunca lo hace la interfaz. */
function confirmIfReady(m: DuelMatch): DuelMatch {
  if (m.phase !== "READY_TO_CONFIRM") return m;
  const c = confirmTurn(m);
  return c.ok ? c.match : m;
}

export async function startMatch(
  sb: SupabaseClient, userId: string, deckId: string, difficulty: string,
): Promise<ServiceResult<{ view: DuelMatchView }>> {
  await serverCatalog(sb); // catálogo persistido listo para los ayudantes síncronos
  if (!DIFFICULTIES.has(difficulty as BotDifficulty)) return fail(400, "Dificultad no válida");
  const level = difficulty as BotDifficulty;
  // Partida rápida: el rival de siempre (OPD-09), el mazo legal del catálogo más cercano en OVR.
  return createPveMatch(sb, userId, deckId, level, (sumOvr) => buildOpponentDeck(sumOvr, randomInt(0, 2 ** 31)));
}

/**
 * FASE 35 · ROAD TO CHAMPIONS. La MISMA partida PvE, con el único cambio de QUIÉN es el rival: un mazo fijo
 * de cartas reales que decide la definición del nodo (`domain/campaign/opponent`). Mismo orquestador, mismos
 * bots, mismas semillas de servidor, mismo pago al terminar (tabla PvE + tope diario). No conoce la campaña:
 * enlazar la partida con el nodo lo hace `services/campaign`.
 */
export async function startCampaignMatch(
  sb: SupabaseClient, userId: string, deckId: string, level: BotDifficulty,
  rival: { cardIds: readonly string[]; name: string; label: string },
): Promise<ServiceResult<{ view: DuelMatchView }>> {
  await serverCatalog(sb); // catálogo persistido listo para los ayudantes síncronos
  if (!DIFFICULTIES.has(level)) return fail(400, "Dificultad no válida");
  return createPveMatch(sb, userId, deckId, level, () => fixedOpponentDeck(rival.cardIds, rival.name, rival.label));
}

/**
 * FASE 39 · DRAFT GAUNTLET. La MISMA partida PvE (orquestador duel-turns-2, reglas vigentes, bots canónicos, semillas
 * de servidor) con dos cambios de contexto: el mazo del jugador es la plantilla TEMPORAL del draft (validador
 * canónico, sin propiedad, sin serial, sin `duel_decks`) y la fila se guarda con `mode = 'DRAFT_GAUNTLET'`. El id lo
 * fija `services/draftGauntlet`, que ya reclamó la run con versión optimista. No conoce la run.
 */
export async function startDraftMatch(
  sb: SupabaseClient, userId: string,
  input: { matchId: string; runId: string; cardIds: readonly string[]; level: BotDifficulty; rival: { cardIds: readonly string[]; name: string; label: string } },
): Promise<ServiceResult<{ view: DuelMatchView }>> {
  await serverCatalog(sb); // catálogo persistido listo para los ayudantes síncronos
  if (!DIFFICULTIES.has(input.level)) return fail(400, "Dificultad no válida");
  const check = draftDeckCheck(input.runId, input.cardIds, Date.now());
  if (!check.valid || !check.snapshot) return fail(409, `La plantilla del draft no es legal: ${check.errors.join(", ") || "revisa la composición"}`);
  return launchPve(sb, userId, {
    deckId: null, snapshot: check.snapshot, level: input.level, mode: DRAFT_GAUNTLET_MODE, matchId: input.matchId,
    opponentFor: () => fixedOpponentDeck(input.rival.cardIds, input.rival.name, input.rival.label),
  });
}

/**
 * FASE 39 · abandonar la run borra SU combate en curso (como `abandonMatch`: sin fila, no hay nada que cobrar). Solo
 * filas `DRAFT_GAUNTLET` en curso del propio usuario: una partida terminada no se borra, se liquida.
 */
export async function abandonDraftMatch(sb: SupabaseClient, userId: string, matchId: string): Promise<ServiceResult<{ deleted: number }>> {
  const { data, error } = await sb.from("duel_matches").delete()
    .eq("id", matchId).eq("user_id", userId).eq("mode", DRAFT_GAUNTLET_MODE).eq("status", "IN_PROGRESS").select("id");
  if (error) return fail(500, error.message);
  return done({ deleted: ((data as unknown[] | null) ?? []).length });
}

/** Crea y persiste una partida PvE. Idéntico a lo que hacía `startMatch`; solo el rival llega de fuera. */
async function createPveMatch(
  sb: SupabaseClient, userId: string, deckId: string, level: BotDifficulty,
  opponentFor: (sumOvr: number) => DuelDeckSnapshot,
): Promise<ServiceResult<{ view: DuelMatchView }>> {
  const owned = await loadOwned(sb, userId);
  const { data: deckRow, error } = await sb.from("duel_decks")
    .select("id, name, card_uids, created_at, updated_at")
    .eq("id", deckId).eq("user_id", userId).maybeSingle();
  if (error) return fail(500, error.message);
  if (!deckRow) return fail(404, "Mazo no encontrado");

  const row = deckRow as DeckRow;
  const deck = createDuelDeck({
    id: row.id, name: row.name, cards: row.card_uids ?? [], now: new Date(row.created_at).getTime(),
  });

  // FRONTERA: se vuelve a validar contra la propiedad REAL, no contra lo que guardó el cliente.
  const { validation } = validateAgainstOwnership(deck, owned);
  if (!validation.valid) {
    return fail(409, `Ese mazo no es legal: ${validation.errors.map(explainDeckError)[0] ?? "revisa la composición"}`);
  }

  const snapshot = takeDeckSnapshot(deck, validation, Date.now());
  if (!snapshot) return fail(500, "No se pudo preparar el mazo");

  return launchPve(sb, userId, { deckId: row.id, snapshot, level, opponentFor });
}

interface LaunchInput {
  deckId: string | null;
  snapshot: DuelDeckSnapshot;
  level: BotDifficulty;
  opponentFor: (sumOvr: number) => DuelDeckSnapshot;
  /** Fase 39 · solo el draft fija modo e id; el PvE de siempre inserta exactamente lo mismo que antes. */
  mode?: typeof DRAFT_GAUNTLET_MODE;
  matchId?: string;
}

/** Arranca y persiste la partida PvE con un mazo ya validado. Un único camino para rápida, campaña y draft. */
async function launchPve(sb: SupabaseClient, userId: string, input: LaunchInput): Promise<ServiceResult<{ view: DuelMatchView }>> {
  const { snapshot, level, opponentFor } = input;
  const draft = input.mode === DRAFT_GAUNTLET_MODE;
  const sumOvr = snapshot.cards.reduce((s, c) => s + c.ovr, 0);
  // Semillas de servidor. Nunca salen de aquí: son lo que hace impredecible al bot.
  const seedA = randomInt(0, 2 ** 31);
  const seedB = randomInt(0, 2 ** 31);
  let opponent: DuelDeckSnapshot;
  try { opponent = opponentFor(sumOvr); } catch (e) { return fail(500, `No se pudo preparar el rival: ${(e as Error).message}`); }
  // Quién abre el primer turno también se decide en servidor.
  const firstAttacker: Side = randomInt(0, 2) === 0 ? HUMAN : BOT;

  const started = startDuelMatch({
    id: input.matchId ?? crypto.randomUUID(),
    snapshotA: snapshot,
    snapshotB: opponent,
    firstAttacker,
    rules: CURRENT_COMBAT_RULES,
  });
  if (!started.ok) return fail(500, "La partida no puede empezar con ese mazo");

  let rng = { a: createRng(seedA), b: createRng(seedB) };
  // Si abre el bot, se le deja declarar antes de devolver el estado.
  const advanced = runBot(started.match, level, rng);
  if (advanced.error) return fail(500, "El oponente no pudo abrir el turno");
  const match = advanced.match;
  rng = advanced.rng;

  // F72.8 · la primera decisión humana empieza aquí, con el reloj del servidor.
  const now = Date.now();
  const deadline = decisionDeadline(true, match, now); // PvE = contra bot: sin plazo
  const { data: inserted, error: insErr } = await sb.from("duel_matches").insert({
    ...(input.matchId ? { id: input.matchId } : {}),
    ...(draft ? { mode: DRAFT_GAUNTLET_MODE } : {}),
    user_id: userId, deck_id: input.deckId, difficulty: level, status: match.status,
    state: match as unknown as object, rng, rules_version: CURRENT_COMBAT_RULES.version, state_version: 0,
    turn_started_at: deadline === null ? null : new Date(now).toISOString(),
    turn_deadline_at: deadline === null ? null : new Date(deadline).toISOString(),
  }).select("id").maybeSingle();
  if (insErr) return fail(500, insErr.message);

  const withId: DuelMatch = { ...match, id: (inserted as { id: string }).id };
  if (!input.matchId) {
    await sb.from("duel_matches").update({ state: withId as unknown as object })
      .eq("id", withId.id).eq("user_id", userId);
  }

  return done({ view: withVersion(draft ? toDraftView(withId, level) : toPublicView(withId, level), 0) });
}

export async function getMatch(
  sb: SupabaseClient, userId: string, matchId: string,
): Promise<ServiceResult<{ view: DuelMatchView }>> {
  await serverCatalog(sb); // catálogo persistido listo para los ayudantes síncronos
  const row = await loadMatch(sb, userId, matchId);
  if (!row || isPvpMode(row.mode)) return fail(404, "Partida no encontrada"); // F69 · el PvP tiene su propia vista
  // F72.8 · leer la partida es una de las ocasiones de resolver una decisión vencida (el cliente pregunta al llegar a 0).
  const current = await settleClock(sb, row, Date.now());
  if (!current) return fail(404, "Partida no encontrada");
  return done({ view: await withContext(sb, current, viewOf(current)) });
}

/** Partida en curso del usuario, si la hay. Permite retomar tras recargar la página. */
export async function getActiveMatch(
  sb: SupabaseClient, userId: string,
): Promise<ServiceResult<{ view: DuelMatchView | null }>> {
  await serverCatalog(sb); // catálogo persistido listo para los ayudantes síncronos
  const { data, error } = await sb.from("duel_matches")
    .select(MATCH_COLS)
    .eq("user_id", userId).eq("status", "IN_PROGRESS")
    // Fase 39 · el combate del draft se retoma desde su run, nunca desde la partida rápida (que lo abandonaría).
    .neq("mode", DRAFT_GAUNTLET_MODE)
    // F69 · y un duelo PvP tampoco: se retoma en /duelos/pvp.
    .neq("mode", "PVP").neq("mode", "PVP_PRIVATE")
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return done({ view: null });
  // F72.8 · retomar (F5, reconexión) también resuelve lo vencido mientras no estabas: el plazo no se reinicia.
  const row = await settleClock(sb, data as MatchRow, Date.now());
  if (!row) return done({ view: null });
  // F86.2 · si el reloj la terminó mientras no estabas, el resultado llega con su contexto (rápida → resultado mínimo).
  return done({ view: await withContext(sb, row, withVersion(toPublicView(row.state, row.difficulty as BotDifficulty), row.state_version ?? 0)) });
}

/**
 * DUEL GAMEPLAY UX 2.0 · CONTRA UN BOT NO HAY RELOJ. Antes (F72.8) una decisión humana vencida la jugaba el servidor;
 * contra un bot eso ya no existe: ni plazo, ni jugada automática, ni derrota por tiempo. Se conserva la función (la
 * llaman las lecturas y la jugada) para que ninguna ruta pueda volver a jugar por la persona. Una fila anterior a este
 * cambio con `turn_deadline_at` escrito se IGNORA, y la siguiente jugada lo borra (`persist`).
 * El reloj de PvP, ranked, privadas y torneos vive en `duelsPvp` y no cambia.
 */
async function settleClock(_sb: SupabaseClient, row: MatchRow, _now: number): Promise<MatchRow | null> {
  return row;
}

/**
 * Aplica LA jugada de la persona y devuelve el estado resultante.
 *
 * Atacando: elige carta y declara estadística. Defendiendo: elige carta, y la estadística la impone
 * la tabla del documento de diseño —el cliente ni la envía—. Después se deja actuar al bot y, si el
 * turno está completo, lo cierra el orquestador.
 *
 * Toda decisión de legalidad la toma el orquestador. Si rechaza algo, se devuelve su motivo y NO se
 * persiste nada: una jugada ilegal no puede dejar la partida a medias.
 *
 * F72.8 · una jugada que llega DESPUÉS del plazo no se aplica: primero se resuelve la decisión vencida (la juega el
 * servidor) y se responde 409 con el estado ya avanzado. Nunca se acepta una jugada de una decisión expirada.
 */
export async function playTurn(
  sb: SupabaseClient, userId: string, matchId: string, cardUid: string, stat?: string,
  /** F67 · versión que el cliente estaba viendo. Si ya no es la actual, la jugada era para OTRO turno: 409 + estado. */
  expectedVersion?: number,
  opts: { now?: number } = {},
): Promise<ServiceResult<{ view: DuelMatchView }>> {
  await serverCatalog(sb); // catálogo persistido listo para los ayudantes síncronos
  const now = opts.now ?? Date.now();
  const row = await loadMatch(sb, userId, matchId);
  if (!row || isPvpMode(row.mode)) return fail(404, "Partida no encontrada"); // F69 · un duelo PvP no se juega por aquí
  if (row.state.status !== "IN_PROGRESS") return fail(409, "La partida ya ha terminado");

  // DUEL GAMEPLAY UX 2.0 · contra un bot no hay plazo que pueda haber vencido: ninguna jugada se rechaza por tiempo.
  if (typeof expectedVersion === "number" && expectedVersion !== (row.state_version ?? 0)) {
    return { ok: false, status: 409, code: "STALE_STATE", error: "La partida cambió mientras jugabas", data: { view: await withContext(sb, row, viewOf(row)) } }; // F86.2
  }

  let m = row.state;
  const iAmAttacker = m.attacker === HUMAN;

  if (iAmAttacker) {
    if (m.phase !== "ATTACKER_CARD") return fail(409, "Ahora no te toca declarar");
    const s = typeof stat === "string" ? stat : "";
    if (!["stronghold", "gamesense", "entryfrag"].includes(s)) return fail(400, "Estadística no válida");

    const a = selectAttackerCard(m, cardUid);
    if (!a.ok) return fail(409, humanize(a.error.code));
    const b = selectAttackerStat(a.match, s as CombatStatKey);
    if (!b.ok) return fail(409, humanize(b.error.code));
    m = b.match;
  } else {
    if (m.phase !== "DEFENDER_CARD") return fail(409, "Ahora no te toca responder");
    const d = selectDefenderCard(m, cardUid);
    if (!d.ok) return fail(409, humanize(d.error.code));
    // La estadística del defensor la impone la tabla: el cliente no la elige ni la envía.
    const forced = requiredDefenderStat(d.match);
    if (!forced) return fail(500, "No se pudo determinar la respuesta obligada");
    const s = selectDefenderStat(d.match, forced);
    if (!s.ok) return fail(409, humanize(s.error.code));
    m = s.match;
  }

  return commitDecision(sb, row, m, now, null);
}

/**
 * F72.8 · CIERRA UNA DECISIÓN HUMANA YA TOMADA —por la persona o, al vencer, por el reloj—. Un solo camino: bot,
 * confirmación del orquestador, persistencia condicionada, pago y liquidación de campaña o draft. La jugada automática
 * no tiene un segundo camino que pudiera pagar distinto.
 */
async function commitDecision(
  sb: SupabaseClient, row: MatchRow, decided: DuelMatch, now: number, timeout: DecisionTimeout | null,
): Promise<ServiceResult<{ view: DuelMatchView }>> {
  const level = row.difficulty as BotDifficulty;
  let m = decided;
  let rng = row.rng;

  // Le toca al bot: responder si el jugador atacó, o nada si el jugador acaba de responder.
  const afterBot = runBot(m, level, rng);
  if (afterBot.error) return fail(500, "El oponente no pudo responder");
  m = confirmIfReady(afterBot.match);
  rng = afterBot.rng;

  // Y si el siguiente turno lo abre el bot, se le deja declarar antes de devolver el estado.
  const next = runBot(m, level, rng);
  if (!next.error) { m = next.match; rng = next.rng; }

  // F72.8 · el registro de decisiones agotadas viaja con el estado (sin carta ni estadística: solo turno y bando).
  m = recordTimeout(m, row.state, timeout);

  const applied = await persist(sb, row, m, rng, { now, dueAt: timeout ? row.turn_deadline_at ?? null : undefined });
  if (!applied) {
    // F66 · otra jugada de este mismo turno llegó antes. Esta no se aplica: se devuelve el estado REAL para resincronizar.
    const current = await loadMatch(sb, row.user_id, row.id);
    return {
      ok: false, status: 409, code: "STALE_STATE",
      error: current ? "La partida cambió mientras jugabas" : "La partida ya no existe",
      ...(current ? { data: { view: await withContext(sb, current, viewOf(current)) } } : {}), // F86.2 · con contexto
    };
  }

  /*
   * ═══ EL CIERRE DEL CICLO (Fase 10) ═══
   *
   * Si la partida ha terminado en esta jugada, se paga. Antes de la Fase 10 aquí no
   * había nada: un duelo acababa y el jugador no se llevaba ni un crédito, ni XP, ni un
   * punto de rango. El modo propio del juego no tocaba la progresión.
   *
   * Va DESPUÉS de persistir a propósito. Si se pagara antes y la persistencia fallara, el
   * jugador cobraría por una partida que el servidor no recuerda haber terminado; al
   * revés, un fallo al pagar deja la partida bien guardada y el pago es reintentable —su
   * clave de idempotencia es la propia partida—.
   *
   * Y no rompe la jugada: si el pago falla, la respuesta sigue siendo el estado correcto
   * del duelo. Una recompensa perdida se puede reclamar; una partida corrompida, no.
   */
  // FASE 39 · un combate de DRAFT GAUNTLET no paga (v1 sin recompensas): ni créditos, ni XP, ni puntos, ni cupo.
  const draftMatch = row.mode === DRAFT_GAUNTLET_MODE;
  if (!draftMatch) {
    await awardMatchOutcome(sb, row.user_id, row.id, m, level).catch((e: unknown) => {
      console.error(`[duelos] no se pudo pagar la partida ${row.id}: ${(e as Error).message}`);
    });
  }

  /*
   * FASE 35 · Si esta partida la lanzó un nodo de Road to Champions, se liquida su progreso con el resultado
   * que YA decidió el motor. Idempotente y fuera del camino crítico: si falla, la partida sigue bien guardada
   * y `action: "sync"` lo cierra después. Import dinámico: `campaign` depende de este módulo, no al revés.
   */
  if (m.status !== "IN_PROGRESS" && m.status !== "WAITING") {
    // Fase 39 · el combate del draft liquida SU run (nunca la campaña); el resto, su nodo si lo tiene.
    if (draftMatch) await settleDraftFor(sb, row.user_id, row.id, m);
    else await settleCampaignFor(sb, row.user_id, row.id, m);
    /*
     * F73 · MISIONES. Solo la escritura GANADORA llega aquí (persist condicionado): la partida se procesa una vez, y
     * además `mission_events` lo impone por clave `match:<id>`. El equipo evaluado es el snapshot congelado del
     * servidor; la política anti-AFK cuenta las decisiones que jugó el reloj (F72.8). Nunca lanza.
     */
    await settleMissionsForMatch(sb, row.id, m, [{ userId: row.user_id, side: HUMAN }],
      { mode: draftMatch ? "DRAFT" : "PVE", difficulty: level, finished: true });
  }

  return done({ view: await withContext(sb, row, withVersion(draftMatch ? toDraftView(m, level) : toPublicView(m, level), (row.state_version ?? 0) + 1)) });
}

/**
 * Paga lo que ha dado una partida TERMINADA.
 *
 * Tres cosas que no se negocian:
 *
 *   1. **Solo partidas terminadas de verdad.** `IN_PROGRESS` y `WAITING` no pagan. Y
 *      abandonar no paga nada, porque `abandonMatch` BORRA la fila: no hay partida que
 *      cobrar. Eso cierra la vía de «empiezo, veo que voy perdiendo y abandono».
 *   2. **Una partida, un pago.** La clave de idempotencia es `duel:<matchId>`, así que
 *      reintentar, recargar o una condición de carrera entre dos peticiones no pagan dos
 *      veces. Lo garantiza el índice único del libro mayor, no este código.
 *   3. **La recompensa no la decide esta función.** La decide la tabla del dominio
 *      (`domain/progression/duelRewards`), que es pura y está probada. Aquí solo se
 *      transporta.
 */
async function awardMatchOutcome(
  sb: SupabaseClient, userId: string, matchId: string, m: DuelMatch, difficulty: BotDifficulty,
): Promise<void> {
  const result = m.result;
  if (!result || m.status === "IN_PROGRESS" || m.status === "WAITING") return;

  const base = duelAward(
    {
      winner: result.winner === null ? null : result.winner === HUMAN ? "YOU" : "RIVAL",
      isDraw: result.isDraw,
    },
    difficulty,
  );

  /*
   * EL TOPE DIARIO. Un duelo contra un bot se puede repetir sin límite, así que conectarlo
   * a la economía sin tope sería abrir una granja de créditos y de rango. Se cuentan las
   * partidas YA PAGADAS hoy —los asientos del libro mayor cuyo motivo empieza por
   * `duel_`— y a partir del cupo la partida se sigue jugando y guardando, pero deja de
   * pagar.
   *
   * Se cuenta lo pagado y no lo jugado a propósito: abandonar no consume cupo, y un fallo
   * de red que impida un pago no le quita a nadie su parte.
   */
  /*
   * FASE 42 · ATÓMICO. El recuento anterior («cuántas pagadas hoy» y luego pagar) dejaba cobrar a N partidas que
   * terminaban a la vez. Ahora cada pago ocupa un cupo numerado del día con clave primaria (`services/duelCap`): nunca
   * hay más de `DAILY_DUEL_AWARD_CAP` partidas pagadas en un día UTC, por mucho que coincidan.
   */
  const slot = await takeDuelPaySlot(sb, userId, matchId, Date.now());
  const a = capDuelAward(base, slot.paid ? 0 : DAILY_DUEL_AWARD_CAP);

  await award(sb, {
    userId,
    ref: `duel:${matchId}`,
    // El motivo distingue una partida topada: en el libro mayor se ve por qué no pagó.
    reason: a.capped ? `duel_capped_${a.outcome}` : `duel_${a.outcome}`,
    reward: a.reward,
    points: a.points,
  });
}

/** FASE 35 · liquidación de campaña tras cerrar una partida PvE. Nunca rompe la jugada. */
async function settleCampaignFor(sb: SupabaseClient, userId: string, matchId: string, m: DuelMatch): Promise<void> {
  try {
    const { settleCampaignMatch } = await import("./campaign");
    await settleCampaignMatch(sb, userId, matchId, {
      status: m.status,
      result: m.result ? { winner: m.result.winner, isDraw: m.result.isDraw } : null,
    });
  } catch (e) {
    console.error(`[duelos] no se pudo liquidar la campaña de ${matchId}: ${(e as Error).message}`);
  }
}

/** FASE 39 · liquidación de la run de DRAFT GAUNTLET tras cerrar su combate. Nunca rompe la jugada. */
async function settleDraftFor(sb: SupabaseClient, userId: string, matchId: string, m: DuelMatch): Promise<void> {
  try {
    const { settleDraftMatch } = await import("./draftGauntlet");
    await settleDraftMatch(sb, userId, matchId, {
      status: m.status,
      result: m.result ? { winner: m.result.winner, isDraw: m.result.isDraw, scoreA: m.result.scoreA, scoreB: m.result.scoreB } : null,
    });
  } catch (e) {
    console.error(`[duelos] no se pudo liquidar la run del draft de ${matchId}: ${(e as Error).message}`);
  }
}

/** Cupo diario de partidas que pagan, expuesto para la interfaz y las pruebas. */
export { DAILY_DUEL_AWARD_CAP };

/** Traduce un rechazo del orquestador a algo que el jugador entienda. */
function humanize(code: string): string {
  switch (code) {
    case "CARD_ALREADY_USED": return "Esa carta ya la has usado en un turno anterior";
    case "CARD_NOT_IN_SNAPSHOT": return "Esa carta no está en tu mazo de esta partida";
    case "WRONG_PHASE": return "Ahora no toca esa acción";
    case "ILLEGAL_STAT_MATCHUP": return "Esa estadística no puede enfrentarse a la declarada";
    case "MATCH_ALREADY_COMPLETE": return "La partida ya ha terminado";
    default: return "Jugada no permitida";
  }
}

interface ReplayRow {
  id: string; user_id: string; player_b_id: string | null; mode: string | null; difficulty: string; deck_id?: string | null;
  status: string; state: DuelMatch; rules_version: string; closed_reason: string | null;
}

/**
 * Repetición de una partida TERMINADA (Fase 8; Fase 33: PvE, PvP y privado).
 *
 * FASE 33 · TRES CORRECCIONES, las tres de privacidad o de acceso:
 *   1. Antes solo encontraba la fila si `user_id` = tú, y asumía «yo = A»: el jugador B de un PvP no
 *      podía ver su partida. Ahora vale cualquiera de los DOS participantes, y nadie más (404).
 *   2. `rivalCards` enviaba el snapshot ENTERO del rival, cartas no jugadas incluidas. Ahora solo lo
 *      jugado; en PvP, además, la partida se proyecta con `projectMatchFor` antes de construir nada.
 *   3. Un PvP cerrado por abandono o tiempo sigue con `status` IN_PROGRESS en el estado del motor: se
 *      considera terminado si tiene `closed_reason`.
 * Se sirven HECHOS persistidos (los turnos que guardó el orquestador); el motor no se vuelve a ejecutar.
 */
export async function getReplay(
  sb: SupabaseClient, userId: string, matchId: string,
): Promise<ServiceResult<DuelReplay>> {
  await serverCatalog(sb); // catálogo persistido listo para los ayudantes síncronos
  const { data, error } = await sb.from("duel_matches")
    .select("id, user_id, player_b_id, mode, difficulty, status, state, rules_version, closed_reason, deck_id")
    .eq("id", matchId)
    .or(`user_id.eq.${userId},player_b_id.eq.${userId}`)
    .maybeSingle();
  if (error) { console.error("[duels] replay", error.message); return fail(500, "No se pudo cargar la repetición"); }
  const row = data as ReplayRow | null;
  if (!row || (row.user_id !== userId && row.player_b_id !== userId)) return fail(404, "Partida no encontrada");
  const mode = row.mode === "PVP" || row.mode === "PVP_PRIVATE" ? row.mode : "PVE";
  const side: Side = row.user_id === userId ? "A" : "B";
  if (mode === "PVE" && side !== "A") return fail(404, "Partida no encontrada");
  const m = row.state;
  if (!row.closed_reason && (m.status === "IN_PROGRESS" || m.status === "WAITING")) {
    return fail(409, "La repetición solo está disponible al terminar la partida");
  }
  const difficulty = (DIFFICULTIES.has(row.difficulty as BotDifficulty) ? row.difficulty : "NORMAL") as BotDifficulty;
  const view = mode === "PVE"
    ? (row.mode === DRAFT_GAUNTLET_MODE ? toDraftView(m, difficulty) : toPublicView(m, difficulty))
    : buildMatchView(projectMatchFor(m, side, countryOf, visualHintValue), { side, registry: reg(), difficulty: "NORMAL", rivalLabel: "Rival" });
  let rivalName: string | null = null;
  if (mode !== "PVE") {
    const rivalId = side === "A" ? row.player_b_id : row.user_id;
    if (rivalId) {
      const p = await sb.from("profiles").select("username").eq("id", rivalId).maybeSingle();
      rivalName = (p.data as { username?: string } | null)?.username ?? null;
    }
  }
  const mine = side === "A" ? m.snapshotA : m.snapshotB;
  return done({
    matchId: m.id,
    mode,
    rivalName,
    difficulty,
    rulesVersion: row.rules_version,
    yourDeckName: mine.deckName,
    turns: view.history,
    result: view.result,
    yourCards: mine.cards.map(toCardDTO),
    rivalCards: view.rivalUsed,
    // Fase 43 · «Ajustar equipo» desde la repetición: solo el equipo propio de un PvE (no Draft, no PvP).
    deckId: mode === "PVE" && side === "A" && row.mode !== DRAFT_GAUNTLET_MODE ? row.deck_id ?? null : null,
  });
}

/** Partidas terminadas del usuario, para la lista de repeticiones. */
export async function listReplays(
  sb: SupabaseClient, userId: string,
): Promise<ServiceResult<{ matches: { matchId: string; difficulty: string; status: string; scoreYou: number; scoreRival: number; deckName: string; playedAt: number }[] }>> {
  const { data, error } = await sb.from("duel_matches")
    .select("id, difficulty, status, state, updated_at")
    .eq("user_id", userId).neq("status", "IN_PROGRESS")
    .order("updated_at", { ascending: false }).limit(20);
  if (error) return fail(500, error.message);
  const matches = ((data as { id: string; difficulty: string; status: string; state: DuelMatch; updated_at: string }[]) ?? [])
    .filter((r) => r.state?.result)
    .map((r) => ({
      matchId: r.id,
      difficulty: r.difficulty,
      status: r.status,
      scoreYou: r.state.result!.scoreA,
      scoreRival: r.state.result!.scoreB,
      deckName: r.state.snapshotA.deckName,
      playedAt: new Date(r.updated_at).getTime(),
    }));
  return done({ matches });
}

/**
 * Abandona la partida en curso. No hay penalización: el abandono no está definido (Fase 7).
 *
 * F66 · solo se borra una partida EN CURSO. Antes el `delete` no miraba el estado: abandonar una partida ya terminada
 * (p. ej. desde otra pestaña) borraba su repetición. Una terminada responde 409 y se conserva; una que ya no existe
 * sigue respondiendo bien (abandonar dos veces no es un error).
 */
export async function abandonMatch(
  sb: SupabaseClient, userId: string, matchId: string,
): Promise<ServiceResult<{ id: string }>> {
  // Fase 39 · un combate del draft solo se suelta abandonando SU run (`services/draftGauntlet`).
  const { data, error } = await sb.from("duel_matches").delete().eq("id", matchId).eq("user_id", userId)
    .neq("mode", DRAFT_GAUNTLET_MODE).neq("mode", "PVP").neq("mode", "PVP_PRIVATE") // F69 · nunca un duelo PvP
    .eq("status", "IN_PROGRESS").select("id");
  if (error) return fail(500, error.message);
  if ((Array.isArray(data) ? data.length : data ? 1 : 0) === 0) {
    const still = await sb.from("duel_matches").select("id, status").eq("id", matchId).eq("user_id", userId).maybeSingle();
    if (still.data && (still.data as { status: string }).status !== "IN_PROGRESS") {
      return { ok: false, status: 409, code: "MATCH_FINISHED", error: "La partida ya terminó" };
    }
  }
  return done({ id: matchId });
}

/** Nombres de rol, para que la interfaz no los invente. */
export const DUEL_ROLE_LIST = DUEL_ROLES;
/** Cartas exactas de un mazo, para que la interfaz no lo asuma. */
export const DUEL_SIZE = DUEL_DECK_SIZE;
/** Cartas disponibles ahora mismo, expuesto para los tests del servicio. */
export { availableCards };
